import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const STORE_DIR = path.join(os.tmpdir(), "hana-desktop-orchestrator");
const STORE_PATH = path.join(STORE_DIR, "audit-timeline.json");
const MAX_EVENTS = 100;

function ensureStoreDir() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
}

function readStoreFile() {
  try {
    if (!fs.existsSync(STORE_PATH)) return { version: 1, events: [] };
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return {
      version: 2,
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch {
    return { version: 2, events: [] };
  }
}

function writeStoreFile(store) {
  ensureStoreDir();
  const tmpPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmpPath, STORE_PATH);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(",")}}`;
}

function eventHashPayload(event) {
  const { eventHash, ...payload } = event;
  return payload;
}

export function hashAuditEvent(event) {
  return crypto.createHash("sha256").update(stableStringify(eventHashPayload(event))).digest("hex");
}

function newestHash(events) {
  const event = events.find((candidate) => typeof candidate?.eventHash === "string" && candidate.eventHash.length > 0);
  return event?.eventHash || null;
}

export function appendAuditEvent(type, details = {}) {
  try {
    const store = readStoreFile();
    const event = {
      id: `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      type,
      at: new Date().toISOString(),
      details,
      chainVersion: 1,
      previousHash: newestHash(store.events),
    };
    event.eventHash = hashAuditEvent(event);
    const events = [event, ...store.events].slice(0, MAX_EVENTS);
    writeStoreFile({ version: 2, events });
    return { ok: true, eventId: event.id, at: event.at, eventHash: event.eventHash, previousHash: event.previousHash, storePath: STORE_PATH };
  } catch (error) {
    return { ok: false, reason: "audit-event-write-failed", message: error?.message || String(error), storePath: STORE_PATH };
  }
}

export function verifyAuditTimeline({ limit = MAX_EVENTS } = {}) {
  const store = readStoreFile();
  const safeLimit = Math.max(1, Math.min(Number(limit) || MAX_EVENTS, MAX_EVENTS));
  const events = store.events.slice(0, safeLimit);
  const checks = events.map((event, index) => {
    if (!event?.eventHash) {
      return { eventId: event?.id || null, type: event?.type || null, index, status: "legacy", passed: true, reason: "event-has-no-hash" };
    }
    const recalculatedHash = hashAuditEvent(event);
    const nextHashedEvent = events.slice(index + 1).find((candidate) => candidate?.eventHash);
    const expectedPreviousHash = nextHashedEvent?.eventHash || null;
    const hashMatches = recalculatedHash === event.eventHash;
    const previousHashMatches = event.previousHash === expectedPreviousHash || (!nextHashedEvent && event.previousHash === null);
    return {
      eventId: event.id,
      type: event.type,
      index,
      status: hashMatches && previousHashMatches ? "verified" : "failed",
      passed: hashMatches && previousHashMatches,
      hashMatches,
      previousHashMatches,
      eventHash: event.eventHash,
      recalculatedHash,
      previousHash: event.previousHash || null,
      expectedPreviousHash,
    };
  });
  const hashedChecks = checks.filter((check) => check.status !== "legacy");
  return {
    ok: true,
    storePath: STORE_PATH,
    count: store.events.length,
    checkedCount: checks.length,
    hashedCount: hashedChecks.length,
    legacyCount: checks.length - hashedChecks.length,
    passed: checks.every((check) => check.passed),
    chainHeadHash: newestHash(store.events),
    checks,
  };
}

export function readAuditTimeline({ limit = 30 } = {}) {
  const store = readStoreFile();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 30, MAX_EVENTS));
  return {
    ok: true,
    storePath: STORE_PATH,
    count: store.events.length,
    chainHeadHash: newestHash(store.events),
    verification: verifyAuditTimeline({ limit: safeLimit }),
    events: store.events.slice(0, safeLimit),
  };
}
