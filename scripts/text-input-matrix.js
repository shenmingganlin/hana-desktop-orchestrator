import assert from "node:assert/strict";
import {
  TEXT_INPUT_FALLBACKS,
  buildTextInputFallbackPlan,
  normalizeTextInputFallback,
  validateTextInput,
} from "../lib/text-input.js";

const cases = [];
function check(name, passed, details = {}) {
  cases.push({ name, passed: Boolean(passed), ...details });
}

try {
  check("keyboard-is-default", normalizeTextInputFallback("") === TEXT_INPUT_FALLBACKS.KEYBOARD);
  check("clipboard-normalizes", normalizeTextInputFallback(" CLIPBOARD ") === TEXT_INPUT_FALLBACKS.CLIPBOARD);
  check("unknown-fallback-fails-closed-to-keyboard", normalizeTextInputFallback("shell") === TEXT_INPUT_FALLBACKS.KEYBOARD);

  const keyboard = validateTextInput({ handle: "123", text: "你好\nworld", fallback: "keyboard" });
  check("keyboard-validates", keyboard.ok === true && keyboard.textLength === 8, { keyboard });

  const clipboard = validateTextInput({ handle: "123", text: "plain text", fallback: "clipboard" });
  check("clipboard-validates", clipboard.ok === true && clipboard.maxLength === 24000, { clipboard });

  const noHandle = validateTextInput({ handle: "", text: "x", fallback: "keyboard" });
  check("handle-required", noHandle.ok === false && noHandle.reason === "fallback-target-handle-required", { noHandle });

  const nullText = validateTextInput({ handle: "123", text: "a\u0000b", fallback: "keyboard" });
  check("null-character-blocks", nullText.ok === false && nullText.reason === "text-contains-null-character", { nullText });

  const tooLong = validateTextInput({ handle: "123", text: "x".repeat(12001), fallback: "keyboard" });
  check("keyboard-length-limit", tooLong.ok === false && tooLong.reason === "text-too-long-for-fallback", { tooLong });

  const keyboardPlan = buildTextInputFallbackPlan({ handle: "123", elementId: "el-4", text: "abc", fallback: "keyboard" });
  check("keyboard-plan-is-foreground-guarded", keyboardPlan.action.type === "send-input-unicode" && keyboardPlan.action.requiresForegroundTarget === true, { keyboardPlan });

  const clipboardPlan = buildTextInputFallbackPlan({ handle: "123", elementId: "el-4", text: "abc", fallback: "clipboard" });
  check("clipboard-plan-records-restore", clipboardPlan.action.type === "clipboard-assisted-paste" && clipboardPlan.action.clipboardRestored === true, { clipboardPlan });

  assert.equal(cases.some((item) => item.passed === false), false);
} catch (error) {
  cases.push({ name: "matrix-exception", passed: false, error: error?.message || String(error) });
}

const summary = {
  total: cases.length,
  passed: cases.filter((item) => item.passed).length,
  failed: cases.filter((item) => !item.passed).length,
  allPassed: cases.every((item) => item.passed),
};
const result = {
  ok: summary.allPassed,
  type: "desktop-orchestrator-text-input-matrix",
  summary,
  cases,
  safety: {
    pureInMemory: true,
    noDesktopActionExecuted: true,
    noScreenshotCaptured: true,
    noUiaInvoke: true,
    noMouseOrKeyboardInput: true,
    noClipboardReadOrWrite: true,
  },
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
