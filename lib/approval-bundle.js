import crypto from "crypto";

export const APPROVAL_BUNDLE_VERSION = 2;

function stableStringify(value, omitBundleHash = false) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.keys(value)
    .filter((key) => !(omitBundleHash && key === "bundleHash"))
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(",")}}`;
}

export function hashApprovalBundle(bundle) {
  return crypto.createHash("sha256").update(stableStringify(bundle, true)).digest("hex");
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
  safetyRequirements = {},
} = {}) {
  const leaseId = target?.leaseId || null;
  const snapshotId = target?.snapshotId || null;
  const elementId = target?.elementId || null;
  const realActionBlocked = safetyRequirements.realActionBlocked ?? (approval ? !approval.allowed : true);
  const bundle = {
    type: "desktop-orchestrator-approval-bundle",
    version: APPROVAL_BUNDLE_VERSION,
    actionType: actionType || plan?.type || "unknown",
    risk,
    status: realActionBlocked ? "preview-only" : "approved-for-real-action",
    approval,
    target,
    plan,
    cursorOverlay,
    verificationRequest,
    capability,
    previewRequests: previewRequests || buildPreviewRequests({ leaseId, snapshotId, elementId }),
    safety: {
      realActionBlocked,
      requiresExplicitConfirmation: safetyRequirements.requiresExplicitConfirmation ?? true,
      requiresFreshLease: safetyRequirements.requiresFreshLease ?? true,
      requiresSignatureGuard: safetyRequirements.requiresSignatureGuard ?? true,
      requiresWindowGuard: safetyRequirements.requiresWindowGuard ?? false,
      notes: safetyNotes,
    },
  };
  return { ...bundle, bundleHash: hashApprovalBundle(bundle) };
}
