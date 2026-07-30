import { buildControlSession, saveControlSession } from "../lib/control-session.js";
import { appendAuditEvent } from "../lib/audit-timeline.js";

export const name = "create-control-session";
export const description = "创建带 TTL、范围和动作额度的本地控制会话。创建任何权限模式的会话都需要显式本地确认。";
export const parameters = {
  type: "object",
  required: ["mode", "scope", "confirmation"],
  properties: {
    mode: { type: "string", enum: ["safe", "auto-review", "full-access"], description: "会话权限模式。full-access 仍受 destructive 动作确认约束。" },
    subject: { type: "string", description: "会话主体标识，默认 local-agent。" },
    scope: {
      type: "object",
      required: ["actions"],
      description: "会话允许的动作和目标范围。actions 支持 actionType、actionType:subtype 或 *。",
      properties: {
        actions: { type: "array", items: { type: "string" } },
        handles: { type: "array", items: { type: "string" } },
        processNames: { type: "array", items: { type: "string" } },
        allowKeyboardFallback: { type: "boolean", default: false },
        allowClipboardFallback: { type: "boolean", default: false },
      },
    },
    ttlMs: { type: "integer", description: "会话 TTL，范围 30 秒至 24 小时，默认 30 分钟。" },
    maxActions: { type: "integer", description: "最大动作尝试次数，范围 1 至 10000，默认 500。" },
    confirmation: { type: "string", description: "创建会话确认短语：I_UNDERSTAND_DESKTOP_INPUT" },
  },
};

const CONFIRMATION = "I_UNDERSTAND_DESKTOP_INPUT";

export async function execute(input = {}) {
  if (input.confirmation !== CONFIRMATION) {
    return JSON.stringify({
      ok: false,
      dryRun: true,
      type: "desktop-orchestrator-control-session",
      reason: `创建控制会话需要确认短语 ${CONFIRMATION}`,
      noDesktopActionExecuted: true,
    }, null, 2);
  }

  try {
    const session = buildControlSession({
      mode: input.mode,
      subject: input.subject,
      scope: input.scope,
      ttlMs: input.ttlMs,
      maxActions: input.maxActions,
    });
    const saved = saveControlSession(session);
    const result = { ...saved, type: "desktop-orchestrator-control-session", session: saved.ok ? session : null, noDesktopActionExecuted: true };
    appendAuditEvent("control-session-created", {
      ok: saved.ok,
      sessionId: session.sessionId,
      subject: session.subject,
      mode: session.mode,
      expiresAt: session.expiresAt,
      maxActions: session.maxActions,
      scope: session.scope,
    });
    return JSON.stringify(result, null, 2);
  } catch (error) {
    return JSON.stringify({ ok: false, dryRun: true, reason: "control-session-create-failed", message: error?.message || String(error), noDesktopActionExecuted: true }, null, 2);
  }
}
