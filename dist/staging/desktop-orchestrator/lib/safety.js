import fs from "node:fs";
import path from "node:path";

export const REAL_INPUT_CONFIRMATION = "I_UNDERSTAND_DESKTOP_INPUT";

// Resolve the effective plugin config for a tool call.
// The host may inject toolCtx.config; in some platform versions that object is
// empty even though the user-facing config.json under dataDir holds the real
// values. Prefer the injected config and fall back to reading
// dataDir/config.json (global scope). Fail-closed: any IO/parse error yields
// the injected config unchanged, so a missing/corrupt file never enables
// high-risk input on its own.
export function resolvePluginConfig(toolCtx = {}) {
  const injected = (toolCtx && typeof toolCtx.config === "object" && toolCtx.config) || {};
  if (Object.prototype.hasOwnProperty.call(injected, "allowRealInput")) {
    return injected;
  }
  const dataDir = typeof toolCtx?.dataDir === "string" ? toolCtx.dataDir : "";
  if (!dataDir) return injected;
  try {
    const file = path.join(dataDir, "config.json");
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    const globalScope = (parsed && typeof parsed.global === "object" && parsed.global) || {};
    return { ...globalScope, ...injected };
  } catch {
    return injected;
  }
}

export function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function requireRealInputApproval(input = {}, config = {}) {
  const dryRun = normalizeBoolean(input.dryRun, true);
  const allowRealInput = config.allowRealInput === true;

  if (dryRun) {
    return { allowed: false, dryRun: true, reason: "dry-run" };
  }

  if (!allowRealInput) {
    return {
      allowed: false,
      dryRun: true,
      reason: "real-input-disabled-by-config",
      message: "Real desktop input is disabled by plugin configuration.",
    };
  }

  if (input.confirmation !== REAL_INPUT_CONFIRMATION) {
    return {
      allowed: false,
      dryRun: true,
      reason: "missing-confirmation-phrase",
      message: `Real desktop input requires confirmation: ${REAL_INPUT_CONFIRMATION}`,
    };
  }

  return { allowed: true, dryRun: false, reason: "approved" };
}

export function buildActionPlan({ type, target = {}, action = {}, risk = "medium", notes = [] }) {
  return {
    type,
    risk,
    target,
    action,
    preconditions: [
      "Target window should be identified before foreground input.",
      "Screen coordinates should be validated against a fresh snapshot.",
    ],
    verification: [
      "Capture a new snapshot after the action.",
      "Compare active window and visible state before continuing.",
    ],
    notes,
  };
}

export function clampInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(number);
}
