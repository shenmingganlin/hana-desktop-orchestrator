import { runProtocolTestMatrix } from "../lib/protocol-test-matrix.js";

export const name = "protocol-test-matrix";
export const description = "运行 Desktop Orchestrator 非破坏性协议测试矩阵。只测试 token 拒绝路径、dry-run gate 和安全标志，不截图、不调用 UIA、不执行桌面输入。";
export const parameters = {
  type: "object",
  properties: {},
};

export async function execute() {
  return JSON.stringify(runProtocolTestMatrix(), null, 2);
}
