import { mouseClick } from "../lib/mouse-inject.js";
import { buildApprovalBundle } from "../lib/approval-bundle.js";
import { saveApprovalBundle } from "../lib/approval-store.js";
import { buildCursorOverlay } from "../lib/cursor-overlay.js";
import { getCursorOverlayClient } from "../lib/cursor-overlay-client.js";
import { compareElementSignature } from "../lib/element-signature.js";
import { parseJsonOutput, runUiaHelper } from "../lib/powershell.js";
import { buildActionPlan, requireRealInputApproval, resolvePluginConfig, REAL_INPUT_CONFIRMATION } from "../lib/safety.js";
import { findSnapshotElement, loadSnapshot, saveSnapshot } from "../lib/snapshot-store.js";
import { buildVerificationRequest } from "../lib/verification.js";
import { consumeControlSession } from "../lib/control-session.js";
import { JSON_RESULT_PREAMBLE, WINDOW_API_SNIPPET } from "../lib/windows.js";

export const name = "click-element";
export const description = "按 ui-tree 的 elementId 生成元素点击计划。支持 leaseId + snapshotId 自动恢复窗口和签名；签名校验通过后才允许 UIA Invoke。";
export const parameters = {
  type: "object",
  required: ["elementId"],
  properties: {
    elementId: { type: "string", description: "来自 ui-tree 的快照内元素 id，例如 el-0" },
    leaseId: { type: "string", description: "来自 ui-tree 的 leaseId；提供后会自动恢复窗口和元素签名" },
    snapshotId: { type: "string", description: "来自 ui-tree 的 snapshotId；与 leaseId 配合可从 snapshot store 恢复目标" },
    elementSignature: { type: "string", description: "来自 ui-tree 的元素签名；未提供时会尝试从 lease 快照恢复" },
    handle: { type: "string", description: "目标窗口句柄；lease 快照中的窗口句柄优先级更高" },
    titleContains: { type: "string", description: "窗口标题包含文本，未提供 handle/lease 时使用；都不提供则使用前台窗口" },
    expectedName: { type: "string", description: "可选。用于防止元素漂移的名称校验；未提供时会尝试从 lease 快照恢复" },
    sessionId: { type: "string", description: "可选。由 create-control-session 返回的控制会话 ID。" },
    dryRun: { type: "boolean", default: true, description: "是否只返回计划和 cursorOverlay，不执行点击" },
    confirmation: { type: "string", description: `真实 UIA 点击确认短语：${REAL_INPUT_CONFIRMATION}` },
    showCursor: { type: "boolean", default: true, description: "真实点击前是否显示发光光标飞向目标的动画浮层（不移动真实系统鼠标）。默认 true。" },
  },
};

function buildLeaseContext(input, elementId) {
  const leaseId = String(input.leaseId || "").trim();
  const snapshotId = String(input.snapshotId || "").trim();
  const storedSnapshot = leaseId && snapshotId ? loadSnapshot({ leaseId, snapshotId }) : null;

  if (leaseId && snapshotId && !storedSnapshot) {
    return {
      error: {
        dryRun: true,
        stale: true,
        approval: { allowed: false, dryRun: true, reason: "lease-snapshot-not-found" },
        leaseId,
        snapshotId,
        elementId,
        message: "未找到 lease 快照，可能已过期。请重新调用 ui-tree。",
      },
    };
  }

  const storedElement = storedSnapshot ? findSnapshotElement(storedSnapshot, elementId) : null;
  if (storedSnapshot && !storedElement) {
    return {
      error: {
        dryRun: true,
        stale: true,
        approval: { allowed: false, dryRun: true, reason: "element-not-found-in-lease-snapshot" },
        leaseId,
        snapshotId,
        elementId,
        message: "lease 快照中不存在该 elementId，请重新调用 ui-tree。",
      },
    };
  }

  return { leaseId, snapshotId, storedSnapshot, storedElement };
}

export async function execute(input = {}, toolCtx = {}) {
  const elementId = String(input.elementId || "").trim();
  if (!/^el-\d+$/.test(elementId)) throw new Error("elementId 必须形如 el-0");

  const leaseContext = buildLeaseContext(input, elementId);
  if (leaseContext.error) return JSON.stringify(leaseContext.error, null, 2);

  const { leaseId, snapshotId, storedSnapshot, storedElement } = leaseContext;
  const targetIndex = Number(elementId.slice(3));
  const effectiveHandle = storedSnapshot?.window?.handle || input.handle || "";
  const effectiveSignature = String(input.elementSignature || storedElement?.signature || "").trim();
  const effectiveExpectedName = input.expectedName ?? storedElement?.name ?? "";
  const config = resolvePluginConfig(toolCtx);
  const approval = requireRealInputApproval(input, config, {
    actionType: "click-element",
    target: { leaseId, snapshotId, handle: effectiveHandle || null, elementId, expectedName: effectiveExpectedName || null, elementSignature: effectiveSignature || null },
    capability: null,
  });
  const helperTreeResult = parseJsonOutput(
    runUiaHelper("uia-tree", [effectiveHandle, String(Math.max(targetIndex + 1, 240))]),
    "click-element-tree"
  );
  const helperElement = Array.isArray(helperTreeResult?.elements)
    ? helperTreeResult.elements.find((element) => Number(element.index) === targetIndex) || null
    : null;
  let inspectResult = helperElement
    ? {
        ok: true,
        element: {
          elementId: `el-${helperElement.index}`,
          name: helperElement.name || "",
          automationId: helperElement.automationId || "",
          className: helperElement.className || "",
          role: helperElement.role || "",
          enabled: helperElement.isEnabled !== false,
          bounds: helperElement.bounds || null,
          supportsInvoke: helperElement.supportsInvoke === true,
          supportsValue: helperElement.supportsValue === true,
          isReadOnly: helperElement.isReadOnly === true,
          currentValue: helperElement.currentValue ?? null,
        },
        capability: {
          supportsInvoke: helperElement.supportsInvoke === true,
          supportsValue: helperElement.supportsValue === true,
          isReadOnly: helperElement.isReadOnly === true,
          currentValue: helperElement.currentValue ?? null,
        },
      }
    : { ok: false, error: "element-not-found", elementId };
  if (!inspectResult?.ok) {
    // MODE 2 fallback is only available for an approved lease-bound action.
    // Without both gates, keep the result plan-only instead of blind-clicking.
    if (approval.allowed && storedSnapshot && storedElement?.bounds) {
      const bounds = storedElement.bounds;
      const left = Number(bounds.left);
      const top = Number(bounds.top);
      const right = Number(bounds.right ?? (left + Number(bounds.width || 0)));
      const bottom = Number(bounds.bottom ?? (top + Number(bounds.height || 0)));
      const fbX = Math.round((left + right) / 2);
      const fbY = Math.round((top + bottom) / 2);
      const expectedWindow = effectiveHandle ? { handle: effectiveHandle } : null;
      if (![left, top, right, bottom, fbX, fbY].every(Number.isFinite) || right <= left || bottom <= top) {
        return JSON.stringify({ dryRun: true, approval, leaseId, snapshotId, result: inspectResult, fallback: { attempted: false, reason: "invalid-stored-bounds" } }, null, 2);
      }
      const guard = evaluateClickSafety({ x: fbX, y: fbY, expected: expectedWindow });
      if (!guard.allowed) {
        return JSON.stringify({
          dryRun: true,
          approval,
          leaseId,
          snapshotId,
          result: inspectResult,
          fallback: { attempted: true, blocked: true, reason: guard.reason, guard },
        }, null, 2);
      }
      const plan = buildActionPlan({
        type: "click-element",
        risk: "high",
        target: { leaseId, snapshotId, handle: effectiveHandle || null, elementId, bounds, elementSignature: storedElement?.signature || null },
        action: { type: "mouse-click-fallback", x: fbX, y: fbY },
        notes: ["MODE 2 fallback: UIA inspect failed; used lease-bound storedElement.bounds after click-guard verification."],
      });
      const verificationRequest = buildVerificationRequest({
        actionType: "click-element",
        leaseId,
        snapshotId,
        elementId,
        expectedSignature: storedElement?.signature || null,
        expectedName: storedElement?.name || null,
        expectedHandle: effectiveHandle || null,
      });
      const approvalBundle = buildApprovalBundle({
        actionType: "click-element",
        risk: "high",
        approval,
        plan,
        target: plan.target,
        cursorOverlay: null,
        verificationRequest,
        capability: { supportsInvoke: false, fallback: "mouse-click" },
        safetyNotes: ["Real fallback click remains blocked unless the approval bundle is persisted."],
      });
      const approvalBundleSave = saveApprovalBundle(approvalBundle, { source: "click-element-fallback" });
      if (!approvalBundleSave?.ok) {
        return JSON.stringify({ dryRun: true, approval, leaseId, snapshotId, result: inspectResult, fallback: { attempted: false, blocked: true, reason: "approval-bundle-save-failed", approvalBundleSave }, plan }, null, 2);
      }
      const sessionConsumption = input.sessionId ? consumeControlSession(input.sessionId) : { ok: true, skipped: true };
      if (!sessionConsumption.ok) {
        return JSON.stringify({ dryRun: true, approval, leaseId, snapshotId, result: inspectResult, fallback: { attempted: false, blocked: true, reason: sessionConsumption.reason }, sessionConsumption }, null, 2);
      }
      const res = mouseClick({ x: fbX, y: fbY, button: "left", clicks: 1 });
      return JSON.stringify({ dryRun: false, fallback: true, x: fbX, y: fbY, guard, clickResult: res, approvalBundleSave, plan, sessionConsumption }, null, 2);
    }
    return JSON.stringify({ dryRun: true, approval, leaseId: leaseId || null, snapshotId: snapshotId || null, result: inspectResult }, null, 2);
  }

  const signatureCheck = compareElementSignature(inspectResult.element, effectiveSignature);
  let signatureVerified = signatureCheck.verified === true;
  
  // automationId can improve locating the target, but it must not bypass the
  // snapshot-bound signature gate.
  if (!signatureCheck.ok) {
    return JSON.stringify({
      dryRun: true,
      stale: true,
      approval: { allowed: false, dryRun: true, reason: "stale-element-signature" },
      leaseId: leaseId || null,
      snapshotId: snapshotId || null,
      elementId,
      signatureCheck,
      result: inspectResult,
      message: "元素签名与 ui-tree 快照不一致，请重新获取 ui-tree 后再操作。",
    }, null, 2);
  }

  const capability = inspectResult.capability || {};
  const center = inspectResult.element?.bounds
    ? { x: inspectResult.element.bounds.centerX, y: inspectResult.element.bounds.centerY }
    : null;
  const overlay = center ? buildCursorOverlay({ to: center, label: inspectResult.element?.name || elementId }) : null;
  const plan = buildActionPlan({
    type: "click-element",
    risk: approval.risk || "high",
    target: {
      leaseId: leaseId || null,
      snapshotId: snapshotId || null,
      handle: effectiveHandle || null,
      titleContains: input.titleContains || null,
      elementId,
      expectedName: effectiveExpectedName || null,
      elementSignature: effectiveSignature || signatureCheck.actualSignature,
    },
    action: { type: "uia-click", elementId, center, invokePatternAvailable: capability.supportsInvoke === true },
    notes: [
      storedSnapshot ? "Target restored from lease snapshot." : "Target resolved from direct input or foreground window.",
      approval.allowed ? "Real UIA invoke approved." : `Real action blocked: ${approval.reason}`,
      capability.supportsInvoke === true ? "InvokePattern is available." : "InvokePattern is unavailable; action remains plan-only.",
      signatureVerified
        ? "Element signature guard passed (verified against snapshot) before any invoke."
        : "Element signature NOT verified (no expected signature supplied); real invoke blocked, plan-only.",
      "cursorOverlay can be rendered by a future widget as a smooth preview cursor.",
    ],
  });

  const verificationRequest = buildVerificationRequest({
    actionType: "click-element",
    leaseId: leaseId || null,
    snapshotId: snapshotId || null,
    elementId,
    expectedSignature: effectiveSignature || signatureCheck.actualSignature,
    expectedName: effectiveExpectedName || null,
    expectedHandle: effectiveHandle || null,
  });

  const approvalBundle = buildApprovalBundle({
    actionType: "click-element",
    risk: approval.risk || "high",
    approval,
    plan,
    target: plan.target,
    cursorOverlay: overlay,
    verificationRequest,
    capability,
    safetyNotes: ["Real click remains blocked unless all real-input gates pass."],
  });
  const approvalBundleSave = saveApprovalBundle(approvalBundle, { source: "click-element" });
  const actionAllowed = approval.allowed && approvalBundleSave?.ok === true;
  let invokeResult = null;
  let cursorFlight = null;
  let sessionConsumption = input.sessionId ? { ok: false, pending: true } : { ok: true, skipped: true };
  // Hard gate: real UIA invoke requires a VERIFIED signature and a persisted approval bundle.
  if (actionAllowed && signatureVerified && capability.supportsInvoke === true) {
    // Fly the glowing overlay cursor to the target BEFORE invoking. This is a pure
    // visual overlay (separate transparent window); it never moves the real system cursor.
    if (center && input.showCursor !== false) {
      try {
        const overlayClient = getCursorOverlayClient({ pluginDir: toolCtx.pluginDir, dataDir: toolCtx.dataDir, log: toolCtx.log });
        const flyOk = await overlayClient.clickAt({
          toX: center.x,
          toY: center.y,
          durationMs: 520,
          clicks: 1,
          label: inspectResult.element?.name || elementId,
        });
        cursorFlight = { requested: true, delivered: flyOk === true };
        if (flyOk) await new Promise((r) => setTimeout(r, 560));
      } catch (err) {
        cursorFlight = { requested: true, delivered: false, error: err?.message || String(err) };
      }
    }
    const targetKey = storedElement?.automationId || storedElement?.name || String(targetIndex);
    sessionConsumption = input.sessionId ? consumeControlSession(input.sessionId) : { ok: true, skipped: true };
    if (!sessionConsumption.ok) {
      return JSON.stringify({ dryRun: true, approval, plan, approvalBundleSave, sessionConsumption }, null, 2);
    }
    invokeResult = parseJsonOutput(runUiaHelper("uia-click", [effectiveHandle, targetKey]), "click-element");
    if (invokeResult?.ok && storedSnapshot) {
      try { saveSnapshot(storedSnapshot); } catch { /* best-effort TTL extension */ }
    }
  }

  // Phase 2: 分层精简输出
  const isDryRun = !actionAllowed;
  const base = {
    ok: approvalBundleSave?.ok === true && (!isDryRun || approval.dryRun === undefined),
    element: inspectResult?.element,
    signatureCheck,
    plan,
    approvalBundleSave,
  };

  if (isDryRun) {
    // minimal 模式：只返回核心字段，~150 tokens
    return JSON.stringify({
      ...base,
      dryRun: true,
      cursorOverlay: overlay,
      cursorFlight: cursorFlight || null,
      resultPhase: "pre-action-inspect",
      result: inspectResult,
    }, null, 2);
  }

  // standard 模式（成功后）：含完整审计信息
  return JSON.stringify({
    ...base,
    dryRun: false,
    leaseId: leaseId || null,
    snapshotId: snapshotId || null,
    capability,
    cursorOverlay: overlay,
    cursorFlight: cursorFlight || null,
    resultPhase: invokeResult ? "invoke-complete" : "pre-action-inspect",
    result: inspectResult,
    invokeResult,
    sessionConsumption,
  }, null, 2);
}
