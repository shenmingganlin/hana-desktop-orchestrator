import { ACTION_RISKS, classifyAction, normalizeRisk } from "./action-risk.js";
import { getControlSession, matchesControlSessionScope } from "./control-session.js";

export const PERMISSION_MODES = Object.freeze({
  SAFE: "safe",
  AUTO_REVIEW: "auto-review",
  FULL_ACCESS: "full-access",
});

const MODE_VALUES = Object.values(PERMISSION_MODES);
const CONFIRMATION = "I_UNDERSTAND_DESKTOP_INPUT";

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
  let mode = normalizePermissionMode(config.permissionMode || config.trustMode, PERMISSION_MODES.SAFE);
  const resolvedRisk = normalizeRisk(risk || classifyAction({ actionType, action, target, input, capability }));
  const confirmationSatisfied = input.confirmation === CONFIRMATION;
  const sessionId = String(input.sessionId || "").trim();
  let session = null;
  let sessionScope = null;

  if (sessionId) {
    const sessionResult = getControlSession(sessionId);
    if (!sessionResult.ok) {
      return {
        allowed: false,
        dryRun: true,
        mode,
        risk: resolvedRisk,
        sessionId,
        requiresConfirmation: false,
        reason: sessionResult.reason,
      };
    }
    session = sessionResult.session;
    mode = normalizePermissionMode(session.mode, mode);
    sessionScope = matchesControlSessionScope(session, { actionType, action, target, capability });
    if (!sessionScope.ok) {
      return {
        allowed: false,
        dryRun: true,
        mode,
        risk: resolvedRisk,
        sessionId,
        requiresConfirmation: false,
        reason: sessionScope.reason,
        sessionScope,
      };
    }
  }

  if (dryRun) {
    return {
      allowed: false,
      dryRun: true,
      mode,
      risk: resolvedRisk,
      sessionId: session?.sessionId || null,
      requiresConfirmation: false,
      reason: "dry-run",
      sessionScope,
    };
  }

  if (config.allowRealInput !== true) {
    return {
      allowed: false,
      dryRun: true,
      mode,
      risk: resolvedRisk,
      sessionId: session?.sessionId || null,
      requiresConfirmation: false,
      reason: "allowRealInput 未开启，请在插件设置中开启",
      sessionScope,
    };
  }

  if (permissionModeAllows({ mode, risk: resolvedRisk })) {
    return {
      allowed: true,
      dryRun: false,
      mode,
      risk: resolvedRisk,
      sessionId: session?.sessionId || null,
      requiresConfirmation: false,
      reason: "permission-mode-allowed",
      sessionScope,
    };
  }

  if (confirmationSatisfied) {
    return {
      allowed: true,
      dryRun: false,
      mode,
      risk: resolvedRisk,
      sessionId: session?.sessionId || null,
      requiresConfirmation: true,
      reason: "explicit-confirmation",
      sessionScope,
    };
  }

  return {
    allowed: false,
    dryRun: true,
    mode,
    risk: resolvedRisk,
    sessionId: session?.sessionId || null,
    requiresConfirmation: true,
    reason: `需要确认短语 ${CONFIRMATION}（${mode}/${resolvedRisk}）`,
    sessionScope,
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
