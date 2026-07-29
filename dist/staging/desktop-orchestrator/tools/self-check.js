import { runSelfCheck } from "../lib/self-check.js";

export const name = "self-check";
export const description = "运行 Desktop Orchestrator 协议自检矩阵。只读本地 store 和 dry-run gate，不截图、不调用 UIA、不执行桌面输入。";
export const parameters = {
  type: "object",
  properties: {},
};

export async function execute() {
  return JSON.stringify(runSelfCheck(), null, 2);
}
