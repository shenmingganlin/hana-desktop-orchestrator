import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { findSnapshotElement, loadSnapshot } from "./snapshot-store.js";

const STORE_DIR = path.join(os.tmpdir(), "hana-desktop-orchestrator");
const STORE_PATH = path.join(STORE_DIR, "approval-token-store.json");
const MAX_RECORDS = 30;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function ensureStoreDir() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
}

function readStoreFile() {
  try {
    if (!fs.existsSync(STORE_PATH)) return { version: 1, records: [] };
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return {
      version: 1,
      records: Array.isArray(parsed.records) ? parsed.records : [],
    };
  } catch {
    return { version: 1, records: [] };
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

function hashToken(token) {
  return crypto.createHash("sha256").update(stableStringify(token)).digest("hex");
}

function buildRecordId(token) {
  const action = token?.actionType || "approval-token";
  return `${action}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeTtlMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_TTL_MS;
  return Math.max(30_000, Math.min(number, 30 * 60 * 1000));
}

function isRecordExpired(record, timestamp = Date.now()) {
  const expiresAtMs = Date.parse(record?.expiresAt || "");
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= timestamp;
}

function getTarget(record) {
  return record?.token?.target || record?.target || {};
}

function isRecordSnapshotLive(record) {
  const target = getTarget(record);
  if (!target.leaseId || !target.snapshotId || !target.elementId) return false;
  const snapshot = loadSnapshot({ leaseId: target.leaseId, snapshotId: target.snapshotId });
  return Boolean(snapshot && findSnapshotElement(snapshot, target.elementId));
}

export function findRecentLiveApprovalTokenRecord(records, { includeExpired = false } = {}) {
  const timestamp = Date.now();
  return (Array.isArray(records) ? records : []).find((record) => {
    if (!includeExpired && isRecordExpired(record, timestamp)) return false;
    return isRecordSnapshotLive(record);
  }) || null;
}

export function saveApprovalToken(token, { source = "widget", ttlMs } = {}) {
  if (!token || token.type !== "desktop-orchestrator-local-approval-token") {
    return { ok: false, reason: "invalid-approval-token", storePath: STORE_PATH };
  }
  if (token.executable !== false) {
    return { ok: false, reason: "token-must-be-non-executable", storePath: STORE_PATH };
  }

  try {
    const now = Date.now();
    const effectiveTtlMs = normalizeTtlMs(ttlMs);
    const record = {
      id: buildRecordId(token),
      savedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + effectiveTtlMs).toISOString(),
      ttlMs: effectiveTtlMs,
      source,
      tokenHash: hashToken(token),
      actionType: token.actionType || null,
      risk: token.risk || null,
      target: token.target || null,
      checks: token.checks || null,
      executable: false,
      token,
    };
    const store = readStoreFile();
    const records = [record, ...store.records].slice(0, MAX_RECORDS);
    writeStoreFile({ version: 1, records });
    return {
      ok: true,
      recordId: record.id,
      tokenHash: record.tokenHash,
      savedAt: record.savedAt,
      expiresAt: record.expiresAt,
      ttlMs: record.ttlMs,
      storePath: STORE_PATH,
    };
  } catch (error) {
    return { ok: false, reason: "token-store-write-failed", message: error?.message || String(error), storePath: STORE_PATH };
  }
}

export function readApprovalTokenStore() {
  const store = readStoreFile();
  return { ...store, storePath: STORE_PATH };
}

export function getRecentApprovalToken() {
  const store = readApprovalTokenStore();
  const record = findRecentLiveApprovalTokenRecord(store.records);
  return {
    ok: true,
    storePath: store.storePath,
    count: store.records.length,
    liveCount: store.records.filter((candidate) => !isRecordExpired(candidate) && isRecordSnapshotLive(candidate)).length,
    skippedStaleCount: record ? store.records.indexOf(record) : store.records.length,
    record,
    expired: record ? isRecordExpired(record) : null,
    reason: record ? "recent-live-approval-token" : "no-live-approval-token",
  };
}
