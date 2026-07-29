export function buildVerificationRequest({
  actionType,
  leaseId = null,
  snapshotId = null,
  elementId = null,
  expectedSignature = null,
  expectedName = null,
  expectedHandle = null,
} = {}) {
  return {
    type: "verify-action",
    version: 1,
    actionType: actionType || "unknown",
    leaseId,
    snapshotId,
    elementId,
    expectedSignature,
    expectedName,
    expectedHandle,
    checks: [
      "lease snapshot exists",
      "target window can be resolved",
      "element can be re-read",
      "element signature still matches",
    ],
  };
}
