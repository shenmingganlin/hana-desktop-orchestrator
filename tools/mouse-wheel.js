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

import { getCursorOverlayClient } from "../lib/cursor-overlay-client.js";
import { mouseWheel } from "../lib/mouse-inject.js";
import { evaluateClickSafety } from "../lib/click-guard.js";
import {
  requireRealInputApproval,
  resolvePluginConfig,
  buildActionPlan,
  REAL_INPUT_CONFIRMATION,
  clampInteger,
} from "../lib/safety.js";

export const name = "mouse-wheel";
export const description =
  "模式2：在绝对屏幕坐标处用真实鼠标滚轮滚动（会先把系统指针移到该点，因为 Windows 按光标位置路由滚轮事件）。用于滚动长列表、翻页、缩放画布。notches 正=上/右，负=下/左。真实滚动前发光光标会先飞到同一坐标预演，需确认短语放行。";

export const parameters = {
  type: "object",
  required: ["x", "y"],
  properties: {
    x: { type: "integer", description: "滚动点的 X 坐标（物理屏幕像素，与 ui-tree 元素坐标同一坐标系）" },
    y: { type: "integer", description: "滚动点的 Y 坐标（物理屏幕像素）" },
    notches: {
      type: "integer",
      default: -3,
      description: "滚动格数。正值=向上/向右，负值=向下/向左。一格约等于真实滚轮一档。范围 ±30。",
    },
    axis: { type: "string", enum: ["vertical", "horizontal"], default: "vertical", description: "滚动轴向。水平滚动需要应用支持。" },
    label: { type: "string", description: "可选。预演光标旁显示的目标说明文字" },
    expectedWindow: {
      type: "object",
      description: "可选但强烈建议：声明这次滚动的意图目标窗口。滚动前护栏会校验坐标下实际命中的窗口是否匹配，不匹配则拒绝注入。",
      properties: {
        handle: { type: "string", description: "目标窗口句柄（最精确）" },
        processName: { type: "string", description: "目标进程名" },
        processId: { type: "integer", description: "目标进程 PID" },
      },
    },
    skipGuard: { type: "boolean", default: false, description: "显式跳过命中窗口校验（罕见场景）。默认 false。" },
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

  const approval = requireRealInputApproval(input, resolvePluginConfig(toolCtx));

  // SINGLE SOURCE OF TRUTH: preview and real scroll both read this exact object.
  const target = { x, y };

  let cursorFlight = null;
  let scrollResult = null;
  let guard = null;

  if (approval.allowed) {
    // 0) PRE-INJECTION GUARD — same focus-drift protection as blind clicks.
    if (input.skipGuard !== true) {
      guard = evaluateClickSafety({ x: target.x, y: target.y, expected: input.expectedWindow || null });
      if (!guard.allowed) {
        const plan = buildActionPlan({
          type: "mouse-wheel",
          risk: "medium",
          target: { x, y, notches, axis },
          action: { type: "real-mouse-wheel", target: { x, y }, notches, axis },
          notes: [
            "MODE 2: real wheel injection — BLOCKED by pre-injection guard.",
            `Guard reason: ${guard.reason}`,
            "The window under the scroll point did not match the expected target (focus drift?).",
            "Re-read the screen to get fresh coordinates, ensure the target is visible, then retry.",
          ],
        });
        return JSON.stringify({
          dryRun: false,
          approval,
          blocked: true,
          blockedBy: "click-guard",
          target: { x, y, notches, axis },
          guard,
          plan,
          cursorFlight: null,
          scrollResult: null,
          safety: {
            mode: 2,
            mechanism: "SetCursorPos+mouse_event(WHEEL)",
            movesRealCursor: false,
            guardBlocked: true,
            note: "No cursor movement and no scroll occurred; the guard refused before injection.",
          },
        }, null, 2);
      }
    }
    // 1) Preview: fly the glow cursor to the EXACT point the real scroll will use.
    //    flyTo (not clickAt) — scrolling has no press, so no click ripple.
    if (input.showCursor !== false) {
      try {
        const overlayClient = getCursorOverlayClient({ pluginDir: toolCtx.pluginDir, dataDir: toolCtx.dataDir, log: toolCtx.log });
        const flyOk = await overlayClient.flyTo({
          toX: target.x,
          toY: target.y,
          durationMs: 500,
          label: label || `scroll ${axis === "horizontal" ? "↔" : "↕"} ${notches > 0 ? "+" : ""}${notches}`,
        });
        cursorFlight = { requested: true, delivered: flyOk === true };
        if (flyOk) await new Promise((r) => setTimeout(r, 540));
      } catch (err) {
        cursorFlight = { requested: true, delivered: false, error: err?.message || String(err) };
      }
    }
    // 2) Real wheel injection at the SAME target.
    const res = mouseWheel({ x: target.x, y: target.y, notches, axis });
    scrollResult = { ok: res.ok === true, mode: "mouse-inject", notches, axis, target };
    if (!res.ok) scrollResult.error = res.raw?.error || res.raw?.stderr || "scroll-failed";
  }

  const plan = buildActionPlan({
    type: "mouse-wheel",
    risk: "medium",
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

  // In dry-run, still probe what sits under the point for the preview.
  if (!approval.allowed && input.skipGuard !== true && guard === null) {
    guard = evaluateClickSafety({ x: target.x, y: target.y, expected: input.expectedWindow || null });
  }

  return JSON.stringify({
    dryRun: !approval.allowed,
    approval,
    target: { x, y, notches, axis },
    guard,
    plan,
    cursorFlight,
    scrollResult,
    safety: {
      mode: 2,
      mechanism: "SetCursorPos+mouse_event(WHEEL)",
      movesRealCursor: approval.allowed,
      previewMatchesScroll: true,
      requiresPerActionConfirmation: true,
      guardChecksHitWindow: input.skipGuard !== true,
    },
  }, null, 2);
}
