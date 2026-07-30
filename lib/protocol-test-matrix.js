import { APPROVAL_TOKEN_VERSION, saveApprovalToken, readApprovalTokenStore } from "./approval-token-store.js";
import { readAuditTimeline } from "./audit-timeline.js";
import { buildFinalExecutionEnvelope } from "./final-execution-envelope.js";
import { runExecutionPreflight } from "./execution-preflight.js";
import { runSelfCheck } from "./self-check.js";

function caseResult(name, passed, details = {}) {
  return { name, passed: Boolean(passed), ...details };
}

function summarize(cases) {
  const passed = cases.filter((testCase) => testCase.passed).length;
  return {
    total: cases.length,
    passed,
    failed: cases.length - passed,
    allPassed: cases.every((testCase) => testCase.passed),
  };
}

function buildTokenFixture(overrides = {}) {
  return {
    type: "desktop-orchestrator-local-approval-token",
    version: APPROVAL_TOKEN_VERSION,
    executable: false,
    createdAt: new Date().toISOString(),
    actionType: "fixture-click",
    risk: "fixture",
    approvalBundleHash: "fixture-bundle-hash",
    target: {},
    checks: {},
    ...overrides,
  };
}

export function runProtocolTestMatrix() {
  const beforeStore = readApprovalTokenStore();
  const beforeCount = beforeStore.records.length;
  const cases = [];

  const invalidTokenResult = saveApprovalToken(null, { source: "protocol-test-matrix", ttlMs: 30_000 });
  cases.push(caseResult("invalid-token-rejected", invalidTokenResult?.ok === false && invalidTokenResult?.reason === "invalid-approval-token", {
    result: invalidTokenResult,
  }));

  const executableTokenResult = saveApprovalToken(buildTokenFixture({ executable: true }), { source: "protocol-test-matrix", ttlMs: 30_000 });
  cases.push(caseResult("executable-token-rejected", executableTokenResult?.ok === false && executableTokenResult?.reason === "token-must-be-non-executable", {
    result: executableTokenResult,
  }));

  const unsupportedVersionResult = saveApprovalToken(buildTokenFixture({ version: 1 }), { source: "protocol-test-matrix", ttlMs: 30_000 });
  cases.push(caseResult("unsupported-token-version-rejected", unsupportedVersionResult?.ok === false && unsupportedVersionResult?.reason === "unsupported-approval-token-version", {
    result: unsupportedVersionResult,
  }));

  const missingBundleHashResult = saveApprovalToken(buildTokenFixture({ approvalBundleHash: null }), { source: "protocol-test-matrix", ttlMs: 30_000 });
  cases.push(caseResult("missing-bundle-hash-rejected", missingBundleHashResult?.ok === false && missingBundleHashResult?.reason === "approval-bundle-hash-required", {
    result: missingBundleHashResult,
  }));

  const afterRejectStore = readApprovalTokenStore();
  cases.push(caseResult("rejection-path-does-not-write-token-records", afterRejectStore.records.length === beforeCount, {
    beforeCount,
    afterCount: afterRejectStore.records.length,
  }));

  const preflight = runExecutionPreflight();
  cases.push(caseResult("preflight-is-read-only", Boolean(preflight?.ok && preflight?.executable === false && preflight?.safety?.noDesktopActionExecuted), {
    preflightPassed: preflight?.passed,
    reason: preflight?.reason || null,
    failedChecks: Array.isArray(preflight?.checks) ? preflight.checks.filter((check) => !check.passed).map((check) => check.name) : [],
  }));

  const envelope = buildFinalExecutionEnvelope();
  cases.push(caseResult("final-envelope-is-dry-run-only", Boolean(envelope?.ok && envelope?.executionMode === "dry-run-only" && envelope?.executable === false), {
    readyForHumanFinalReview: envelope?.readyForHumanFinalReview,
    blocked: envelope?.blocked,
    blockedReasons: envelope?.blockedReasons || [],
  }));

  cases.push(caseResult("real-input-still-blocked", Boolean(envelope?.safety?.realInputStillBlocked && envelope?.safety?.noDesktopActionExecuted), {
    confirmationPhrase: envelope?.safety?.confirmationPhrase || null,
  }));

  const selfCheck = runSelfCheck();
  cases.push(caseResult("self-check-preserves-no-input-safety", Boolean(selfCheck?.ok && selfCheck?.safety?.noDesktopActionExecuted && selfCheck?.safety?.noMouseOrKeyboardInput), {
    summary: selfCheck?.summary || null,
  }));

  const timeline = readAuditTimeline({ limit: 5 });
  cases.push(caseResult("audit-timeline-readable", Boolean(timeline?.ok && Array.isArray(timeline?.events)), {
    count: timeline?.count || 0,
    storePath: timeline?.storePath || null,
  }));

  const finalStore = readApprovalTokenStore();
  cases.push(caseResult("matrix-run-does-not-create-token-records", finalStore.records.length === beforeCount, {
    beforeCount,
    finalCount: finalStore.records.length,
  }));

  return {
    ok: true,
    type: "desktop-orchestrator-protocol-test-matrix",
    version: 1,
    checkedAt: new Date().toISOString(),
    summary: summarize(cases),
    cases,
    safety: {
      nonDestructive: true,
      noValidTokenWritten: finalStore.records.length === beforeCount,
      noDesktopActionExecuted: true,
      noScreenshotCaptured: true,
      noUiaInvoke: true,
      noMouseOrKeyboardInput: true,
      note: "Protocol matrix only exercises rejection paths and read-only dry-run gates.",
    },
  };
}
