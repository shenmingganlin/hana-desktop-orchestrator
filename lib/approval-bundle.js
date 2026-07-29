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
  return {
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
}
