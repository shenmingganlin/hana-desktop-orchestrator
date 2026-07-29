import crypto from "crypto";
import { buildElementSignature } from "./element-signature.js";

const TOKEN_TYPE = "desktop-orchestrator-local-approval-token";

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

function buildFixtureElement(overrides = {}) {
  return {
    elementId: "el-0",
    role: "Button",
    name: "Fixture Button",
    automationId: "fixture-button",
    className: "Button",
    enabled: true,
    bounds: {
      left: 100,
      top: 100,
      right: 220,
      bottom: 140,
      width: 120,
      height: 40,
      centerX: 160,
      centerY: 120,
    },
    ...overrides,
  };
}

function buildFixtureContext({ expired = false, hashMismatch = false, signatureMismatch = false, executable = false } = {}) {
  const element = buildFixtureElement(signatureMismatch ? { name: "Fixture Button Changed" } : {});
  const expectedElement = buildFixtureElement();
  const expectedSignature = buildElementSignature(expectedElement);
  const now = Date.now();
  const token = {
    type: TOKEN_TYPE,
    version: 1,
    executable,
    createdAt: new Date(now).toISOString(),
    actionType: "fixture-click",
    risk: "fixture",
    target: {
      leaseId: "fixture-lease",
      snapshotId: "fixture-snapshot",
      elementId: "el-0",
      handle: "fixture-handle",
      expectedName: "Fixture Button",
      elementSignature: expectedSignature,
    },
    checks: {
      bundle: true,
      target: true,
      overlay: true,
      visual: true,
      region: true,
      verification: true,
    },
  };
  const actualHash = hashToken(token);
  const record = {
    id: "fixture-record",
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (expired ? -60_000 : 600_000)).toISOString(),
    tokenHash: hashMismatch ? `tampered-${actualHash.slice(0, 16)}` : actualHash,
    token,
  };
  const snapshot = {
    leaseId: "fixture-lease",
    snapshotId: "fixture-snapshot",
    window: { handle: "fixture-handle", title: "Fixture Window" },
    elements: [element],
  };
  return { token, record, snapshot, actualHash, expectedSignature };
}

function evaluateFixtureContext(context) {
  const checks = [];
  const now = Date.now();
  const token = context.record?.token;
  const target = token?.target || {};
  const element = context.snapshot?.elements?.find((candidate) => candidate.elementId === target.elementId);
  const actualSignature = element ? buildElementSignature(element) : null;
  const tokenChecks = token?.checks || {};
  const requiredChecks = ["bundle", "target", "overlay", "visual", "region", "verification"];

  checks.push({ name: "record-exists", passed: Boolean(context.record) });
  checks.push({ name: "token-type", passed: token?.type === TOKEN_TYPE, type: token?.type || null });
  checks.push({ name: "token-non-executable", passed: token?.executable === false, executable: token?.executable ?? null });
  checks.push({ name: "token-not-expired", passed: Date.parse(context.record?.expiresAt || "") > now, expiresAt: context.record?.expiresAt || null });
  checks.push({ name: "token-hash-match", passed: context.actualHash === context.record?.tokenHash, expectedHash: context.record?.tokenHash || null, actualHash: context.actualHash });
  checks.push({ name: "target-fields-present", passed: Boolean(target.leaseId && target.snapshotId && target.elementId && target.elementSignature), target });
  checks.push({ name: "lease-snapshot-exists", passed: Boolean(context.snapshot), leaseId: target.leaseId || null, snapshotId: target.snapshotId || null });
  checks.push({ name: "snapshot-element-exists", passed: Boolean(element), elementId: target.elementId || null });
  checks.push({ name: "stored-element-signature-match", passed: Boolean(actualSignature && actualSignature === target.elementSignature), expectedSignature: target.elementSignature || null, actualSignature });
  checks.push({ name: "token-checklist-complete", passed: requiredChecks.every((key) => tokenChecks[key] === true), tokenChecks });

  const passed = checks.every((check) => check.passed);
  return {
    passed,
    allowedToEnterFinalExecutionStage: passed,
    blockedReasons: checks.filter((check) => !check.passed).map((check) => check.name),
    checks,
  };
}

function runCase(name, fixtureOptions, expectedPassed) {
  const context = buildFixtureContext(fixtureOptions);
  const result = evaluateFixtureContext(context);
  return {
    name,
    passed: result.passed === expectedPassed,
    expectedFixturePass: expectedPassed,
    actualFixturePass: result.passed,
    blockedReasons: result.blockedReasons,
    result,
  };
}

export function runFixtureSandbox() {
  const cases = [
    runCase("complete-fixture-chain-passes", {}, true),
    runCase("expired-token-blocks", { expired: true }, false),
    runCase("hash-mismatch-blocks", { hashMismatch: true }, false),
    runCase("signature-mismatch-blocks", { signatureMismatch: true }, false),
    runCase("executable-token-blocks", { executable: true }, false),
  ];
  const passed = cases.filter((testCase) => testCase.passed).length;
  return {
    ok: true,
    type: "desktop-orchestrator-fixture-sandbox",
    version: 1,
    checkedAt: new Date().toISOString(),
    summary: {
      total: cases.length,
      passed,
      failed: cases.length - passed,
      allPassed: cases.every((testCase) => testCase.passed),
    },
    cases,
    safety: {
      pureInMemory: true,
      noRealStoreWritten: true,
      noDesktopActionExecuted: true,
      noScreenshotCaptured: true,
      noUiaInvoke: true,
      noMouseOrKeyboardInput: true,
      note: "Fixture sandbox evaluates synthetic protocol contexts only. It does not touch the real approval token store or snapshot store.",
    },
  };
}
