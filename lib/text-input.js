import { runHelper } from "./powershell.js";

export const TEXT_INPUT_FALLBACKS = Object.freeze({
  KEYBOARD: "keyboard",
  CLIPBOARD: "clipboard",
});

const MAX_KEYBOARD_TEXT = 12000;
const MAX_CLIPBOARD_TEXT = 24000;

export function normalizeTextInputFallback(value, fallback = TEXT_INPUT_FALLBACKS.KEYBOARD) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.values(TEXT_INPUT_FALLBACKS).includes(normalized) ? normalized : fallback;
}

export function fallbackConfigKey(fallback) {
  return normalizeTextInputFallback(fallback) === TEXT_INPUT_FALLBACKS.CLIPBOARD
    ? "allowClipboardInput"
    : "allowKeyboardInput";
}

export function isTextInputFallbackEnabled(config = {}, fallback) {
  return config?.[fallbackConfigKey(fallback)] === true;
}

export function validateTextInput({ handle, text, fallback = TEXT_INPUT_FALLBACKS.KEYBOARD } = {}) {
  const mode = normalizeTextInputFallback(fallback);
  const value = typeof text === "string" ? text : "";
  const maxLength = mode === TEXT_INPUT_FALLBACKS.CLIPBOARD ? MAX_CLIPBOARD_TEXT : MAX_KEYBOARD_TEXT;
  if (!String(handle || "").trim()) return { ok: false, reason: "fallback-target-handle-required", fallback: mode };
  if (value.includes("\u0000")) return { ok: false, reason: "text-contains-null-character", fallback: mode };
  if (value.length > maxLength) return { ok: false, reason: "text-too-long-for-fallback", fallback: mode, maxLength };
  return { ok: true, fallback: mode, textLength: value.length, maxLength };
}

export function buildTextInputFallbackPlan({ handle, elementId, text, fallback, target = {} } = {}) {
  const validation = validateTextInput({ handle, text, fallback });
  const mode = validation.fallback;
  return {
    fallback: mode,
    target: { ...target, handle: handle || null, elementId: elementId || null },
    action: {
      type: mode === TEXT_INPUT_FALLBACKS.KEYBOARD ? "send-input-unicode" : "clipboard-assisted-paste",
      textLength: typeof text === "string" ? text.length : 0,
      clipboardRestored: mode === TEXT_INPUT_FALLBACKS.CLIPBOARD,
      requiresForegroundTarget: true,
    },
    validation,
    notes: mode === TEXT_INPUT_FALLBACKS.KEYBOARD
      ? ["The native helper sends Unicode key events without focusing another window.", "Foreground target is checked before every logical character."]
      : ["The native helper preserves CF_UNICODETEXT, pastes once, and restores it only if no intervening clipboard change occurred.", "Foreground target is checked before clipboard write and paste."]
  };
}

function parseHelperOutput(result, label) {
  const stdout = String(result?.stdout || "").trim();
  if (stdout) {
    try { return JSON.parse(stdout); } catch { /* return structured failure below */ }
  }
  return {
    ok: false,
    action: label,
    reason: result?.error || result?.stderr || "text-input-helper-failed",
  };
}

export function runTextInputFallback({ handle, text, fallback = TEXT_INPUT_FALLBACKS.KEYBOARD } = {}) {
  const validation = validateTextInput({ handle, text, fallback });
  if (!validation.ok) return validation;
  const result = runHelper(
    validation.fallback === TEXT_INPUT_FALLBACKS.KEYBOARD ? "keyboard-type" : "clipboard-type",
    [String(handle)],
    { timeoutMs: validation.fallback === TEXT_INPUT_FALLBACKS.KEYBOARD ? 30000 : 45000, input: text },
  );
  return { ...parseHelperOutput(result, `${validation.fallback}-type`), helper: result.ok ? "desktop-helper" : null, validation };
}
