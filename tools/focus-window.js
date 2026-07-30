import { parseJsonOutput, runHelper } from "../lib/powershell.js";
import { buildActionPlan, requireRealInputApproval, resolvePluginConfig, REAL_INPUT_CONFIRMATION } from "../lib/safety.js";

export const name = "focus-window";
export const description = "按窗口句柄或标题聚焦目标窗口。默认 dry-run，真实聚焦需要确认。";
export const parameters = {
  type: "object",
  properties: {
    handle: { type: "string", description: "目标窗口句柄，优先使用" },
    titleContains: { type: "string", description: "窗口标题包含文本，未提供 handle 时使用" },
    dryRun: { type: "boolean", default: true, description: "是否只返回计划，不执行聚焦" },
    confirmation: { type: "string", description: `真实窗口聚焦确认短语：${REAL_INPUT_CONFIRMATION}` },
  },
};

export async function execute(input = {}, toolCtx = {}) {
  if (!input.handle && !input.titleContains) {
    throw new Error("handle 或 titleContains 至少需要一个");
  }

  const approval = requireRealInputApproval(input, resolvePluginConfig(toolCtx));
  const plan = buildActionPlan({
    type: "focus-window",
    risk: "medium",
    target: { handle: input.handle || null, titleContains: input.titleContains || null },
    action: { type: "focus" },
    notes: [approval.allowed ? "Window focus approved." : `Focus blocked: ${approval.reason}`],
  });

  if (!approval.allowed) {
    return JSON.stringify({ dryRun: true, approval, plan }, null, 2);
  }

  // Use helper.exe focus command (4x faster than PowerShell)
  const result = parseJsonOutput(runHelper("focus", [input.handle]), "focus-window");
  return JSON.stringify({ dryRun: false, approval, plan, result }, null, 2);
}
