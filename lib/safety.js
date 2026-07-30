import os from "node:os";
import fs from "node:fs";
import path from "node:path";

export const REAL_INPUT_CONFIRMATION = "I_UNDERSTAND_DESKTOP_INPUT";

// Resolve the effective plugin config for a tool call.
// Reads config from the well-known plugin-data path regardless of toolCtx.dataDir.
// The host may inject toolCtx.config as defaults; config.json values win.
// Fail-closed: any IO/parse error yields injected config only, so a missing or
// corrupt file never enables high-risk input on its own.
export function resolvePluginConfig(toolCtx = {}) {
  const injected = (toolCtx && typeof toolCtx.config === "object" && toolCtx.config) || {};
  let fileConfig = {};
  try {
    const configPath = path.join(os.homedir(), ".hanako", "plugin-data", "desktop-orchestrator", "config.json");
    if (fs.existsSync(configPath)) {
      let raw = fs.readFileSync(configPath, "utf8");
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // Strip BOM
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.global === "object") {
        fileConfig = parsed.global;
      }
    }
  } catch {
    // fail-closed: return injected config unchanged
  }
  // File config wins over injected (Hana settings panel overrides host defaults)
  return { ...injected, ...fileConfig };
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
  const confirmationSatisfied = input.confirmation === REAL_INPUT_CONFIRMATION;

  if (dryRun) {
    return { allowed: false, dryRun: true, reason: "dry-run" };
  }

  if (!allowRealInput) {
    return {
      allowed: false,
      dryRun: true,
      reason: "allowRealInput 未开启，请在插件设置中开启",
    };
  }

  // The human confirmation gate is unconditional. Persisted settings cannot turn
  // a real-input call into an implicitly approved action.
  if (!confirmationSatisfied) {
    return {
      allowed: false,
      dryRun: true,
      reason: `需要确认短语 ${REAL_INPUT_CONFIRMATION}`,
    };
  }

  return { allowed: true, dryRun: false };
}

export function buildActionPlan(opts = {}) {
  const { type = "unknown", risk = "medium", target = {}, action = {}, notes = [] } = opts;
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
    notes: notes.length
      ? notes
      : ["No execution plan provided."],
  };
}

export function clampInteger(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
