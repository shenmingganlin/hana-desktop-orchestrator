import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { decidePermission } from "./permission-policy.js";

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

export function requireRealInputApproval(input = {}, config = {}, context = {}) {
  const decision = decidePermission({
    input,
    config,
    actionType: context.actionType || "unknown",
    action: context.action || null,
    target: context.target || null,
    capability: context.capability || null,
    risk: context.risk || null,
  });
  return {
    ...decision,
    confirmationPhrase: REAL_INPUT_CONFIRMATION,
  };
}

export function isRealActionBlocked({ approvalAllowed = false, actionAllowed = false } = {}) {
  return approvalAllowed !== true || actionAllowed !== true;
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
