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

import { getCursorOverlayClient } from "../lib/cursor-overlay-client.js";
import { mouseDrag } from "../lib/mouse-inject.js";
import { evaluateClickSafety } from "../lib/click-guard.js";
import { requireRealInputApproval, resolvePluginConfig, buildActionPlan, REAL_INPUT_CONFIRMATION, clampInteger } from "../lib/safety.js";

export const name = "mouse-drag";
export const description =
  "模式2：用真实鼠标从起点拖动到终点（会真的按住并移动系统指针）。用于拖滑块、拖拽排序、画布平移等 UIA 无法表达的操作。真实拖动前发光光标会先沿同一路径预演，需确认短语放行。";

export const parameters = {
  type: "object",
  required: ["fromX", "fromY", "toX", "toY"],
  properties: {
    fromX: { type: "integer", description: "拖动起点 X（物理屏幕像素）" },
    fromY: { type: "integer", description: "拖动起点 Y（物理屏幕像素）" },
    toX: { type: "integer", description: "拖动终点 X（物理屏幕像素）" },
    toY: { type: "integer", description: "拖动终点 Y（物理屏幕像素）" },
    button: { type: "string", enum: ["left", "right", "middle"], default: "left", description: "拖动用的鼠标按键" },
    label: { type: "string", description: "可选。预演光标旁显示的说明文字" },
    expectedWindow: {
      type: "object",
      description: "可选但强烈建议：声明拖拽起点的意图目标窗口。拖拽前护栏会校验起点坐标下实际命中的窗口是否匹配，不匹配则拒绝注入。",
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

  const approval = requireRealInputApproval(input, resolvePluginConfig(toolCtx));

  // Single source of truth for the path. Preview and real drag both read these.
  const path = { fromX, fromY, toX, toY };

  let cursorFlight = null;
  let dragResult = null;
  let guard = null;

  if (approval.allowed) {
    // PRE-INJECTION GUARD: verify the drag START point actually sits on the intended
    // window before pressing the real mouse (focus drift protection).
    guard = evaluateClickSafety({ x: path.fromX, y: path.fromY, expected: input.expectedWindow || null });
    if (!guard.allowed) {
      const plan = buildActionPlan({
        type: "mouse-drag",
        risk: "high",
        target: { fromX, fromY, toX, toY, button },
        action: { type: "real-mouse-drag", path, button },
        notes: [
          "MODE 2: real mouse drag — BLOCKED by pre-injection guard.",
          `Guard reason: ${guard.reason}`,
          "The window under the drag start point did not match the expected target.",
          "Re-read ui-tree for fresh coordinates, ensure the target window is foreground, then retry.",
        ],
      });
      return JSON.stringify({
        dryRun: false,
        approval,
        blocked: true,
        blockedBy: "click-guard",
        path: { fromX, fromY, toX, toY, button },
        guard,
        plan,
        cursorFlight: null,
        dragResult: null,
        safety: {
          mode: 2,
          mechanism: "SetCursorPos+mouse_event",
          movesRealCursor: false,
          guardBlocked: true,
          note: "No cursor movement and no drag occurred; the guard refused before injection.",
        },
      }, null, 2);
    }

  if (input.showCursor !== false) {      try {
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
        // Let the full preview (fly+press+drag+release) play before the real drag.
        if (flyOk) await new Promise((r) => setTimeout(r, 1500));
      } catch (err) {
        cursorFlight = { requested: true, delivered: false, error: err?.message || String(err) };
      }
    }
    const res = mouseDrag({ fromX: path.fromX, fromY: path.fromY, toX: path.toX, toY: path.toY, button });
    dragResult = { ok: res.ok === true, mode: "mouse-inject", button, path };
    if (!res.ok) dragResult.error = res.raw?.error || res.raw?.stderr || "drag-failed";
  }

  const plan = buildActionPlan({
    type: "mouse-drag",
    risk: "high",
    target: { fromX, fromY, toX, toY, button },
    action: { type: "real-mouse-drag", path, button },
    notes: [
      "MODE 2: real mouse injection — the system cursor WILL press, move, release.",
      approval.allowed ? "Real mouse drag approved." : `Real action blocked: ${approval.reason}`,
      "Preview path and real drag use the same coordinates (cannot diverge).",
      guard ? `Pre-injection guard: ${guard.reason}` : "Pre-injection guard runs before the real drag.",
    ],
  });

  // In dry-run, probe what sits under the drag start so the user can preview it.
  if (!approval.allowed && guard === null) {
    guard = evaluateClickSafety({ x: path.fromX, y: path.fromY, expected: input.expectedWindow || null });
  }

  return JSON.stringify({
    dryRun: !approval.allowed,
    approval,
    path: { fromX, fromY, toX, toY, button },
    guard,
    plan,
    cursorFlight,
    dragResult,
    safety: {
      mode: 2,
      mechanism: "SetCursorPos+mouse_event",
      movesRealCursor: approval.allowed,
      previewMatchesDrag: true,
      guardChecksStartWindow: true,
    },
  }, null, 2);
}
