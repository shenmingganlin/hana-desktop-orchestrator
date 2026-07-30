import { appendAuditEvent } from "../lib/audit-timeline.js";
import { revokeControlSession } from "../lib/control-session.js";

export const name = "revoke-control-session";
export const description = "撤销本地控制会话。撤销是不可逆的会话状态变更，需要显式本地确认。";
export const parameters = {
  type: "object",
  required: ["sessionId", "confirmation"],
  properties: {
    sessionId: { type: "string", description: "要撤销的 sessionId。" },
    confirmation: { type: "string", description: "撤销确认短语：I_UNDERSTAND_DESKTOP_INPUT" },
  },
};

const CONFIRMATION = "I_UNDERSTAND_DESKTOP_INPUT";

export async function execute(input = {}) {
  if (input.confirmation !== CONFIRMATION) {
    return JSON.stringify({
      ok: false,
      dryRun: true,
      type: "desktop-orchestrator-control-session-revocation",
      reason: `撤销控制会话需要确认短语 ${CONFIRMATION}`,
      noDesktopActionExecuted: true,
    }, null, 2);
  }
  try {
    const result = revokeControlSession(input.sessionId);
    appendAuditEvent("control-session-revoked", {
      ok: result.ok,
      sessionId: result.sessionId || input.sessionId || null,
      reason: result.reason || null,
    });
    return JSON.stringify({ ...result, type: "desktop-orchestrator-control-session-revocation", noDesktopActionExecuted: true }, null, 2);
  } catch (error) {
    return JSON.stringify({ ok: false, dryRun: true, reason: "control-session-revoke-failed", message: error?.message || String(error), noDesktopActionExecuted: true }, null, 2);
  }
}
