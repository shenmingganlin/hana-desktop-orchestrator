// mouse-drag.js — MODE 2: real mouse drag from one screen point to another.
//
// Presses the physical mouse button at (fromX,fromY), moves to (toX,toY) in
// interpolated steps, then releases — via SetCursorPos + mouse_event. UIA has no
// drag semantics, so this is the only way to drag sliders, reorder lists, draw,
// or pan canvases. It ACTUALLY moves the system cursor.
//
// SAFETY: same gates as mouse-click-at. The glow cursor previews the whole drag
// path (fly to start, press, drag with trail, release) BEFORE the real drag, and
// the preview uses the SAME from/to coordinates as the real injection.

import { buildApprovalBundle } from "../lib/approval-bundle.js";
import { saveApprovalBundle } from "../lib/approval-store.js";
import { buildCursorOverlay } from "../lib/cursor-overlay.js";
import { getCursorOverlayClient } from "../lib/cursor-overlay-client.js";
import { mouseDrag } from "../lib/mouse-inject.js";
import { evaluateClickSafety } from "../lib/click-guard.js";
import { requireRealInputApproval, resolvePluginConfig, buildActionPlan, isRealActionBlocked, REAL_INPUT_CONFIRMATION, clampInteger } from "../lib/safety.js";
import { consumeControlSession } from "../lib/control-session.js";

export const name = "mouse-drag";
export const description =
  "模式2：用真实鼠标从起点拖动到终点（会真的按住并移动系统指针）。用于拖滑块、拖拽排序、画布平移等 UIA 无法表达的操作。真实拖动前发光光标会先沿同一路径预演，需确认短语放行。";

export const parameters = {
  type: "object",
  required: ["fromX", "fromY", "toX", "toY", "expectedWindow"],
  properties: {
    fromX: { type: "integer", description: "拖动起点 X（物理屏幕像素）" },
    fromY: { type: "integer", description: "拖动起点 Y（物理屏幕像素）" },
    toX: { type: "integer", description: "拖动终点 X（物理屏幕像素）" },
    toY: { type: "integer", description: "拖动终点 Y（物理屏幕像素）" },
    button: { type: "string", enum: ["left", "right", "middle"], default: "left", description: "拖动用的鼠标按键" },
    sessionId: { type: "string", description: "可选。由 create-control-session 返回的控制会话 ID。" },
    label: { type: "string", description: "可选。预演光标旁显示的说明文字" },
    expectedWindow: {
      type: "object",
      description: "必填。声明拖拽起点的意图目标窗口；拖拽前护栏会校验起点坐标下实际命中的窗口是否匹配，不匹配则拒绝注入。",
      properties: {
        handle: { type: "string", description: "目标窗口句柄" },
        processName: { type: "string", description: "目标进程名" },
        processId: { type: "integer", description: "目标进程 PID" },
      },
    },
    skipGuard: { type: "boolean", default: false, deprecated: true, description: "已废弃。起点命中窗口校验始终启用。" },
    dryRun: { type: "boolean", default: true, description: "true=只预演发光光标+返回计划，不真实拖动" },
    confirmation: { type: "string", description: `真实鼠标拖动确认短语：${REAL_INPUT_CONFIRMATION}` },
    showCursor: { type: "boolean", default: true, description: "真实拖动前是否显示发光光标沿路径预演。默认 true。" },
  },
};

export async function execute(input = {}, toolCtx = {}) {
  const fromX = clampInteger(input.fromX, NaN);
  const fromY = clampInteger(input.fromY, NaN);
  const toX = clampInteger(input.toX, NaN);
  const toY = clampInteger(input.toY, NaN);
  if (![fromX, fromY, toX, toY].every(Number.isFinite)) {
    throw new Error("fromX/fromY/toX/toY 必须都是有效整数（物理屏幕像素）");
  }
  const button = ["left", "right", "middle"].includes(input.button) ? input.button : "left";
  const label = String(input.label || "").slice(0, 60);

  const config = resolvePluginConfig(toolCtx);
  const approval = requireRealInputApproval(input, config, {
    actionType: "mouse-drag",
    action: { type: "real-mouse-drag", button },
    target: input.expectedWindow || null,
  });

  // Single source of truth for the path. Preview and real drag both read these.
  const path = { fromX, fromY, toX, toY };
  // Always observe the start point so the bundle records the same window guard that
  // gates a real drag. This observation does not move the cursor.
  const guard = evaluateClickSafety({ x: path.fromX, y: path.fromY, expected: input.expectedWindow || null });

  const plan = buildActionPlan({
    type: "mouse-drag",
    risk: approval.risk || "high",
    target: { fromX, fromY, toX, toY, button },
    action: { type: "real-mouse-drag", path, button },
    notes: [
      "MODE 2: real mouse injection — the system cursor WILL press, move, release.",
      approval.allowed ? "Real mouse drag approved." : `Real action blocked: ${approval.reason}`,
      "Preview path and real drag use the same coordinates (cannot diverge).",
      guard ? `Pre-injection guard: ${guard.reason}` : "Pre-injection guard runs before the real drag.",
    ],
  });

  const cursorOverlay = buildCursorOverlay({
    from: { x: fromX, y: fromY },
    to: { x: toX, y: toY },
    durationMs: 900,
    label: label || "drag",
  });
  const approvalBundle = buildApprovalBundle({
    actionType: "mouse-drag",
    risk: approval.risk || "sensitive",
    approval,
    plan,
    target: { fromX, fromY, toX, toY, button, expectedWindow: input.expectedWindow || null, guard },
    cursorOverlay,
    capability: { mode: 2, mechanism: "SetCursorPos+mouse_event", coordinateContract: "physical-pixels" },
    safetyNotes: [
      "Raw coordinate action has no lease-bound element; the start-point hit-window guard is the required freshness check.",
      "Initial approval evidence is preview-only; the approved bundle is persisted only after the final guard.",
    ],
    safetyRequirements: {
      realActionBlocked: true,
      requiresFreshLease: false,
      requiresSignatureGuard: false,
      requiresWindowGuard: true,
    },
  });
  const initialApprovalBundleSave = saveApprovalBundle(approvalBundle, { source: "mouse-drag" });
  const mouseMoveAllowed = config.allowRealMouseMove === true;
  let actionAllowed = approval.allowed && guard.allowed && mouseMoveAllowed && initialApprovalBundleSave?.ok === true;
  let finalGuard = null;
  let finalApprovalBundleSave = initialApprovalBundleSave;
  let cursorFlight = null;
  let dragResult = null;
  let sessionConsumption = input.sessionId ? { ok: false, pending: true } : { ok: true, skipped: true };
  let blockedBy = !approval.allowed ? approval.reason : (!guard.allowed ? "click-guard" : (!mouseMoveAllowed ? "allowRealMouseMove-disabled" : (!initialApprovalBundleSave?.ok ? "approval-bundle-save-failed" : null)));
  if (actionAllowed) {
    if (input.showCursor !== false) {
      try {
        const overlayClient = getCursorOverlayClient({ pluginDir: toolCtx.pluginDir, dataDir: toolCtx.dataDir, log: toolCtx.log });
        const flyOk = await overlayClient.dragTo({
          fromX: path.fromX,
          fromY: path.fromY,
          toX: path.toX,
          toY: path.toY,
          durationMs: 900,
          label: label || "drag",
        });
        cursorFlight = { requested: true, delivered: flyOk === true };
        if (!flyOk) {
          actionAllowed = false;
          blockedBy = "cursor-overlay-failed";
        } else {
          await new Promise((r) => setTimeout(r, 1500));
        }
      } catch (err) {
        cursorFlight = { requested: true, delivered: false, error: err?.message || String(err) };
        actionAllowed = false;
        blockedBy = "cursor-overlay-failed";
      }
    }
    if (actionAllowed) {
      finalGuard = evaluateClickSafety({ x: path.fromX, y: path.fromY, expected: input.expectedWindow || null });
      if (!finalGuard.allowed) {
        actionAllowed = false;
        blockedBy = "click-guard-recheck";
      } else {
        const finalApprovalBundle = buildApprovalBundle({
          ...approvalBundle,
          target: { ...approvalBundle.target, guard: finalGuard },
          safetyNotes: [...(approvalBundle.safety?.notes || []), "Final start-point hit-window guard re-check passed immediately before input."],
          safetyRequirements: {
            realActionBlocked: false,
            requiresFreshLease: false,
            requiresSignatureGuard: false,
            requiresWindowGuard: true,
          },
        });
        finalApprovalBundleSave = saveApprovalBundle(finalApprovalBundle, { source: "mouse-drag-final" });
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
      const res = mouseDrag({ fromX: path.fromX, fromY: path.fromY, toX: path.toX, toY: path.toY, button });
      dragResult = { ok: res.ok === true, mode: "mouse-inject", button, path };
      if (!res.ok) dragResult.error = res.raw?.error || res.raw?.stderr || "drag-failed";
    }
  }

  return JSON.stringify({
    dryRun: !approval.allowed,
    blocked: isRealActionBlocked({ approvalAllowed: approval.allowed, actionAllowed }),
    blockedBy,
    approval,
    path: { fromX, fromY, toX, toY, button },
    guard,
    finalGuard,
    plan,
    cursorOverlay,
    cursorFlight,
    dragResult,
    approvalBundleSave: finalApprovalBundleSave,
    sessionConsumption,
    config: {
      allowRealInput: approval.allowed,
      allowRealMouseMove: config.allowRealMouseMove === true,
    },
    safety: {
      mode: 2,
      mechanism: "SetCursorPos+mouse_event",
      movesRealCursor: actionAllowed,
      previewMatchesDrag: true,
      requiresPerActionConfirmation: true,
      guardChecksStartWindow: true,
      approvalBundlePersistedBeforeInput: finalApprovalBundleSave?.ok === true,
    },
  }, null, 2);
}
