import { ACTION_RISKS, classifyAction, normalizeRisk } from "./action-risk.js";

export const PERMISSION_MODES = Object.freeze({
  SAFE: "safe",
  AUTO_REVIEW: "auto-review",
  FULL_ACCESS: "full-access",
});

const MODE_VALUES = Object.values(PERMISSION_MODES);

export function normalizePermissionMode(value, fallback = PERMISSION_MODES.SAFE) {
  const normalized = String(value || "").trim().toLowerCase();
  if (MODE_VALUES.includes(normalized)) return normalized;
  if (normalized === "manual" || normalized === "strict") return PERMISSION_MODES.SAFE;
  if (normalized === "auto" || normalized === "automatic") return PERMISSION_MODES.AUTO_REVIEW;
  if (normalized === "full" || normalized === "unrestricted") return PERMISSION_MODES.FULL_ACCESS;
  return fallback;
}

export function permissionModeAllows({ mode, risk } = {}) {
  const normalizedMode = normalizePermissionMode(mode);
  const normalizedRisk = normalizeRisk(risk);

  if (normalizedRisk === ACTION_RISKS.OBSERVE) return true;
  if (normalizedRisk === ACTION_RISKS.DESTRUCTIVE) return false;
  if (normalizedMode === PERMISSION_MODES.FULL_ACCESS) return true;
  if (normalizedMode === PERMISSION_MODES.AUTO_REVIEW && normalizedRisk === ACTION_RISKS.COMMON) return true;
  return false;
}

export function decidePermission({ input = {}, config = {}, actionType = "unknown", action = null, target = null, capability = null, risk = null } = {}) {
  const dryRun = !(input.dryRun === false || input.dryRun === "false");
  const mode = normalizePermissionMode(config.permissionMode || config.trustMode, PERMISSION_MODES.SAFE);
  const resolvedRisk = normalizeRisk(risk || classifyAction({ actionType, action, target, input, capability }));
  const confirmationSatisfied = input.confirmation === "I_UNDERSTAND_DESKTOP_INPUT";

  if (dryRun) {
    return {
      allowed: false,
      dryRun: true,
      mode,
      risk: resolvedRisk,
      requiresConfirmation: false,
      reason: "dry-run",
    };
  }

  if (config.allowRealInput !== true) {
    return {
      allowed: false,
      dryRun: true,
      mode,
      risk: resolvedRisk,
      requiresConfirmation: false,
      reason: "allowRealInput 未开启，请在插件设置中开启",
    };
  }

  if (permissionModeAllows({ mode, risk: resolvedRisk })) {
    return {
      allowed: true,
      dryRun: false,
      mode,
      risk: resolvedRisk,
      requiresConfirmation: false,
      reason: "permission-mode-allowed",
    };
  }

  if (confirmationSatisfied) {
    return {
      allowed: true,
      dryRun: false,
      mode,
      risk: resolvedRisk,
      requiresConfirmation: true,
      reason: "explicit-confirmation",
    };
  }

  return {
    allowed: false,
    dryRun: true,
    mode,
    risk: resolvedRisk,
    requiresConfirmation: true,
    reason: `需要确认短语 I_UNDERSTAND_DESKTOP_INPUT（${mode}/${resolvedRisk}）`,
  };
}

export function buildPermissionPolicySummary({ mode, actionType, risk } = {}) {
  const normalizedMode = normalizePermissionMode(mode);
  const normalizedRisk = normalizeRisk(risk);
  return {
    mode: normalizedMode,
    actionType: actionType || "unknown",
    risk: normalizedRisk,
    automatic: permissionModeAllows({ mode: normalizedMode, risk: normalizedRisk }),
    destructiveAlwaysConfirms: true,
  };
}
