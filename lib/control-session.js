import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const CONTROL_SESSION_MODES = Object.freeze(["safe", "auto-review", "full-access"]);

export const CONTROL_SESSION_VERSION = 1;
const DEFAULT_STORE_DIR = path.join(os.tmpdir(), "hana-desktop-orchestrator");
const STORE_PATH = process.env.HANA_DESKTOP_ORCHESTRATOR_CONTROL_SESSION_STORE
  ? path.resolve(process.env.HANA_DESKTOP_ORCHESTRATOR_CONTROL_SESSION_STORE)
  : path.join(DEFAULT_STORE_DIR, "control-session-store.json");
const STORE_DIR = path.dirname(STORE_PATH);
const MAX_RECORDS = 30;
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MIN_TTL_MS = 30 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ACTIONS = 500;
const MAX_ACTIONS = 10_000;

function stableStringify(value, omitHash = false) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.keys(value)
    .filter((key) => !(omitHash && key === "sessionHash") && value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(",")}}`;
}

export function hashControlSession(session) {
  return crypto.createHash("sha256").update(stableStringify(session, true)).digest("hex");
}

function normalizeTtlMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_TTL_MS;
  return Math.max(MIN_TTL_MS, Math.min(Math.floor(number), MAX_TTL_MS));
}

function normalizeMaxActions(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_MAX_ACTIONS;
  return Math.max(1, Math.min(Math.floor(number), MAX_ACTIONS));
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 200);
}

export function normalizeSessionScope(scope = {}) {
  const actions = normalizeStringList(scope.actions);
  const handles = normalizeStringList(scope.handles);
  const processNames = normalizeStringList(scope.processNames).map((value) => value.toLowerCase());
  return {
    actions,
    handles,
    processNames,
    allowKeyboardFallback: scope.allowKeyboardFallback === true,
    allowClipboardFallback: scope.allowClipboardFallback === true,
  };
}

export function buildControlSession({
  mode,
  subject = "local-agent",
  scope = {},
  ttlMs,
  maxActions,
  source = "local",
  now = Date.now(),
  sessionId = crypto.randomUUID(),
} = {}) {
  const normalizedMode = String(mode || "").trim().toLowerCase();
  if (!CONTROL_SESSION_MODES.includes(normalizedMode)) {
    throw new Error(`unsupported-control-session-mode: ${mode}`);
  }
  const normalizedScope = normalizeSessionScope(scope);
  if (normalizedScope.actions.length === 0) {
    throw new Error("control-session-scope-actions-required");
  }
  const effectiveTtlMs = normalizeTtlMs(ttlMs);
  const effectiveMaxActions = normalizeMaxActions(maxActions);
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + effectiveTtlMs).toISOString();
  const session = {
    type: "desktop-orchestrator-control-session",
    version: CONTROL_SESSION_VERSION,
    sessionId: String(sessionId),
    subject: String(subject || "local-agent").trim().slice(0, 120),
    mode: normalizedMode,
    scope: normalizedScope,
    source: String(source || "local").trim().slice(0, 80),
    createdAt,
    expiresAt,
    ttlMs: effectiveTtlMs,
    maxActions: effectiveMaxActions,
    actionCount: 0,
    revoked: false,
    executable: true,
  };
  return { ...session, sessionHash: hashControlSession(session) };
}

function ensureStoreDir() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
}

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return { version: 1, records: [] };
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return { version: 1, records: Array.isArray(parsed.records) ? parsed.records : [] };
  } catch {
    return { version: 1, records: [] };
  }
}

function writeStore(store) {
  ensureStoreDir();
  const tmpPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmpPath, STORE_PATH);
}

function isExpired(session, now = Date.now()) {
  const expiresAtMs = Date.parse(session?.expiresAt || "");
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= now;
}

export function validateControlSession(session, { now = Date.now(), includeExpired = false } = {}) {
  if (!session || session.type !== "desktop-orchestrator-control-session") return { ok: false, reason: "invalid-control-session" };
  if (session.version !== CONTROL_SESSION_VERSION) return { ok: false, reason: "unsupported-control-session-version" };
  if (session.executable !== true) return { ok: false, reason: "control-session-not-executable" };
  if (!session.sessionId || typeof session.sessionHash !== "string") return { ok: false, reason: "control-session-integrity-fields-missing" };
  const expectedHash = hashControlSession(session);
  if (expectedHash !== session.sessionHash) return { ok: false, reason: "control-session-hash-mismatch", expectedHash, actualHash: session.sessionHash };
  if (session.revoked === true) return { ok: false, reason: "control-session-revoked" };
  if (!includeExpired && isExpired(session, now)) return { ok: false, reason: "control-session-expired" };
  if (Number(session.actionCount) >= Number(session.maxActions)) return { ok: false, reason: "control-session-action-limit" };
  return { ok: true, session };
}

export function saveControlSession(session) {
  const validation = validateControlSession(session);
  if (!validation.ok) return { ok: false, ...validation, storePath: STORE_PATH };
  try {
    const store = readStore();
    const records = [session, ...store.records.filter((record) => record.sessionId !== session.sessionId)].slice(0, MAX_RECORDS);
    writeStore({ version: 1, records });
    return { ok: true, sessionId: session.sessionId, sessionHash: session.sessionHash, expiresAt: session.expiresAt, storePath: STORE_PATH };
  } catch (error) {
    return { ok: false, reason: "control-session-store-write-failed", message: error?.message || String(error), storePath: STORE_PATH };
  }
}

export function getControlSession(sessionId, { includeExpired = false } = {}) {
  const id = String(sessionId || "").trim();
  if (!id) return { ok: false, reason: "control-session-id-required", storePath: STORE_PATH };
  const record = readStore().records.find((candidate) => candidate.sessionId === id) || null;
  if (!record) return { ok: false, reason: "control-session-not-found", storePath: STORE_PATH };
  const validation = validateControlSession(record, { includeExpired });
  return validation.ok
    ? { ok: true, session: record, storePath: STORE_PATH }
    : { ok: false, ...validation, session: record, storePath: STORE_PATH };
}

export function listControlSessions() {
  const records = readStore().records;
  return {
    ok: true,
    storePath: STORE_PATH,
    sessions: records.map((session) => ({
      sessionId: session.sessionId,
      subject: session.subject,
      mode: session.mode,
      source: session.source,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      maxActions: session.maxActions,
      actionCount: session.actionCount,
      revoked: session.revoked === true,
      valid: validateControlSession(session).ok,
    })),
  };
}

export function revokeControlSession(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return { ok: false, reason: "control-session-id-required", storePath: STORE_PATH };
  const store = readStore();
  const record = store.records.find((candidate) => candidate.sessionId === id) || null;
  if (!record) return { ok: false, reason: "control-session-not-found", storePath: STORE_PATH };
  const revoked = { ...record, revoked: true };
  revoked.sessionHash = hashControlSession(revoked);
  writeStore({ version: 1, records: store.records.map((candidate) => candidate.sessionId === id ? revoked : candidate) });
  return { ok: true, sessionId: id, revoked: true, storePath: STORE_PATH };
}

export function sessionActionKey(actionType, action = null) {
  const type = String(actionType || "").trim();
  const subtype = String(action?.type || action?.action || "").trim();
  return subtype ? `${type}:${subtype}` : type;
}

export function matchesControlSessionScope(session, { actionType, action = null, target = null, capability = null } = {}) {
  const scope = normalizeSessionScope(session?.scope);
  const key = sessionActionKey(actionType, action);
  const actionAllowed = scope.actions.includes("*") || scope.actions.includes(String(actionType || "")) || scope.actions.includes(key);
  if (!actionAllowed) return { ok: false, reason: "control-session-action-out-of-scope", actionKey: key };

  const handle = String(target?.handle || target?.expectedWindow?.handle || "").trim();
  if (scope.handles.length > 0 && (!handle || !scope.handles.includes(handle))) {
    return { ok: false, reason: "control-session-window-out-of-scope", handle };
  }
  const processName = String(target?.processName || target?.expectedWindow?.processName || "").trim().toLowerCase();
  if (scope.processNames.length > 0 && (!processName || !scope.processNames.includes(processName))) {
    return { ok: false, reason: "control-session-process-out-of-scope", processName };
  }
  if (capability?.fallback === "keyboard" && !scope.allowKeyboardFallback) {
    return { ok: false, reason: "control-session-keyboard-fallback-not-allowed" };
  }
  if (capability?.fallback === "clipboard" && !scope.allowClipboardFallback) {
    return { ok: false, reason: "control-session-clipboard-fallback-not-allowed" };
  }
  return { ok: true, actionKey: key };
}

export function consumeControlSession(sessionId) {
  const id = String(sessionId || "").trim();
  const store = readStore();
  const record = store.records.find((candidate) => candidate.sessionId === id) || null;
  if (!record) return { ok: false, reason: "control-session-not-found", storePath: STORE_PATH };
  const validation = validateControlSession(record);
  if (!validation.ok) return { ok: false, ...validation, storePath: STORE_PATH };
  const updated = { ...record, actionCount: Number(record.actionCount || 0) + 1 };
  updated.sessionHash = hashControlSession(updated);
  writeStore({ version: 1, records: store.records.map((candidate) => candidate.sessionId === id ? updated : candidate) });
  return { ok: true, session: updated, storePath: STORE_PATH };
}

export function controlSessionStorePath() {
  return STORE_PATH;
}
