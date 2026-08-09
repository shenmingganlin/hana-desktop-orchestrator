import assert from "node:assert/strict";
import {
  CONFIRMATION_LEVELS,
  getActionPolicy,
  normalizeActionConfirmation,
  resolveActionKey,
  resolveActionPolicy,
} from "../lib/action-policy.js";
import { decidePermission, PERMISSION_MODES } from "../lib/permission-policy.js";
import { resolvePluginConfig } from "../lib/safety.js";

const realInput = { dryRun: false };
const fullConfig = { allowRealInput: true, permissionMode: PERMISSION_MODES.FULL_ACCESS };
const cases = [];

function check(name, passed, details = {}) {
  const result = { name, passed: Boolean(passed), ...details };
  cases.push(result);
  assert.equal(result.passed, true, `${name} failed`);
}

check("window-close-key", resolveActionKey({ actionType: "manage-window", action: { type: "close" } }) === "window.close");
check("keyboard-fallback-key", resolveActionKey({ actionType: "type-element", input: { fallback: "keyboard" }, capability: { fallback: "keyboard" } }) === "input.keyboard-fallback");
check("clipboard-fallback-key", resolveActionKey({ actionType: "type-element", input: { fallback: "clipboard" }, capability: { fallback: "clipboard" } }) === "input.clipboard-fallback");
check("value-pattern-key", resolveActionKey({ actionType: "type-element", input: { fallback: "keyboard" }, capability: { supportsValue: true } }) === "element.type");
check("hard-floor-send", getActionPolicy("external.send")?.hardConfirmation === true && getActionPolicy("external.send")?.configurable === false);
check("normalization-drops-unknown-and-hard-floor", JSON.stringify(normalizeActionConfirmation({
  "window.close": "auto",
  "external.send": "auto",
  "unknown.action": "auto",
})) === JSON.stringify({ "window.close": CONFIRMATION_LEVELS.AUTO }));
check("unknown-actions-fail-closed", resolveActionPolicy({ actionType: "future-tool" }).hardConfirmation === true);

const hostConfig = resolvePluginConfig({ config: { permissionMode: "host-priority", actionConfirmation: { "window.focus": "confirm" } } });
check("host-config-overrides-compatibility-file", hostConfig.permissionMode === "host-priority" && hostConfig.actionConfirmation?.["window.focus"] === "confirm", { permissionMode: hostConfig.permissionMode, actionConfirmation: hostConfig.actionConfirmation });

const ordinary = decidePermission({ input: realInput, config: fullConfig, actionType: "focus-window" });
check("full-access-ordinary-default-auto", ordinary.allowed === true && ordinary.actionKey === "window.focus" && ordinary.requiresConfirmation === false, ordinary);

const closeDefault = decidePermission({ input: realInput, config: fullConfig, actionType: "manage-window", action: { type: "close" } });
check("full-access-close-is-automatic", closeDefault.allowed === true && closeDefault.requiresConfirmation === false && closeDefault.actionKey === "window.close" && closeDefault.actionPolicy.level === "auto", closeDefault);

const closeAuto = decidePermission({
  input: realInput,
  config: { ...fullConfig, actionConfirmation: { "window.close": "auto" } },
  actionType: "manage-window",
  action: { type: "close" },
});
check("full-access-ignores-action-override", closeAuto.allowed === true && closeAuto.actionPolicy.level === "auto", closeAuto);

const keyboardDefault = decidePermission({ input: { ...realInput, fallback: "keyboard" }, config: fullConfig, actionType: "type-element", capability: { fallback: "keyboard" } });
check("full-access-keyboard-is-automatic", keyboardDefault.allowed === true && keyboardDefault.requiresConfirmation === false && keyboardDefault.actionKey === "input.keyboard-fallback" && keyboardDefault.actionPolicy.level === "auto", keyboardDefault);

const keyboardAuto = decidePermission({
  input: { ...realInput, fallback: "keyboard" },
  config: { ...fullConfig, actionConfirmation: { "input.keyboard-fallback": "auto" } },
  actionType: "type-element",
  capability: { fallback: "keyboard" },
});
check("full-access-ignores-keyboard-override", keyboardAuto.allowed === true && keyboardAuto.actionPolicy.level === "auto", keyboardAuto);

const clipboardAuto = decidePermission({
  input: { ...realInput, fallback: "clipboard" },
  config: { ...fullConfig, actionConfirmation: { "input.clipboard-fallback": "auto" } },
  actionType: "type-element",
  capability: { fallback: "clipboard" },
});
check("clipboard-user-override-auto", clipboardAuto.allowed === true && clipboardAuto.actionPolicy.level === "auto", clipboardAuto);

const sendAttempt = decidePermission({
  input: realInput,
  config: { ...fullConfig, actionConfirmation: { "external.send": "auto" } },
  actionType: "click-element",
  target: { name: "发送" },
});
check("full-access-send-is-automatic", sendAttempt.allowed === true && sendAttempt.requiresConfirmation === false && sendAttempt.actionKey === "external.send" && sendAttempt.actionPolicy.level === "auto", sendAttempt);

const credentialAttempt = decidePermission({
  input: { ...realInput, text: "password" },
  config: { ...fullConfig, actionConfirmation: { "element.type": "auto", "credential.secret": "auto" } },
  actionType: "type-element",
});
check("full-access-credential-is-automatic", credentialAttempt.allowed === true && credentialAttempt.requiresConfirmation === false && credentialAttempt.actionKey === "credential.secret" && credentialAttempt.actionPolicy.level === "auto", credentialAttempt);

const safeOverride = decidePermission({
  input: realInput,
  config: { allowRealInput: true, permissionMode: PERMISSION_MODES.SAFE, actionConfirmation: { "window.focus": "auto" } },
  actionType: "focus-window",
});
check("action-override-cannot-bypass-safe-mode", safeOverride.allowed === false && safeOverride.requiresConfirmation === true, safeOverride);

const result = {
  ok: true,
  type: "desktop-orchestrator-action-policy-matrix",
  version: 1,
  summary: { total: cases.length, passed: cases.length, failed: 0, allPassed: true },
  cases,
  safety: {
    pureInMemory: true,
    noConfigWritten: true,
    noDesktopActionExecuted: true,
    noScreenshotCaptured: true,
    noUiaInvoke: true,
    noMouseOrKeyboardInput: true,
  },
};
console.log(JSON.stringify(result, null, 2));
