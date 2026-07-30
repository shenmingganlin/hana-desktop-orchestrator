import { getControlSession } from "../lib/control-session.js";

export const name = "inspect-control-session";
export const description = "读取本地控制会话状态、范围、TTL 和动作额度。只读，不执行桌面动作。";
export const parameters = {
  type: "object",
  required: ["sessionId"],
  properties: {
    sessionId: { type: "string", description: "create-control-session 返回的 sessionId。" },
  },
};

export async function execute(input = {}) {
  const result = getControlSession(input.sessionId, { includeExpired: true });
  return JSON.stringify({
    ...result,
    type: "desktop-orchestrator-control-session-inspection",
    noDesktopActionExecuted: true,
  }, null, 2);
}
