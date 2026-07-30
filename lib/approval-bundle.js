import crypto from "crypto";

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value)
    .filter((key) => key !== "bundleHash")
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(",")}}`;
}

export function hashApprovalBundle(bundle) {
  return crypto.createHash("sha256").update(stableStringify(bundle)).digest("hex");
}

export function buildPreviewRequests({ leaseId = null, snapshotId = null, elementId = null } = {}) {
  return {
    visualVerify: leaseId && snapshotId && elementId
      ? { tool: "desktop-orchestrator_visual-verify", input: { leaseId, snapshotId, elementId } }
      : null,
    regionPreview: leaseId && snapshotId && elementId
      ? { tool: "desktop-orchestrator_region-preview", input: { leaseId, snapshotId, elementId, padding: 8 } }
      : null,
  };
}

export function buildApprovalBundle({
  actionType,
  risk = "high",
  approval = null,
  plan = null,
  target = {},
  cursorOverlay = null,
  verificationRequest = null,
  capability = null,
  previewRequests = null,
  safetyNotes = [],
} = {}) {
  const leaseId = target?.leaseId || null;
  const snapshotId = target?.snapshotId || null;
  const elementId = target?.elementId || null;
  const bundle = {
    type: "desktop-orchestrator-approval-bundle",
    version: 1,
    actionType: actionType || plan?.type || "unknown",
    risk,
    status: approval?.allowed ? "approved-for-real-action" : "preview-only",
    approval,
    target,
    plan,
    cursorOverlay,
    verificationRequest,
    capability,
    previewRequests: previewRequests || buildPreviewRequests({ leaseId, snapshotId, elementId }),
    safety: {
      realActionBlocked: approval ? !approval.allowed : true,
      requiresExplicitConfirmation: true,
      requiresFreshLease: true,
      requiresSignatureGuard: true,
      notes: safetyNotes,
    },
  };
  return { ...bundle, bundleHash: hashApprovalBundle(bundle) };
}
