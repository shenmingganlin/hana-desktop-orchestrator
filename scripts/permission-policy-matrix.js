import assert from "node:assert/strict";
import { ACTION_RISKS, classifyAction } from "../lib/action-risk.js";
import { PERMISSION_MODES, decidePermission, permissionModeAllows } from "../lib/permission-policy.js";

const config = { allowRealInput: true };
const realInput = { dryRun: false };

const expected = [
  [PERMISSION_MODES.SAFE, ACTION_RISKS.OBSERVE, true],
  [PERMISSION_MODES.SAFE, ACTION_RISKS.COMMON, false],
  [PERMISSION_MODES.SAFE, ACTION_RISKS.SENSITIVE, false],
  [PERMISSION_MODES.SAFE, ACTION_RISKS.DESTRUCTIVE, false],
  [PERMISSION_MODES.AUTO_REVIEW, ACTION_RISKS.OBSERVE, true],
  [PERMISSION_MODES.AUTO_REVIEW, ACTION_RISKS.COMMON, true],
  [PERMISSION_MODES.AUTO_REVIEW, ACTION_RISKS.SENSITIVE, false],
  [PERMISSION_MODES.AUTO_REVIEW, ACTION_RISKS.DESTRUCTIVE, false],
  [PERMISSION_MODES.FULL_ACCESS, ACTION_RISKS.OBSERVE, true],
  [PERMISSION_MODES.FULL_ACCESS, ACTION_RISKS.COMMON, true],
  [PERMISSION_MODES.FULL_ACCESS, ACTION_RISKS.SENSITIVE, true],
  [PERMISSION_MODES.FULL_ACCESS, ACTION_RISKS.DESTRUCTIVE, false],
];

const cases = [];
for (const [mode, risk, allowed] of expected) {
  const decision = decidePermission({ input: realInput, config: { ...config, permissionMode: mode }, actionType: "test", risk });
  assert.equal(decision.allowed, allowed, `${mode}/${risk} expected allowed=${allowed}`);
  assert.equal(permissionModeAllows({ mode, risk }), allowed);
  cases.push({ name: `${mode}/${risk}`, passed: true, allowed, reason: decision.reason });
}

const confirmed = decidePermission({
  input: { ...realInput, confirmation: "I_UNDERSTAND_DESKTOP_INPUT" },
  config: { ...config, permissionMode: PERMISSION_MODES.SAFE },
  actionType: "test",
  risk: ACTION_RISKS.SENSITIVE,
});
assert.equal(confirmed.allowed, true);
assert.equal(confirmed.requiresConfirmation, true);
cases.push({ name: "safe/sensitive-explicit-confirmation", passed: true, allowed: true });

const dryRun = decidePermission({ input: { dryRun: true }, config: { ...config, permissionMode: PERMISSION_MODES.FULL_ACCESS }, actionType: "test", risk: ACTION_RISKS.COMMON });
assert.equal(dryRun.allowed, false);
assert.equal(dryRun.reason, "dry-run");
cases.push({ name: "all-modes-dry-run-remains-blocked", passed: true, allowed: false });

const disabled = decidePermission({ input: realInput, config: { permissionMode: PERMISSION_MODES.FULL_ACCESS, allowRealInput: false }, actionType: "test", risk: ACTION_RISKS.COMMON });
assert.equal(disabled.allowed, false);
assert.match(disabled.reason, /allowRealInput/);
cases.push({ name: "permission-mode-does-not-enable-master-switch", passed: true, allowed: false });

assert.equal(classifyAction({ actionType: "manage-window", action: { type: "close" } }), ACTION_RISKS.DESTRUCTIVE);
assert.equal(classifyAction({ actionType: "type-element", input: { text: "hello" } }), ACTION_RISKS.COMMON);
assert.equal(classifyAction({ actionType: "type-element", input: { text: "password" } }), ACTION_RISKS.DESTRUCTIVE);
assert.equal(classifyAction({ actionType: "ui-tree" }), ACTION_RISKS.OBSERVE);
cases.push({ name: "action-classifier-boundaries", passed: true });

const result = {
  ok: true,
  type: "desktop-orchestrator-permission-policy-matrix",
  version: 1,
  summary: { total: cases.length, passed: cases.length, failed: 0, allPassed: true },
  cases,
  safety: {
    pureInMemory: true,
    noDesktopActionExecuted: true,
    noScreenshotCaptured: true,
    noUiaInvoke: true,
    noMouseOrKeyboardInput: true,
  },
};
console.log(JSON.stringify(result, null, 2));
