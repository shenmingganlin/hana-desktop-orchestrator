import { runCockpitSummary } from "../lib/cockpit-summary.js";

export const name = "cockpit-summary";
export const description = "汇总 Desktop Orchestrator cockpit 健康状态，聚合 self-check、protocol matrix 和 fixture sandbox。只做 dry-run/纯内存协议检查，不截图、不调用 UIA、不执行桌面输入。";
export const parameters = {
  type: "object",
  properties: {},
};

export async function execute() {
  return JSON.stringify(runCockpitSummary(), null, 2);
}
