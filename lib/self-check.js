import { getRecentApprovalBundle } from "./approval-store.js";
import { getRecentApprovalToken, readApprovalTokenStore } from "./approval-token-store.js";
import { readAuditTimeline } from "./audit-timeline.js";
import { runExecutionPreflight } from "./execution-preflight.js";
import { buildFinalExecutionEnvelope } from "./final-execution-envelope.js";

function addCheck(checks, name, passed, details = {}) {
  checks.push({ name, passed: Boolean(passed), ...details });
}

function summarizeChecks(checks) {
  const passed = checks.filter((check) => check.passed).length;
  return {
    total: checks.length,
    passed,
    failed: checks.length - passed,
    allPassed: checks.every((check) => check.passed),
  };
}

export function runSelfCheck() {
  const checks = [];
  const recentBundle = getRecentApprovalBundle();
  const tokenStore = readApprovalTokenStore();
  const recentToken = getRecentApprovalToken();
  const timeline = readAuditTimeline({ limit: 30 });
  const preflight = runExecutionPreflight();
  const finalEnvelope = buildFinalExecutionEnvelope();

  addCheck(checks, "recent-approval-bundle-readable", Boolean(recentBundle?.ok !== false), {
    hasBundle: Boolean(recentBundle?.bundle),
    recordId: recentBundle?.record?.id || null,
  });
  addCheck(checks, "approval-token-store-readable", Array.isArray(tokenStore?.records), {
    tokenRecordCount: tokenStore?.records?.length || 0,
  });
  addCheck(checks, "recent-approval-token-readable", Boolean(recentToken?.ok !== false), {
    hasToken: Boolean(recentToken?.record?.token),
    recordId: recentToken?.record?.id || null,
  });
  addCheck(checks, "audit-timeline-readable", Boolean(timeline?.ok && Array.isArray(timeline.events)), {
    eventCount: timeline?.count || 0,
  });
  addCheck(checks, "preflight-runs-read-only", Boolean(preflight?.ok && preflight?.safety?.noDesktopActionExecuted), {
    preflightPassed: preflight?.passed,
    reason: preflight?.reason || null,
    failedChecks: Array.isArray(preflight?.checks) ? preflight.checks.filter((check) => !check.passed).map((check) => check.name) : [],
  });
  addCheck(checks, "final-envelope-dry-run-only", Boolean(finalEnvelope?.ok && finalEnvelope?.executionMode === "dry-run-only" && finalEnvelope?.executable === false), {
    readyForHumanFinalReview: finalEnvelope?.readyForHumanFinalReview,
    blocked: finalEnvelope?.blocked,
    blockedReasons: finalEnvelope?.blockedReasons || [],
  });
  addCheck(checks, "real-input-remains-blocked", Boolean(finalEnvelope?.safety?.realInputStillBlocked && finalEnvelope?.safety?.noDesktopActionExecuted), {
    confirmationPhrase: finalEnvelope?.safety?.confirmationPhrase || null,
  });

  const summary = summarizeChecks(checks);
  return {
    ok: true,
    type: "desktop-orchestrator-self-check",
    version: 1,
    checkedAt: new Date().toISOString(),
    summary,
    checks,
    stores: {
      tokenStorePath: recentToken?.storePath || null,
      timelineStorePath: timeline?.storePath || null,
      tokenRecordCount: tokenStore?.records?.length || 0,
      timelineEventCount: timeline?.count || 0,
    },
    safety: {
      noDesktopActionExecuted: true,
      noScreenshotCaptured: true,
      noUiaInvoke: true,
      noMouseOrKeyboardInput: true,
      note: "Self-check only reads local protocol stores and computes dry-run gates.",
    },
  };
}
