import crypto from "crypto";
import { buildElementSignature } from "./element-signature.js";
import { APPROVAL_BUNDLE_VERSION, buildApprovalBundle, hashApprovalBundle } from "./approval-bundle.js";
import { APPROVAL_TOKEN_VERSION } from "./approval-token-store.js";

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

function buildFixtureContext({ expired = false, hashMismatch = false, signatureMismatch = false, executable = false, bundleHashMismatch = false, missingBundleHash = false, currentBundleChanged = false, legacyBundle = false, bundleHashTampered = false, unsupportedBundleVersion = false, unsupportedTokenVersion = false } = {}) {
  const element = buildFixtureElement(signatureMismatch
    ? { bounds: { left: 101, top: 100, right: 221, bottom: 140, width: 120, height: 40, centerX: 161, centerY: 120 } }
    : {});
  const expectedElement = buildFixtureElement();
  const expectedSignature = buildElementSignature(expectedElement);
  const target = {
    leaseId: "fixture-lease",
    snapshotId: "fixture-snapshot",
    elementId: "el-0",
    handle: "fixture-handle",
    expectedName: "Fixture Button",
    elementSignature: expectedSignature,
  };
  const bundle = buildApprovalBundle({
    actionType: "fixture-click",
    risk: "fixture",
    target,
    plan: { type: "fixture-click", target },
    cursorOverlay: { kind: "cursor-overlay", target: { center: { x: 160, y: 120 } } },
    verificationRequest: { type: "fixture-verification", actionType: "fixture-click" },
    capability: { supportsInvoke: true },
    safetyNotes: ["fixture"],
  });
  const currentBundle = legacyBundle
    ? (() => {
        const { bundleHash, ...legacy } = bundle;
        return legacy;
      })()
    : currentBundleChanged
      ? { ...bundle, safety: { ...bundle.safety, notes: ["changed"] } }
      : bundle;
  if (bundleHashTampered) currentBundle.bundleHash = `tampered-${bundle.bundleHash.slice(0, 16)}`;
  if (unsupportedBundleVersion) currentBundle.version = 1;
  const now = Date.now();
  const token = {
    type: TOKEN_TYPE,
    version: unsupportedTokenVersion ? 1 : APPROVAL_TOKEN_VERSION,
    executable,
    createdAt: new Date(now).toISOString(),
    actionType: "fixture-click",
    risk: "fixture",
    approvalBundleHash: missingBundleHash
      ? null
      : bundleHashMismatch
        ? `tampered-${bundle.bundleHash.slice(0, 16)}`
        : bundle.bundleHash,
    target,
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
  return { token, record, snapshot, approvalBundle: currentBundle, actualHash, expectedSignature };
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
  checks.push({ name: "token-version-supported", passed: token?.version === APPROVAL_TOKEN_VERSION, expectedVersion: APPROVAL_TOKEN_VERSION, actualVersion: token?.version ?? null });
  checks.push({ name: "token-non-executable", passed: token?.executable === false, executable: token?.executable ?? null });
  checks.push({ name: "token-not-expired", passed: Date.parse(context.record?.expiresAt || "") > now, expiresAt: context.record?.expiresAt || null });
  checks.push({ name: "token-hash-match", passed: context.actualHash === context.record?.tokenHash, expectedHash: context.record?.tokenHash || null, actualHash: context.actualHash });
  checks.push({ name: "target-fields-present", passed: Boolean(target.leaseId && target.snapshotId && target.elementId && target.elementSignature), target });
  const actualBundleHash = context.approvalBundle ? hashApprovalBundle(context.approvalBundle) : null;
  const currentBundleHash = typeof context.approvalBundle?.bundleHash === "string" ? context.approvalBundle.bundleHash : null;
  checks.push({ name: "approval-bundle-fields-present", passed: Boolean(token?.approvalBundleHash), approvalBundleHash: token?.approvalBundleHash || null });
  checks.push({ name: "approval-bundle-live", passed: Boolean(context.approvalBundle), target: context.approvalBundle?.target || null });
  checks.push({ name: "approval-bundle-version-supported", passed: context.approvalBundle?.version === APPROVAL_BUNDLE_VERSION, expectedVersion: APPROVAL_BUNDLE_VERSION, actualVersion: context.approvalBundle?.version ?? null });
  checks.push({ name: "approval-bundle-hash-present", passed: Boolean(currentBundleHash), bundleHash: currentBundleHash });
  checks.push({ name: "approval-bundle-hash-integrity", passed: Boolean(currentBundleHash && actualBundleHash && currentBundleHash === actualBundleHash), expectedHash: actualBundleHash, storedHash: currentBundleHash });
  checks.push({ name: "approval-bundle-hash-match", passed: Boolean(token?.approvalBundleHash && currentBundleHash === actualBundleHash && token.approvalBundleHash === actualBundleHash), expectedHash: token?.approvalBundleHash || null, actualHash: actualBundleHash });
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
    runCase("bundle-hash-mismatch-blocks", { bundleHashMismatch: true }, false),
    runCase("bundle-hash-missing-blocks", { missingBundleHash: true }, false),
    runCase("current-bundle-change-blocks", { currentBundleChanged: true }, false),
    runCase("legacy-bundle-blocks", { legacyBundle: true }, false),
    runCase("bundle-hash-tamper-blocks", { bundleHashTampered: true }, false),
    runCase("unsupported-bundle-version-blocks", { unsupportedBundleVersion: true }, false),
    runCase("unsupported-token-version-blocks", { unsupportedTokenVersion: true }, false),
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
