import crypto from "crypto";
import { buildElementSignature } from "../lib/element-signature.js";
import { parseJsonOutput, runHelper, runUiaHelper } from "../lib/powershell.js";
import { buildActionPlan, requireRealInputApproval, resolvePluginConfig, REAL_INPUT_CONFIRMATION } from "../lib/safety.js";
import { consumeControlSession } from "../lib/control-session.js";
import { saveSnapshot } from "../lib/snapshot-store.js";

export const name = "ui-tree";
export const description = "读取目标窗口的 Windows UI Automation 元素摘要，返回快照内 elementId、角色、文本、边界和可用模式。";
export const parameters = {
  type: "object",
  properties: {
    handle: { type: "string", description: "目标窗口句柄，优先使用" },
    titleContains: { type: "string", description: "窗口标题包含文本，未提供 handle 时使用；都不提供则使用前台窗口" },
    maxElements: { type: "integer", default: 80, minimum: 1, maximum: 300, description: "最多返回元素数量" },
    includeOffscreen: { type: "boolean", default: false, description: "是否包含屏幕外元素" },
    activateBeforeRead: { type: "boolean", default: false, description: "读取前先短暂激活目标窗口；会改变前台窗口状态，需要真实输入确认" },
    sessionId: { type: "string", description: "已授权的本地控制会话 ID；激活窗口时使用" },
    confirmation: { type: "string", description: `激活窗口确认短语：${REAL_INPUT_CONFIRMATION}` },
  },
};

// ── 窗口查找（JS 侧处理，不依赖 PS） ─────────────────────────
async function resolveWindowHandle(input) {
  if (input.handle) return input.handle;
  if (input.titleContains) {
    // 从 list-windows（已加速为 helper.exe）获取窗口列表查找
    const { runHelper } = await import("../lib/powershell.js");
    const result = parseJsonOutput(runHelper("list-windows"), "list-windows");
    if (Array.isArray(result?.windows)) {
      const needle = input.titleContains.toLowerCase();
      const match = result.windows.find((w) => w.title?.toLowerCase().includes(needle));
      if (match?.handle) return String(match.handle);
    }
  }
  // fallback: foreground window - 通过 helper.exe dpi 获取前台窗口句柄
  const { runHelper } = await import("../lib/powershell.js");
  const dpiResult = parseJsonOutput(runHelper("dpi"), "dpi");
  if (dpiResult?.foregroundHandle) return String(dpiResult.foregroundHandle);
  return null;
}

// ── UIA provider 时序 ───────────────────────────────────────
const PROVIDER_RETRY_DELAYS_MS = [0, 200, 500];
function hasExpandedProvider(helperResult) {
  const elements = Array.isArray(helperResult?.elements) ? helperResult.elements : [];
  return elements.some((element) => element.automationId === "RootWebArea");
}

function needsProviderRetry(helperResult) {
  const elements = Array.isArray(helperResult?.elements) ? helperResult.elements : [];
  if (hasExpandedProvider(helperResult)) return false;
  const shellClasses = new Set(["RootView", "NonClientView", "WinFrameView", "ClientView", "View"]);
  return elements.length === 0
    || elements.some((element) => shellClasses.has(element.className));
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function readUiaTreeWithRetry(handle, { activateBeforeRead = false, maxElements, focusApproval = null } = {}) {
  const attempts = [];

  if (activateBeforeRead && focusApproval?.allowed === true) {
    const sessionConsumption = focusApproval.sessionId
      ? consumeControlSession(focusApproval.sessionId)
      : { ok: true, skipped: true };
    if (!sessionConsumption.ok) {
      attempts.push({ phase: "focus", ok: false, blocked: "control-session", sessionConsumption });
    } else {
      const focusResult = runHelper("focus", [handle]);
      attempts.push({ phase: "focus", ok: focusResult.ok, error: focusResult.error || null });
      await sleep(200);
    }
  } else if (activateBeforeRead) {
    attempts.push({ phase: "focus", ok: false, blocked: focusApproval?.reason || "approval-required" });
  }

  let helperResult = null;
  for (let index = 0; index < PROVIDER_RETRY_DELAYS_MS.length; index += 1) {
    const waitMs = PROVIDER_RETRY_DELAYS_MS[index];
    if (waitMs > 0) await sleep(waitMs);

    helperResult = parseJsonOutput(
      runUiaHelper("uia-tree", [handle, String(maxElements * 3)]),
      "ui-tree",
    );
    const count = Array.isArray(helperResult?.elements) ? helperResult.elements.length : 0;
    attempts.push({ phase: "uia-tree", attempt: index + 1, waitMs, count });

    if (!needsProviderRetry(helperResult)) break;
  }

  return { helperResult, attempts };
}

function diagnoseProviderTree({ handle, titleContains, activateBeforeRead, attempts } = {}) {
  return {
    hypothesis: "Chromium/WebView UIA provider 尚未展开，当前读取只获得窗口外壳节点",
    suggestion: activateBeforeRead
      ? "provider 仍未展开；检查宿主是否启用 Chromium accessibility provider，或稍后重试"
      : "使用 activateBeforeRead=true 重试，以激活窗口并等待 WebView UIA provider 展开",
    error: "provider-not-expanded",
    handle,
    titleContains,
    activateBeforeReadSuggested: !activateBeforeRead,
    attempts,
  };
}

export async function execute(input = {}, toolCtx = {}) {
  const effectiveHandle = input.handle || await resolveWindowHandle(input);
  if (!effectiveHandle) {
    return JSON.stringify({ ok: false, error: "window-not-found", detail: "无法定位目标窗口" }, null, 2);
  }

  const maxElements = Math.min(input.maxElements || 80, 300);
  const includeOffscreen = input.includeOffscreen === true;

  const activateBeforeRead = input.activateBeforeRead === true;
  let focusApproval = null;
  let focusPlan = null;
  if (activateBeforeRead) {
    focusApproval = requireRealInputApproval(input, resolvePluginConfig(toolCtx), {
      actionType: "focus-window",
      action: { type: "focus" },
      target: { handle: effectiveHandle },
    });
    focusApproval = { ...focusApproval, sessionId: input.sessionId || null };
    focusPlan = buildActionPlan({
      type: "focus-before-read",
      risk: "medium",
      target: { handle: effectiveHandle },
      action: { type: "focus" },
      notes: [focusApproval.allowed ? "Window focus approved." : `Focus blocked: ${focusApproval.reason}`],
    });
  }

  const { helperResult, attempts } = await readUiaTreeWithRetry(effectiveHandle, {
    activateBeforeRead,
    maxElements,
    focusApproval,
  });

  if (!helperResult?.ok) {
    return JSON.stringify({
      ok: false,
      error: "uia-helper-failed",
      detail: helperResult?.error || "unknown",
      attempts,
    }, null, 2);
  }

  // 从 helper 输出的元素构建 ui-tree 格式
  const rawElements = helperResult.elements || [];
  const elements = [];

  for (const raw of rawElements) {
    if (elements.length >= maxElements) break;
    if (!includeOffscreen && raw.isOffscreen) continue;
    if (!raw.bounds) continue;
    if (raw.bounds.width <= 0 || raw.bounds.height <= 0) continue;

    // 生成匹配键
    const matchKey = `aid:${raw.automationId || ""}|name:${raw.name || ""}|role:${raw.role || ""}|cls:${raw.className || ""}`;

    // 生成标签
    const label = raw.name || raw.automationId || raw.className || raw.role || `el-${raw.index}`;

    const element = {
      elementId: `el-${raw.index}`,
      index: raw.index,
      rawIndex: raw.index,
      name: raw.name || "",
      automationId: raw.automationId || "",
      className: raw.className || "",
      role: raw.role || "",
      enabled: raw.isEnabled,
      offscreen: raw.isOffscreen || false,
      bounds: raw.bounds,
      patterns: raw.patterns || [],
      label,
      matchKey,
      depth: raw.depth || 0,
    };

    element.signature = buildElementSignature(element);
    elements.push(element);
  }

  const windowInfo = parseJsonOutput(
    runHelper("window-info", [effectiveHandle]),
    "window-info",
  );
  const result = {
    ok: true,
    snapshotId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    window: {
      title: windowInfo?.title || "",
      handle: windowInfo?.handle || effectiveHandle,
      processId: Number(windowInfo?.processId || 0),
      processName: windowInfo?.processName || "",
      bounds: windowInfo?.bounds || null,
    },
    enumerationStrategy: "uia-helper-tree",
    enumerationDiagnostics: {
      windowDescendants: rawElements.length,
      filteredCount: elements.length,
      attempts,
      providerExpanded: hasExpandedProvider(helperResult),
    },
    activatedBeforeRead: activateBeforeRead && focusApproval?.allowed === true,
    focusApproval: activateBeforeRead ? focusApproval : undefined,
    focusPlan: activateBeforeRead ? focusPlan : undefined,
    count: elements.length,
    elements,
  };

  // UIA provider 未展开时保留可观察结果，并提供可执行诊断。
  if (needsProviderRetry(helperResult)) {
    result.diagnosis = diagnoseProviderTree({
      handle: input.handle,
      titleContains: input.titleContains,
      activateBeforeRead: input.activateBeforeRead === true,
      attempts,
    });
  }

  // 保存快照
  if (result.snapshotId) {
    const stored = saveSnapshot(result);
    result.leaseId = stored.leaseId;
    result.expiresAt = stored.expiresAt;
  }

  return JSON.stringify(result, null, 2);
}
