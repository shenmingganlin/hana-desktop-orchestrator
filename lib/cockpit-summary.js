import { runSelfCheck } from "./self-check.js";
import { runProtocolTestMatrix } from "./protocol-test-matrix.js";
import { runFixtureSandbox } from "./fixture-sandbox.js";

function summarizeResult(name, result, { warningReasons = [] } = {}) {
  const failedItems = [];
  const checks = Array.isArray(result?.checks) ? result.checks : Array.isArray(result?.cases) ? result.cases : [];

  for (const item of checks) {
    if (item?.passed === false) {
      failedItems.push({ name: item.name || "unnamed-check", reason: item.reason || item.blockedReasons?.join(",") || null });
    }
  }

  const failedNames = failedItems.map((item) => item.name);
  const warningOnly = failedNames.length > 0 && failedNames.every((itemName) => warningReasons.includes(itemName));
  const allPassed = Boolean(result?.summary?.allPassed);
  const status = allPassed ? "healthy" : warningOnly ? "warning" : "failed";

  return {
    name,
    status,
    allPassed,
    total: result?.summary?.total || checks.length || 0,
    passed: result?.summary?.passed || 0,
    failed: result?.summary?.failed || failedItems.length,
    failedItems,
  };
}

function computeOverallStatus(items) {
  if (items.some((item) => item.status === "failed")) return "failed";
  if (items.some((item) => item.status === "warning")) return "warning";
  return "healthy";
}

export function runCockpitSummary() {
  const selfCheck = runSelfCheck();
  const protocolMatrix = runProtocolTestMatrix();
  const fixtureSandbox = runFixtureSandbox();

  const items = [
    summarizeResult("self-check", selfCheck, { warningReasons: ["preflight-runs-read-only"] }),
    summarizeResult("protocol-test-matrix", protocolMatrix, { warningReasons: ["preflight-is-read-only"] }),
    summarizeResult("fixture-sandbox", fixtureSandbox),
  ];
  const status = computeOverallStatus(items);

  return {
    ok: true,
    type: "desktop-orchestrator-cockpit-summary",
    version: 1,
    checkedAt: new Date().toISOString(),
    status,
    statusLabel: status === "warning" ? "waiting" : status,
    headline: status === "healthy"
      ? "All protocol checks are healthy."
      : status === "warning"
        ? "Protocol safe. Waiting for a fresh approval token and preflight state."
        : "One or more protocol checks failed.",
    items,
    raw: {
      selfCheck,
      protocolMatrix,
      fixtureSandbox,
    },
    safety: {
      noDesktopActionExecuted: true,
      noScreenshotCaptured: true,
      noUiaInvoke: true,
      noMouseOrKeyboardInput: true,
      note: "Cockpit summary aggregates dry-run and synthetic protocol checks only.",
    },
  };
}
