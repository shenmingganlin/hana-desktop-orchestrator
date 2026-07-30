import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const storePath = path.join(os.tmpdir(), `hana-control-session-matrix-${process.pid}-${Date.now()}.json`);
process.env.HANA_DESKTOP_ORCHESTRATOR_CONTROL_SESSION_STORE = storePath;

const {
  buildControlSession,
  controlSessionStorePath,
  getControlSession,
  hashControlSession,
  matchesControlSessionScope,
  revokeControlSession,
  saveControlSession,
  consumeControlSession,
  validateControlSession,
} = await import("../lib/control-session.js");
const { decidePermission } = await import("../lib/permission-policy.js");

const cases = [];
function check(name, passed, details = {}) {
  cases.push({ name, passed: Boolean(passed), ...details });
}

function makeSession(overrides = {}) {
  return buildControlSession({
    mode: "full-access",
    subject: "matrix",
    scope: { actions: ["focus-window"], handles: ["0xabc"], processNames: ["notepad.exe"] },
    ttlMs: 60_000,
    maxActions: 3,
    ...overrides,
  });
}

try {
  const session = makeSession();
  check("store-path-is-isolated", controlSessionStorePath() === storePath, { storePath: controlSessionStorePath() });
  check("session-hash-present", session.sessionHash === hashControlSession(session));
  check("session-validation-passes", validateControlSession(session).ok === true);

  const saved = saveControlSession(session);
  check("session-save", saved.ok === true, { reason: saved.reason || null });
  const loaded = getControlSession(session.sessionId);
  check("session-load", loaded.ok === true && loaded.session.sessionId === session.sessionId);

  const permission = decidePermission({
    input: { dryRun: false, sessionId: session.sessionId },
    config: { allowRealInput: true, permissionMode: "safe" },
    actionType: "focus-window",
    action: { type: "focus" },
    target: { handle: "0xabc", processName: "notepad.exe" },
  });
  check("session-mode-overrides-global-mode", permission.allowed === true && permission.mode === "full-access", { permission });

  const missing = decidePermission({
    input: { dryRun: false, sessionId: "missing-session" },
    config: { allowRealInput: true, permissionMode: "full-access" },
    actionType: "focus-window",
    target: { handle: "0xabc" },
  });
  check("missing-session-fails-closed", missing.allowed === false && missing.reason === "control-session-not-found", { reason: missing.reason });

  const wrongHandle = matchesControlSessionScope(session, {
    actionType: "focus-window",
    target: { handle: "0xdef", processName: "notepad.exe" },
  });
  check("handle-scope-blocks", wrongHandle.ok === false && wrongHandle.reason === "control-session-window-out-of-scope", { reason: wrongHandle.reason });

  const wrongProcess = matchesControlSessionScope(session, {
    actionType: "focus-window",
    target: { handle: "0xabc", processName: "msedge.exe" },
  });
  check("process-scope-blocks", wrongProcess.ok === false && wrongProcess.reason === "control-session-process-out-of-scope", { reason: wrongProcess.reason });

  const wrongAction = matchesControlSessionScope(session, { actionType: "manage-window", action: { type: "restore" }, target: { handle: "0xabc" } });
  check("action-scope-blocks", wrongAction.ok === false && wrongAction.reason === "control-session-action-out-of-scope", { reason: wrongAction.reason });

  const fallbackSession = makeSession({ scope: { actions: ["type-element"], allowKeyboardFallback: false } });
  check("keyboard-fallback-default-blocks", matchesControlSessionScope(fallbackSession, { actionType: "type-element", capability: { fallback: "keyboard" } }).reason === "control-session-keyboard-fallback-not-allowed");
  const fallbackAllowed = makeSession({ scope: { actions: ["type-element"], allowKeyboardFallback: true } });
  check("keyboard-fallback-explicitly-allowed", matchesControlSessionScope(fallbackAllowed, { actionType: "type-element", capability: { fallback: "keyboard" } }).ok === true);

  const tampered = JSON.parse(fs.readFileSync(storePath, "utf8"));
  tampered.records[0].subject = "tampered";
  fs.writeFileSync(storePath, JSON.stringify(tampered), "utf8");
  const tamperedResult = getControlSession(session.sessionId);
  check("hash-tamper-fails-closed", tamperedResult.ok === false && tamperedResult.reason === "control-session-hash-mismatch", { reason: tamperedResult.reason });

  fs.writeFileSync(storePath, JSON.stringify({ version: 1, records: [session] }), "utf8");
  const revoked = revokeControlSession(session.sessionId);
  check("revoke-succeeds", revoked.ok === true);
  const revokedResult = getControlSession(session.sessionId);
  check("revoked-session-fails-closed", revokedResult.ok === false && revokedResult.reason === "control-session-revoked", { reason: revokedResult.reason });

  const limited = makeSession({ maxActions: 1, scope: { actions: ["focus-window"] } });
  check("limited-session-save", saveControlSession(limited).ok === true);
  const consumed = consumeControlSession(limited.sessionId);
  check("action-count-consumes-once", consumed.ok === true && consumed.session.actionCount === 1);
  const overLimit = consumeControlSession(limited.sessionId);
  check("action-limit-blocks", overLimit.ok === false && overLimit.reason === "control-session-action-limit", { reason: overLimit.reason });

  const expired = makeSession({ now: Date.now() - 120_000, ttlMs: 30_000 });
  check("expired-session-validation-blocks", validateControlSession(expired).reason === "control-session-expired");
} finally {
  try { fs.rmSync(storePath, { force: true }); } catch {}
}

const summary = {
  total: cases.length,
  passed: cases.filter((item) => item.passed).length,
  failed: cases.filter((item) => !item.passed).length,
  allPassed: cases.every((item) => item.passed),
};
const result = {
  ok: summary.allPassed,
  type: "desktop-orchestrator-control-session-matrix",
  summary,
  cases,
  safety: {
    isolatedStore: true,
    noDesktopActionExecuted: true,
    noScreenshotCaptured: true,
    noUiaInvoke: true,
    noMouseOrKeyboardInput: true,
  },
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
