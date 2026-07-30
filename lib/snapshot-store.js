import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const STORE_DIR = path.join(os.tmpdir(), "hana-desktop-orchestrator");
const STORE_PATH = path.join(STORE_DIR, "snapshot-store.json");
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function now() {
  return Date.now();
}

function ensureStoreDir() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
}

function readStore() {
  try {
    const text = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : { snapshots: {} };
  } catch {
    return { snapshots: {} };
  }
}

function writeStore(store) {
  ensureStoreDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function cleanupStore(store, timestamp = now()) {
  const snapshots = store.snapshots || {};
  for (const [key, snapshot] of Object.entries(snapshots)) {
    if (!snapshot?.expiresAtMs || snapshot.expiresAtMs <= timestamp) {
      delete snapshots[key];
    }
  }
  store.snapshots = snapshots;
  return store;
}

function makeStoreKey(leaseId, snapshotId) {
  return `${leaseId}\u0000${snapshotId}`;
}

export function saveSnapshot(snapshot, { ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!snapshot?.snapshotId) throw new Error("snapshotId is required to save snapshot");
  const timestamp = now();
  const leaseId = snapshot.leaseId || crypto.randomUUID();
  const expiresAtMs = timestamp + ttlMs;
  const record = {
    ...snapshot,
    leaseId,
    savedAt: new Date(timestamp).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
  };

  const store = cleanupStore(readStore(), timestamp);
  store.snapshots[makeStoreKey(leaseId, snapshot.snapshotId)] = record;
  writeStore(store);
  return record;
}

export function loadSnapshot({ leaseId, snapshotId }) {
  if (!leaseId || !snapshotId) return null;
  const timestamp = now();
  // Pure read: do NOT write the store from a load path. We still skip expired records
  // in-memory, but persisting cleanup here caused a disk write on every read (and used a
  // non-atomic overwrite, unlike the token store). GC is the writer's responsibility
  // (saveSnapshot already cleans up) or an explicit purge call.
  const store = readStore();
  const record = store.snapshots?.[makeStoreKey(leaseId, snapshotId)] || null;
  if (!record) return null;
  if (!record.expiresAtMs || record.expiresAtMs <= timestamp) return null;
  return record;
}

// Explicit, opt-in purge of expired snapshots. Call from a writer/maintenance path,
// never from a read path.
export function purgeExpiredSnapshots() {
  const store = cleanupStore(readStore(), now());
  writeStore(store);
  return store;
}

export function findSnapshotElement(snapshot, elementId) {
  if (!snapshot || !elementId) return null;
  return Array.isArray(snapshot.elements)
    ? snapshot.elements.find((element) => element?.elementId === elementId) || null
    : null;
}
