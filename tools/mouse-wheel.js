// mouse-wheel.js — MODE 2: real mouse wheel scroll at an absolute screen coordinate.
//
// WHY MODE 2: Windows routes WM_MOUSEWHEEL to the window UNDER THE CURSOR, not the
// focused window. To scroll a specific region the real cursor MUST first move there,
// then the wheel event fires. So this ACTUALLY moves the system cursor — same risk
// class as mouse-click-at, and it passes the same gates.
//
// SAFETY MODEL (mirrors mouse-click-at):
//   1. coords come from the caller (reads a screenshot / ui-tree, picks x,y)
//   2. the glow cursor flies to EXACTLY those coords (preview, no real movement)
//   3. real scroll requires: dryRun=false + config.allowRealInput + confirmation
//   4. pre-injection click-guard verifies the window under the point matches intent
//   5. preview coords and real scroll coords are the SAME variable — never diverge

import { buildApprovalBundle } from "../lib/approval-bundle.js";
import { saveApprovalBundle } from "../lib/approval-store.js";
import { buildCursorOverlay } from "../lib/cursor-overlay.js";
import { getCursorOverlayClient } from "../lib/cursor-overlay-client.js";
import { mouseWheel } from "../lib/mouse-inject.js";
import { evaluateClickSafety } from "../lib/click-guard.js";
import {
  requireRealInputApproval,
  resolvePluginConfig,
  buildActionPlan,
  isRealActionBlocked,
  REAL_INPUT_CONFIRMATION,
  clampInteger,
} from "../lib/safety.js";
import { consumeControlSession } from "../lib/control-session.js";

export const name = "mouse-wheel";
export const description =
  "模式2：在绝对屏幕坐标处用真实鼠标滚轮滚动（会先把系统指针移到该点，因为 Windows 按光标位置路由滚轮事件）。用于滚动长列表、翻页、缩放画布。notches 正=上/右，负=下/左。真实滚动前发光光标会先飞到同一坐标预演，需确认短语放行。";

export const parameters = {
  type: "object",
  required: ["x", "y", "expectedWindow"],
  properties: {
    x: { type: "integer", description: "滚动点的 X 坐标（物理屏幕像素，与 ui-tree 元素坐标同一坐标系）" },
    y: { type: "integer", description: "滚动点的 Y 坐标（物理屏幕像素）" },
    sessionId: { type: "string", description: "可选。由 create-control-session 返回的控制会话 ID。" },
    notches: {
      type: "integer",
      default: -3,
      description: "滚动格数。正值=向上/向右，负值=向下/向左。一格约等于真实滚轮一档。范围 ±30。",
    },
    axis: { type: "string", enum: ["vertical", "horizontal"], default: "vertical", description: "滚动轴向。水平滚动需要应用支持。" },
    label: { type: "string", description: "可选。预演光标旁显示的目标说明文字" },
    expectedWindow: {
      type: "object",
      description: "必填。声明这次滚动的意图目标窗口；滚动前护栏会校验坐标下实际命中的窗口是否匹配，不匹配则拒绝注入。",
      properties: {
        handle: { type: "string", description: "目标窗口句柄（最精确）" },
        processName: { type: "string", description: "目标进程名" },
        processId: { type: "integer", description: "目标进程 PID" },
      },
    },
    skipGuard: { type: "boolean", default: false, deprecated: true, description: "已废弃。命中窗口校验始终启用。" },
    dryRun: { type: "boolean", default: true, description: "true=只预演发光光标+返回计划，不真实滚动" },
    confirmation: { type: "string", description: `真实鼠标滚动确认短语：${REAL_INPUT_CONFIRMATION}` },
    showCursor: { type: "boolean", default: true, description: "真实滚动前是否显示发光光标飞向目标预演。默认 true。" },
  },
};

export async function execute(input = {}, toolCtx = {}) {
  const x = clampInteger(input.x, NaN);
  const y = clampInteger(input.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("x/y 必须是有效整数（物理屏幕像素）");
  }
  let notches = clampInteger(input.notches, -3);
  if (notches === 0) notches = -3;
  if (notches > 30) notches = 30;
  if (notches < -30) notches = -30;
  const axis = input.axis === "horizontal" ? "horizontal" : "vertical";
  const label = String(input.label || "").slice(0, 60);

  const config = resolvePluginConfig(toolCtx);
  const securityMode = String(config.securityMode || "normal").toLowerCase();
  const approval = requireRealInputApproval(input, config, {
    actionType: "mouse-wheel",
    action: { type: "real-mouse-wheel", axis, notches },
    target: input.expectedWindow || null,
  });

  // SINGLE SOURCE OF TRUTH: preview and real scroll both read this exact object.
  const target = { x, y };
  // Always observe the point so the bundle records the same window guard that gates
  // a real scroll. This observation does not move the cursor.
  const guard = evaluateClickSafety({ x: target.x, y: target.y, expected: input.expectedWindow || null });

  const plan = buildActionPlan({
    type: "mouse-wheel",
    risk: approval.risk || "medium",
    target: { x, y, notches, axis },
    action: { type: "real-mouse-wheel", target: { x, y }, notches, axis },
    notes: [
      "MODE 2: real wheel injection — the system cursor WILL move to the point first.",
      approval.allowed ? "Real mouse wheel approved." : `Real action blocked: ${approval.reason}`,
      "Preview cursor and real scroll use the same coordinate (cannot diverge).",
      "Windows routes the wheel event to the window under the cursor, hence the move.",
      guard ? `Pre-injection guard: ${guard.reason}` : "Pre-injection guard runs before the real scroll.",
    ],
  });

  const cursorOverlay = buildCursorOverlay({
    to: target,
    durationMs: 500,
    label: label || `scroll ${axis} ${notches > 0 ? "+" : ""}${notches}`,
  });
  const approvalBundle = buildApprovalBundle({
    actionType: "mouse-wheel",
    risk: approval.risk || "common",
    approval,
    plan,
    target: { x, y, notches, axis, expectedWindow: input.expectedWindow || null, guard },
    cursorOverlay,
    capability: { mode: 2, mechanism: "SetCursorPos+mouse_event(WHEEL)", coordinateContract: "physical-pixels" },
    safetyNotes: [
      "Raw coordinate action has no lease-bound element; the hit-window guard is the required freshness check.",
      "Initial approval evidence is preview-only; the approved bundle is persisted only after the final guard.",
    ],
    safetyRequirements: {
      realActionBlocked: true,
      requiresFreshLease: false,
      requiresSignatureGuard: false,
      requiresWindowGuard: true,
    },
  });
  const initialApprovalBundleSave = saveApprovalBundle(approvalBundle, { source: "mouse-wheel" });
  let actionAllowed = approval.allowed && guard.allowed && initialApprovalBundleSave?.ok === true;
  let finalGuard = null;
  let finalApprovalBundleSave = initialApprovalBundleSave;
  let cursorFlight = null;
  let scrollResult = null;
  let sessionConsumption = input.sessionId ? { ok: false, pending: true } : { ok: true, skipped: true };
  let blockedBy = !approval.allowed ? approval.reason : (!guard.allowed ? "click-guard" : (!initialApprovalBundleSave?.ok ? "approval-bundle-save-failed" : null));
  if (actionAllowed) {
    // Persisted evidence is the first gate before any visible preview or real input.
    if (input.showCursor !== false) {
      try {
        const overlayClient = getCursorOverlayClient({ pluginDir: toolCtx.pluginDir, dataDir: toolCtx.dataDir, log: toolCtx.log });
        const flyOk = await overlayClient.flyTo({
          toX: target.x,
          toY: target.y,
          durationMs: 500,
          label: label || `scroll ${axis} ${notches > 0 ? "+" : ""}${notches}`,
        });
        cursorFlight = { requested: true, delivered: flyOk === true };
        if (!flyOk) {
          actionAllowed = false;
          blockedBy = "cursor-overlay-failed";
        } else {
          await new Promise((r) => setTimeout(r, 540));
        }
      } catch (err) {
        cursorFlight = { requested: true, delivered: false, error: err?.message || String(err) };
        actionAllowed = false;
        blockedBy = "cursor-overlay-failed";
      }
    }
    if (actionAllowed) {
      finalGuard = evaluateClickSafety({ x: target.x, y: target.y, expected: input.expectedWindow || null });
      if (!finalGuard.allowed) {
        actionAllowed = false;
        blockedBy = "click-guard-recheck";
      } else {
        const finalApprovalBundle = buildApprovalBundle({
          ...approvalBundle,
          target: { ...approvalBundle.target, guard: finalGuard },
          safetyNotes: [...(approvalBundle.safety?.notes || []), "Final hit-window guard re-check passed immediately before input."],
          safetyRequirements: {
            realActionBlocked: false,
            requiresFreshLease: false,
            requiresSignatureGuard: false,
            requiresWindowGuard: true,
          },
        });
        finalApprovalBundleSave = saveApprovalBundle(finalApprovalBundle, { source: "mouse-wheel-final" });
        if (finalApprovalBundleSave?.ok !== true) {
          actionAllowed = false;
          blockedBy = "approval-bundle-save-failed";
        }
      }
    }
    if (actionAllowed) {
      sessionConsumption = input.sessionId ? consumeControlSession(input.sessionId) : { ok: true, skipped: true };
      if (!sessionConsumption.ok) {
        actionAllowed = false;
        blockedBy = sessionConsumption.reason || "control-session-consume-failed";
      }
    }
    if (actionAllowed) {
      const res = mouseWheel({ x: target.x, y: target.y, notches, axis });
      scrollResult = { ok: res.ok === true, mode: "mouse-inject", notches, axis, target };
      if (!res.ok) scrollResult.error = res.raw?.error || res.raw?.stderr || "scroll-failed";
    }
  }

  return JSON.stringify({
    dryRun: !approval.allowed,
    blocked: isRealActionBlocked({ approvalAllowed: approval.allowed, actionAllowed }),
    blockedBy,
    approval,
    target: { x, y, notches, axis },
    guard,
    finalGuard,
    plan,
    cursorOverlay,
    cursorFlight,
    scrollResult,
    approvalBundleSave: finalApprovalBundleSave,
    sessionConsumption,
    config: {
      allowRealInput: approval.allowed,
      allowRealMouseMove: config.allowRealMouseMove === true || securityMode === "maximum",
      securityMode: config.securityMode || "normal",
    },
    safety: {
      mode: 2,
      mechanism: "SetCursorPos+mouse_event(WHEEL)",
      movesRealCursor: actionAllowed,
      previewMatchesScroll: true,
      requiresPerActionConfirmation: true,
      guardChecksHitWindow: true,
      approvalBundlePersistedBeforeInput: finalApprovalBundleSave?.ok === true,
    },
  }, null, 2);
}
