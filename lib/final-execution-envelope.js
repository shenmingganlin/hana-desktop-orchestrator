import { runExecutionPreflight } from "./execution-preflight.js";

const FINAL_CONFIRMATION_PHRASE = "I_UNDERSTAND_DESKTOP_INPUT";

function buildActionSummary(token = {}) {
  const target = token.target || {};
  return {
    actionType: token.actionType || "unknown",
    risk: token.risk || "unknown",
    target: {
      leaseId: target.leaseId || null,
      snapshotId: target.snapshotId || null,
      elementId: target.elementId || null,
      handle: target.handle || null,
      expectedName: target.expectedName || null,
      elementSignature: target.elementSignature || null,
    },
  };
}

function buildBlockedReasons(preflight) {
  if (!preflight?.checks) return ["preflight-result-missing"];
  return preflight.checks
    .filter((check) => !check.passed)
    .map((check) => check.name);
}

export function buildFinalExecutionEnvelope({ recordId } = {}) {
  const preflight = runExecutionPreflight({ recordId });
  const checksPassed = Boolean(preflight?.passed);
  const blockedReasons = checksPassed ? [] : buildBlockedReasons(preflight);
  const actionSummary = buildActionSummary(preflight?.target ? { actionType: preflight.record?.actionType, risk: preflight.record?.risk, target: preflight.target } : {});

  return {
    ok: true,
    type: "desktop-orchestrator-final-execution-envelope",
    version: 1,
    createdAt: new Date().toISOString(),
    executionMode: "dry-run-only",
    executable: false,
    readyForHumanFinalReview: checksPassed,
    blocked: !checksPassed,
    blockedReasons,
    action: actionSummary,
    preflight: {
      passed: Boolean(preflight?.passed),
      allowedToEnterFinalExecutionStage: Boolean(preflight?.allowedToEnterFinalExecutionStage),
      record: preflight?.record || null,
      checks: preflight?.checks || [],
    },
    requiredFinalGates: [
      "Plugin configuration allowRealInput must be true.",
      `Human must provide exact confirmation phrase: ${FINAL_CONFIRMATION_PHRASE}`,
      "A fresh lease-bound snapshot must still resolve the same target.",
      "Element signature must be rechecked immediately before execution.",
      "Post-action verification request must be available.",
      "The current implementation still returns this dry-run envelope only.",
    ],
    safety: {
      noDesktopActionExecuted: true,
      realInputStillBlocked: true,
      confirmationPhrase: FINAL_CONFIRMATION_PHRASE,
      note: "This envelope describes a future final execution path. It does not click, type, move the cursor, focus windows, or invoke UIA actions.",
    },
  };
}
