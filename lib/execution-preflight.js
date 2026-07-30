import crypto from "crypto";
import { compareElementSignature } from "./element-signature.js";
import { findRecentLiveApprovalTokenRecord, readApprovalTokenStore } from "./approval-token-store.js";
import { findSnapshotElement, loadSnapshot } from "./snapshot-store.js";

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

function addCheck(checks, name, passed, details = {}) {
  checks.push({ name, passed: Boolean(passed), ...details });
}

function getTarget(token = {}) {
  return token.target || {};
}

export function runExecutionPreflight({ recordId } = {}) {
  const checks = [];
  const store = readApprovalTokenStore();
  const record = recordId
    ? store.records.find((candidate) => candidate.id === recordId)
    : findRecentLiveApprovalTokenRecord(store.records);

  addCheck(checks, "token-record-exists", Boolean(record), { recordId: record?.id || null });
  if (!record) {
    return buildResult({ checks, record: null, token: null, reason: "approval-token-not-found" });
  }

  const token = record.token || null;
  addCheck(checks, "token-type", token?.type === "desktop-orchestrator-local-approval-token", { type: token?.type || null });
  addCheck(checks, "token-non-executable", token?.executable === false, { executable: token?.executable ?? null });

  const now = Date.now();
  const expiresAtMs = Date.parse(record.expiresAt || "");
  const expired = !Number.isFinite(expiresAtMs) || expiresAtMs <= now;
  addCheck(checks, "token-not-expired", !expired, { expiresAt: record.expiresAt || null, now: new Date(now).toISOString() });

  const actualHash = token ? hashToken(token) : null;
  addCheck(checks, "token-hash-match", Boolean(actualHash && actualHash === record.tokenHash), {
    expectedHash: record.tokenHash || null,
    actualHash,
  });

  const target = getTarget(token);
  addCheck(checks, "target-fields-present", Boolean(target.leaseId && target.snapshotId && target.elementId && target.elementSignature), {
    leaseId: target.leaseId || null,
    snapshotId: target.snapshotId || null,
    elementId: target.elementId || null,
  });

  const snapshot = target.leaseId && target.snapshotId
    ? loadSnapshot({ leaseId: target.leaseId, snapshotId: target.snapshotId })
    : null;
  addCheck(checks, "lease-snapshot-exists", Boolean(snapshot), {
    leaseId: target.leaseId || null,
    snapshotId: target.snapshotId || null,
  });

  const element = snapshot ? findSnapshotElement(snapshot, target.elementId) : null;
  addCheck(checks, "snapshot-element-exists", Boolean(element), { elementId: target.elementId || null });

  const signatureCheck = element && target.elementSignature
    ? compareElementSignature(element, target.elementSignature)
    : null;
  // Use `verified` (an actual match) rather than `ok` so a missing signature can never
  // satisfy this check, independent of the upstream target-fields-present guard.
  addCheck(checks, "stored-element-signature-match", Boolean(signatureCheck?.verified), {
    expectedSignature: target.elementSignature || null,
    actualSignature: signatureCheck?.actualSignature || null,
  });

  const tokenChecks = token?.checks || {};
  const requiredTokenChecks = ["bundle", "target", "overlay", "verification"];
  const optionalEvidenceChecks = ["visual", "region"];
  const tokenChecksPassed = requiredTokenChecks.every((key) => tokenChecks[key] === true);
  addCheck(checks, "token-checklist-complete", tokenChecksPassed, { tokenChecks, requiredTokenChecks, optionalEvidenceChecks });

  return buildResult({ checks, record, token, signatureCheck, reason: "preflight-complete" });
}

function computePreflightStatus(checks, passed, reason) {
  if (passed) return { status: "passed", statusLabel: "passed", headline: "Preflight passed. Final dry-run envelope can be built." };
  const failedNames = checks.filter((check) => !check.passed).map((check) => check.name);
  const criticalFailures = ["token-type", "token-non-executable", "token-hash-match"];
  if (failedNames.some((name) => criticalFailures.includes(name))) {
    return { status: "failed", statusLabel: "failed", headline: "Preflight failed: approval token integrity checks did not pass." };
  }
  if (reason === "approval-token-not-found") {
    return { status: "waiting", statusLabel: "waiting", headline: "Preflight waiting for a fresh approval token." };
  }
  if (failedNames.includes("lease-snapshot-exists")) {
    return { status: "waiting", statusLabel: "waiting", headline: "Preflight waiting for a fresh approval bundle: the referenced lease snapshot is missing or expired." };
  }
  if (failedNames.includes("snapshot-element-exists") || failedNames.includes("stored-element-signature-match")) {
    return { status: "waiting", statusLabel: "waiting", headline: "Preflight waiting for a fresh approval bundle: the target element is missing or stale." };
  }
  return { status: "waiting", statusLabel: "waiting", headline: "Preflight blocked safely. Refresh the approval bundle/token and run preflight again." };
}

function buildResult({ checks, record, token, signatureCheck = null, reason }) {
  const passed = checks.every((check) => check.passed);
  const display = computePreflightStatus(checks, passed, reason);
  return {
    ok: true,
    type: "desktop-orchestrator-execution-preflight",
    version: 1,
    reason,
    status: display.status,
    statusLabel: display.statusLabel,
    headline: display.headline,
    passed,
    allowedToEnterFinalExecutionStage: passed,
    executable: false,
    checkedAt: new Date().toISOString(),
    record: record ? {
      id: record.id,
      savedAt: record.savedAt,
      expiresAt: record.expiresAt,
      tokenHash: record.tokenHash,
      actionType: record.actionType,
      risk: record.risk,
    } : null,
    target: token?.target || null,
    signatureCheck,
    checks,
    safety: {
      noDesktopActionExecuted: true,
      note: "Preflight is read-only and does not click, type, move the cursor, focus windows, or invoke UIA actions.",
    },
  };
}
