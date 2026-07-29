import { buildActionPlan, clampInteger } from "../lib/safety.js";

export const name = "plan-action";
export const description = "把桌面操作意图转换成显式的受保护动作计划，不执行真实输入。";
export const parameters = {
  type: "object",
  required: ["intent"],
  properties: {
    intent: { type: "string", description: "自然语言操作意图" },
    windowTitle: { type: "string", description: "目标窗口标题，可选" },
    actionType: { type: "string", enum: ["click", "type", "scroll", "focus", "inspect"], default: "inspect" },
    x: { type: "integer", description: "候选点击 X 坐标" },
    y: { type: "integer", description: "候选点击 Y 坐标" },
    text: { type: "string", description: "候选输入文本" },
  },
};

export async function execute(input = {}) {
  const actionType = input.actionType || "inspect";
  const plan = buildActionPlan({
    type: "desktop-action-plan",
    risk: ["click", "type"].includes(actionType) ? "high" : "medium",
    target: {
      windowTitle: input.windowTitle || null,
      intent: input.intent,
    },
    action: {
      type: actionType,
      x: input.x === undefined ? null : clampInteger(input.x),
      y: input.y === undefined ? null : clampInteger(input.y),
      textLength: input.text ? String(input.text).length : 0,
    },
    notes: [
      "This tool only plans. Use protected-click or future semantic tools to execute.",
      "Prefer window and element targets over raw coordinates.",
      "This plugin's UIA path (ui-tree + click-element/type-element) needs NO vision model: it locates elements via the UI Automation text tree, not screenshots. When a vision model is unavailable (e.g. COMPUTER_USE_REQUIRES_VISION_MODEL), prefer this UIA path over screenshot-based computer use.",
      "Mode 1 (UIA Invoke) is safest: signature-guarded, no real cursor movement. Fall back to Mode 2 (mouse-click-at/mouse-drag) only when no UIA element matches; Mode 2 is blind but now pre-checks the window under the click point.",
    ],
  });

  return JSON.stringify(plan, null, 2);
}
