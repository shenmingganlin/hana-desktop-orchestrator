import crypto from "crypto";
import { buildElementSignature } from "../lib/element-signature.js";
import { parseJsonOutput, runUiaHelper } from "../lib/powershell.js";
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
    activateBeforeRead: { type: "boolean", default: false, description: "读取前先短暂激活目标窗口；用于 UWP/WinUI 等后台不展开 UIA 子树的窗口，会改变前台窗口状态" },
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

// ── 诊断空树 ───────────────────────────────────────────────
function diagnoseEmptyTree(result, { handle, titleContains, activateBeforeRead } = {}) {
  return {
    hypothesis: "目标窗口可能最小化、隐藏、或无 UIA 子树",
    suggestion: "尝试前置窗口（focus-window）后再调 ui-tree，或检查窗口是否已关闭",
    handle,
    titleContains,
    activateBeforeReadSuggested: !activateBeforeRead,
  };
}

export async function execute(input = {}, toolCtx = {}) {
  const effectiveHandle = input.handle || await resolveWindowHandle(input);
  if (!effectiveHandle) {
    return JSON.stringify({ ok: false, error: "window-not-found", detail: "无法定位目标窗口" }, null, 2);
  }

  const maxElements = Math.min(input.maxElements || 80, 300);
  const includeOffscreen = input.includeOffscreen === true;

  // 调用 desktop-uia-helper.exe uia-tree（~70ms vs PS ~500ms）
  const helperResult = parseJsonOutput(
    runUiaHelper("uia-tree", [effectiveHandle, String(maxElements * 3)]),
    "ui-tree"
  );

  if (!helperResult?.ok) {
    return JSON.stringify({
      ok: false,
      error: "uia-helper-failed",
      detail: helperResult?.error || "unknown",
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

  const result = {
    ok: true,
    snapshotId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    window: {
      title: "",
      handle: effectiveHandle,
      processId: 0,
      bounds: null, // helper 不返回 window 级 bounds
    },
    enumerationStrategy: "uia-helper-tree",
    enumerationDiagnostics: {
      windowDescendants: rawElements.length,
      filteredCount: elements.length,
    },
    activatedBeforeRead: false,
    count: elements.length,
    elements,
  };

  // 空树诊断
  if (elements.length === 0) {
    result.diagnosis = diagnoseEmptyTree(result, {
      handle: input.handle,
      titleContains: input.titleContains,
      activateBeforeRead: input.activateBeforeRead,
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
