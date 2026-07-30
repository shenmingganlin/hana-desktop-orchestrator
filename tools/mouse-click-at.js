// mouse-click-at.js — MODE 2: real mouse click at an absolute screen coordinate.
//
// Unlike click-element (mode 1, UIA Invoke, never touches the real cursor), this
// tool ACTUALLY moves the system cursor and presses the physical mouse button via
// SetCursorPos + mouse_event. It is the fallback when no UIA element matches a
// target (e.g. canvas / game / custom-drawn UI), or when a true double-click is
// required (UIA Invoke has no double-click semantics).
//
// SAFETY MODEL (mirrors click-element gates, plus stricter rules for blind clicks):
//   1. coords come from the caller (AI reads a screenshot, picks x,y)
//   2. the glowing overlay cursor flies to EXACTLY those coords (preview, no real
//      cursor movement) so the user can SEE where the real click will land
//   3. real click requires: dryRun=false + config.allowRealInput + confirmation
//   4. preview coords and real-click coords are the SAME variable — never diverge
//   5. every real click needs its own confirmation; no "approve once, click many"

import { buildApprovalBundle } from "../lib/approval-bundle.js";
import { saveApprovalBundle } from "../lib/approval-store.js";
import { buildCursorOverlay } from "../lib/cursor-overlay.js";
import { getCursorOverlayClient } from "../lib/cursor-overlay-client.js";
import { mouseClick } from "../lib/mouse-inject.js";
import { evaluateClickSafety } from "../lib/click-guard.js";
import { requireRealInputApproval, resolvePluginConfig, buildActionPlan, isRealActionBlocked, REAL_INPUT_CONFIRMATION, clampInteger } from "../lib/safety.js";
import { consumeControlSession } from "../lib/control-session.js";

export const name = "mouse-click-at";
export const description =
  "模式2：在绝对屏幕坐标处用真实鼠标点击/双击（会真的移动系统指针）。仅当 UIA 找不到可点元素时降级使用。真实点击前发光光标会先飞到同一坐标预演，需确认短语放行。";

export const parameters = {
  type: "object",
  required: ["x", "y", "expectedWindow"],
  properties: {
    x: { type: "integer", description: "点击的 X 坐标（物理屏幕像素，与 ui-tree 元素坐标同一坐标系）" },
    y: { type: "integer", description: "点击的 Y 坐标（物理屏幕像素）" },
    button: { type: "string", enum: ["left", "right", "middle"], default: "left", description: "鼠标按键" },
    clicks: { type: "integer", default: 1, minimum: 1, maximum: 2, description: "点击次数：1=单击, 2=双击" },
    sessionId: { type: "string", description: "可选。由 create-control-session 返回的控制会话 ID。" },
    label: { type: "string", description: "可选。预演光标旁显示的目标说明文字" },
    expectedWindow: {
      type: "object",
      description: "必填。声明这次点击的意图目标窗口；点击前护栏会校验点击坐标下实际命中的窗口是否匹配，不匹配则拒绝注入（防止焦点漂移误点）。",
      properties: {
        handle: { type: "string", description: "目标窗口句柄（最精确）" },
        processName: { type: "string", description: "目标进程名，如 ApplicationFrameHost / msedge" },
        processId: { type: "integer", description: "目标进程 PID" },
      },
    },
    skipGuard: { type: "boolean", default: false, deprecated: true, description: "已废弃。命中窗口校验始终启用；桌面空白点击请提供明确 expectedWindow 或改用其他工具。" },
    dryRun: { type: "boolean", default: true, description: "true=只预演发光光标+返回计划，不真实点击" },
    confirmation: { type: "string", description: `真实鼠标点击确认短语：${REAL_INPUT_CONFIRMATION}` },
    showCursor: { type: "boolean", default: true, description: "真实点击前是否显示发光光标飞向目标预演。默认 true。" },
  },
};

export async function execute(input = {}, toolCtx = {}) {
  const x = clampInteger(input.x, NaN);
  const y = clampInteger(input.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("x/y 必须是有效整数（物理屏幕像素）");
  }
  const button = ["left", "right", "middle"].includes(input.button) ? input.button : "left";
  const clicks = input.clicks >= 2 ? 2 : 1;
  const label = String(input.label || "").slice(0, 60);

  const config = resolvePluginConfig(toolCtx);
  const securityMode = String(config.securityMode || "normal").toLowerCase();
  const approval = requireRealInputApproval(input, config, {
    actionType: "mouse-click-at",
    action: { type: "real-mouse-click", button, clicks },
    target: input.expectedWindow || null,
  });

  // SINGLE SOURCE OF TRUTH for the target point. Preview and the real click both
  // read this exact object — they can never diverge.
  const target = { x, y };

  // PRE-INJECTION GUARD: always observe the point before building the evidence,
  // including dry-run, so the bundle records the same hit-window check that gates
  // a real click.
  const guard = evaluateClickSafety({ x: target.x, y: target.y, expected: input.expectedWindow || null });
  const plan = buildActionPlan({
    type: "mouse-click-at",
    risk: approval.risk || "high",
    target: { x, y, button, clicks },
    action: { type: "real-mouse-click", target: { x, y }, button, clicks },
    notes: [
      "MODE 2: real mouse injection — the system cursor WILL move and click.",
      approval.allowed ? "Real mouse click approved." : `Real action blocked: ${approval.reason}`,
      "Preview cursor and real click use the same coordinate (cannot diverge).",
      "Use only when UIA (mode 1) has no matching element; coordinates are blind.",
      guard ? `Pre-injection guard: ${guard.reason}` : "Pre-injection guard runs before the real click.",
    ],
  });

  const cursorOverlay = buildCursorOverlay({
    to: target,
    label: label || `${button} ${clicks > 1 ? "double" : "click"}`,
  });
  const approvalBundle = buildApprovalBundle({
    actionType: "mouse-click-at",
    risk: approval.risk || "sensitive",
    approval,
    plan,
    target: { x, y, button, clicks, expectedWindow: input.expectedWindow || null, guard },
    cursorOverlay,
    capability: { mode: 2, mechanism: "SetCursorPos+mouse_event", coordinateContract: "physical-pixels" },
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
  const initialApprovalBundleSave = saveApprovalBundle(approvalBundle, { source: "mouse-click-at" });
  let actionAllowed = approval.allowed && guard.allowed && initialApprovalBundleSave?.ok === true;
  let finalGuard = null;
  let finalApprovalBundleSave = initialApprovalBundleSave;
  let cursorFlight = null;
  let clickResult = null;
  let sessionConsumption = input.sessionId ? { ok: false, pending: true } : { ok: true, skipped: true };
  let blockedBy = !approval.allowed ? approval.reason : (!guard.allowed ? "click-guard" : (!initialApprovalBundleSave?.ok ? "approval-bundle-save-failed" : null));
  if (actionAllowed) {
    // Persisted evidence is the first gate before any visible preview or real input.
    if (input.showCursor !== false) {
      try {
        const overlayClient = getCursorOverlayClient({ pluginDir: toolCtx.pluginDir, dataDir: toolCtx.dataDir, log: toolCtx.log });
        const flyOk = await overlayClient.clickAt({
          toX: target.x,
          toY: target.y,
          durationMs: 520,
          clicks,
          label: label || `${button} ${clicks > 1 ? "double" : "click"}`,
        });
        cursorFlight = { requested: true, delivered: flyOk === true };
        if (!flyOk) {
          actionAllowed = false;
          blockedBy = "cursor-overlay-failed";
        } else {
          await new Promise((r) => setTimeout(r, 560));
        }
      } catch (err) {
        cursorFlight = { requested: true, delivered: false, error: err?.message || String(err) };
        actionAllowed = false;
        blockedBy = "cursor-overlay-failed";
      }
    }
    if (actionAllowed) {
      // Re-check after the preview delay to close the guard-to-injection TOCTOU gap.
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
        finalApprovalBundleSave = saveApprovalBundle(finalApprovalBundle, { source: "mouse-click-at-final" });
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
      const res = mouseClick({ x: target.x, y: target.y, button, clicks });
      clickResult = { ok: res.ok === true, mode: "mouse-inject", button, clicks, target };
      if (!res.ok) clickResult.error = res.raw?.error || res.raw?.stderr || "click-failed";
    }
  }

  return JSON.stringify({
    dryRun: !approval.allowed,
    blocked: isRealActionBlocked({ approvalAllowed: approval.allowed, actionAllowed }),
    blockedBy,

    approval,
    target: { x, y, button, clicks },
    guard,
    finalGuard,
    plan,
    cursorOverlay,
    cursorFlight,
    clickResult,
    approvalBundleSave: finalApprovalBundleSave,
    sessionConsumption,
    config: {
      allowRealInput: approval.allowed,
      allowRealMouseMove: config.allowRealMouseMove === true || securityMode === "maximum",
      securityMode: config.securityMode || "normal",
    },
    safety: {
      mode: 2,
      mechanism: "SetCursorPos+mouse_event",
      movesRealCursor: actionAllowed,
      previewMatchesClick: true,
      requiresPerClickConfirmation: true,
      guardChecksHitWindow: true,
      approvalBundlePersistedBeforeInput: finalApprovalBundleSave?.ok === true,
    },
  }, null, 2);
}
