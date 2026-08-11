import assert from "node:assert/strict";
import { buildAuthorizationStatus, SINGLE_AUTHORIZATION_DESCRIPTION } from "../lib/safety.js";

const full = buildAuthorizationStatus({
  config: { permissionMode: "full-access", allowRealInput: true },
  approval: { mode: "full-access", allowed: true, requiresConfirmation: false },
});
assert.equal(full.singleAuthorizationLayer, true);
assert.equal(full.requiresAdditionalConfirmation, false);
assert.equal(full.pluginDecision, "allowed");
assert.match(full.instruction, /不要额外向用户索要/);

const blocked = buildAuthorizationStatus({
  config: { permissionMode: "full-access", allowRealInput: true },
  approval: { mode: "full-access", allowed: false, requiresConfirmation: true },
});
assert.equal(blocked.singleAuthorizationLayer, true);
assert.equal(blocked.requiresAdditionalConfirmation, true);
assert.equal(blocked.pluginDecision, "blocked");

const safe = buildAuthorizationStatus({
  config: { permissionMode: "safe", allowRealInput: true },
  approval: { mode: "safe", allowed: false, requiresConfirmation: true },
});
assert.equal(safe.singleAuthorizationLayer, false);
assert.equal(safe.requiresAdditionalConfirmation, true);
assert.ok(SINGLE_AUTHORIZATION_DESCRIPTION.length > 20);

console.log(JSON.stringify({
  ok: true,
  type: "desktop-orchestrator-authorization-contract-matrix",
  summary: { total: 3, passed: 3, failed: 0, allPassed: true },
  cases: [
    "full-access-allowed-is-single-layer",
    "full-access-plugin-block-remains-visible",
    "safe-mode-still-requires-confirmation",
  ],
  safety: { pureInMemory: true, noDesktopActionExecuted: true },
}, null, 2));
