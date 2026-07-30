import fs from "fs";
import os from "os";
import path from "path";
import { findSnapshotElement, loadSnapshot } from "./snapshot-store.js";

const STORE_DIR = path.join(os.tmpdir(), "hana-desktop-orchestrator");
const STORE_PATH = path.join(STORE_DIR, "approval-store.json");
const MAX_RECORDS = 20;

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

function buildRecordId(bundle) {
  const action = bundle?.actionType || "approval";
  return `${action}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function getTarget(record) {
  return record?.bundle?.target || record?.target || {};
}

function isRecordSnapshotLive(record) {
  const target = getTarget(record);
  if (!target.leaseId || !target.snapshotId || !target.elementId) return false;
  const snapshot = loadSnapshot({ leaseId: target.leaseId, snapshotId: target.snapshotId });
  return Boolean(snapshot && findSnapshotElement(snapshot, target.elementId));
}

export function saveApprovalBundle(bundle, { source = "unknown" } = {}) {
  if (!bundle || bundle.type !== "desktop-orchestrator-approval-bundle") {
    return { ok: false, reason: "invalid-approval-bundle", storePath: STORE_PATH };
  }

  try {
    const store = readStoreFile();
    const record = {
      id: buildRecordId(bundle),
      savedAt: new Date().toISOString(),
      source,
      actionType: bundle.actionType || null,
      risk: bundle.risk || null,
      status: bundle.status || null,
      target: bundle.target || null,
      bundle,
    };
    const records = [record, ...store.records].slice(0, MAX_RECORDS);
    writeStoreFile({ version: 1, records });
    return { ok: true, recordId: record.id, savedAt: record.savedAt, storePath: STORE_PATH };
  } catch (error) {
    return { ok: false, reason: "store-write-failed", message: error?.message || String(error), storePath: STORE_PATH };
  }
}

export function readApprovalStore() {
  return { ...readStoreFile(), storePath: STORE_PATH };
}

export function getRecentApprovalBundle() {
  const store = readApprovalStore();
  const record = store.records.find((candidate) => isRecordSnapshotLive(candidate)) || null;
  return {
    ok: true,
    storePath: store.storePath,
    count: store.records.length,
    liveCount: store.records.filter((candidate) => isRecordSnapshotLive(candidate)).length,
    skippedStaleCount: record ? store.records.indexOf(record) : store.records.length,
    record,
    bundle: record?.bundle || null,
    reason: record ? "recent-live-approval-bundle" : "no-live-approval-bundle",
  };
}
