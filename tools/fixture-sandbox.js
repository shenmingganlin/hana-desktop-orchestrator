import { runFixtureSandbox } from "../lib/fixture-sandbox.js";

export const name = "fixture-sandbox";
export const description = "运行纯内存协议 fixture sandbox，覆盖完整链路、过期 token、hash 错误、signature 错误和 executable token 阻断。不写真实 store，不截图，不调用 UIA，不执行桌面输入。";
export const parameters = {
  type: "object",
  properties: {},
};

export async function execute() {
  return JSON.stringify(runFixtureSandbox(), null, 2);
}
