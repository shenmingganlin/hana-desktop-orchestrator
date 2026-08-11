import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { decidePermission } from "./permission-policy.js";

export const REAL_INPUT_CONFIRMATION = "I_UNDERSTAND_DESKTOP_INPUT";

// This text is part of the tool contract exposed to the model. It prevents a
// model from turning the legacy confirmation phrase into a second prompt after
// the plugin has already entered full-access mode.
export const SINGLE_AUTHORIZATION_DESCRIPTION =
  "full-access 且 allowRealInput=true 时使用插件单一授权层，不要额外向用户索要 I_UNDERSTAND_DESKTOP_INPUT；仅当插件实际返回 requiresConfirmation=true 或 allowed=false 且 reason 明确要求确认时才请求用户确认。安全模式与自动复核模式仍按各自策略确认。";

export function buildAuthorizationStatus({ config = {}, approval = null } = {}) {
  const fullAccess = String(config.permissionMode || "").trim().toLowerCase() === "full-access";
  const allowRealInput = config.allowRealInput === true;
  return {
    mode: approval?.mode || config.permissionMode || "safe",
    allowRealInput,
    singleAuthorizationLayer: fullAccess && allowRealInput,
    requiresAdditionalConfirmation: approval?.requiresConfirmation === true,
    pluginDecision: approval?.allowed === true ? "allowed" : approval?.allowed === false ? "blocked" : "not-evaluated",
    instruction: SINGLE_AUTHORIZATION_DESCRIPTION,
  };
}

// Resolve the effective plugin config for a tool call.
// Reads config from the well-known plugin-data path regardless of toolCtx.dataDir.
// The host may inject toolCtx.config as the current source of truth; config.json
// remains a compatibility fallback for standalone installs and older hosts.
// Fail-closed: any IO/parse error yields the injected config only.
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
  // Hana's config service wins over the compatibility file when both provide a key.
  return { ...fileConfig, ...injected };
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
    authorization: buildAuthorizationStatus({ config, approval: decision }),
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
