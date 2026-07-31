import { ACTION_RISKS, classifyAction, normalizeRisk } from "./action-risk.js";
import { getControlSession, matchesControlSessionScope } from "./control-session.js";
import { CONFIRMATION_LEVELS, resolveActionConfirmation, resolveActionPolicy } from "./action-policy.js";

export const PERMISSION_MODES = Object.freeze({
  SAFE: "safe",
  AUTO_REVIEW: "auto-review",
  FULL_ACCESS: "full-access",
});

export const CONFIRMATION_POLICIES = Object.freeze({
  ALL_REAL_ACTIONS: "all-real-actions",
  SENSITIVE_AND_DESTRUCTIVE: "sensitive-and-destructive",
  DESTRUCTIVE_ONLY: "destructive-only",
});

const MODE_VALUES = Object.values(PERMISSION_MODES);
const CONFIRMATION_POLICY_VALUES = Object.values(CONFIRMATION_POLICIES);
const CONFIRMATION = "I_UNDERSTAND_DESKTOP_INPUT";

export function normalizePermissionMode(value, fallback = PERMISSION_MODES.SAFE) {
  const normalized = String(value || "").trim().toLowerCase();
  if (MODE_VALUES.includes(normalized)) return normalized;
  if (normalized === "manual" || normalized === "strict") return PERMISSION_MODES.SAFE;
  if (normalized === "auto" || normalized === "automatic") return PERMISSION_MODES.AUTO_REVIEW;
  if (normalized === "full" || normalized === "unrestricted") return PERMISSION_MODES.FULL_ACCESS;
  return fallback;
}

export function normalizeConfirmationPolicy(value, fallback = CONFIRMATION_POLICIES.ALL_REAL_ACTIONS) {
  const normalized = String(value || "").trim().toLowerCase();
  if (CONFIRMATION_POLICY_VALUES.includes(normalized)) return normalized;
  if (normalized === "all" || normalized === "strict") return CONFIRMATION_POLICIES.ALL_REAL_ACTIONS;
  if (normalized === "sensitive" || normalized === "sensitive-and-destructive") return CONFIRMATION_POLICIES.SENSITIVE_AND_DESTRUCTIVE;
  if (normalized === "destructive" || normalized === "critical") return CONFIRMATION_POLICIES.DESTRUCTIVE_ONLY;
  return fallback;
}

function defaultConfirmationPolicyForMode(mode) {
  switch (normalizePermissionMode(mode)) {
    case PERMISSION_MODES.FULL_ACCESS:
      return CONFIRMATION_POLICIES.DESTRUCTIVE_ONLY;
    case PERMISSION_MODES.AUTO_REVIEW:
      return CONFIRMATION_POLICIES.SENSITIVE_AND_DESTRUCTIVE;
    default:
      return CONFIRMATION_POLICIES.ALL_REAL_ACTIONS;
  }
}

function resolveConfirmationPolicy(config, mode) {
  if (config && Object.prototype.hasOwnProperty.call(config, "confirmationPolicy")) {
    return normalizeConfirmationPolicy(config.confirmationPolicy, defaultConfirmationPolicyForMode(mode));
  }
  return defaultConfirmationPolicyForMode(mode);
}

export function confirmationPolicyAllows({ policy, risk } = {}) {
  const normalizedPolicy = normalizeConfirmationPolicy(policy);
  const normalizedRisk = normalizeRisk(risk);

  if (normalizedRisk === ACTION_RISKS.OBSERVE) return true;
  if (normalizedPolicy === CONFIRMATION_POLICIES.ALL_REAL_ACTIONS) return false;
  if (normalizedPolicy === CONFIRMATION_POLICIES.SENSITIVE_AND_DESTRUCTIVE) {
    return normalizedRisk === ACTION_RISKS.COMMON;
  }
  return normalizedRisk === ACTION_RISKS.COMMON || normalizedRisk === ACTION_RISKS.SENSITIVE;
}

function actionConfirmationAllows({ actionPolicy, config, mode, risk }) {
  if (actionPolicy.hardConfirmation === true) return false;
  if (actionPolicy.key === "window.close" && normalizePermissionMode(mode) !== PERMISSION_MODES.FULL_ACCESS) return false;
  if (normalizeRisk(risk) === ACTION_RISKS.DESTRUCTIVE && actionPolicy.key !== "window.close") return false;
  return resolveActionConfirmation(actionPolicy.key, config).level === CONFIRMATION_LEVELS.AUTO;
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
  const configuredMode = config.permissionMode || PERMISSION_MODES.SAFE;
  let mode = normalizePermissionMode(configuredMode, PERMISSION_MODES.SAFE);
  let confirmationPolicy = resolveConfirmationPolicy(config, mode);
  const resolvedRisk = normalizeRisk(risk || classifyAction({ actionType, action, target, input, capability }));
  const actionPolicy = resolveActionPolicy({ actionType, action, target, input, capability });
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
        confirmationPolicy,
        actionKey: actionPolicy.key,
        sessionId,
        requiresConfirmation: false,
        reason: sessionResult.reason,
      };
    }
    session = sessionResult.session;
    mode = normalizePermissionMode(session.mode, mode);
    if (!Object.prototype.hasOwnProperty.call(config, "confirmationPolicy")) {
      confirmationPolicy = defaultConfirmationPolicyForMode(mode);
    }
    sessionScope = matchesControlSessionScope(session, { actionType, action, target, capability });
    if (!sessionScope.ok) {
      return {
        allowed: false,
        dryRun: true,
        mode,
        risk: resolvedRisk,
        confirmationPolicy,
        actionKey: actionPolicy.key,
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
      confirmationPolicy,
      actionKey: actionPolicy.key,
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
      confirmationPolicy,
      actionKey: actionPolicy.key,
      sessionId: session?.sessionId || null,
      requiresConfirmation: false,
      reason: "allowRealInput 未开启，请在插件设置中开启",
      sessionScope,
    };
  }

  const actionConfirmation = resolveActionConfirmation(actionPolicy.key, config);
  const actionOverrideAllows = actionConfirmationAllows({ actionPolicy, config, mode, risk: resolvedRisk });
  const modeAllowsAction = permissionModeAllows({ mode, risk: resolvedRisk })
    || (actionPolicy.key === "window.close" && mode === PERMISSION_MODES.FULL_ACCESS);
  const confirmationAllowsAction = actionPolicy.key === "unknown"
    ? confirmationPolicyAllows({ policy: confirmationPolicy, risk: resolvedRisk })
    : actionConfirmation.explicit
      ? actionOverrideAllows
      : actionPolicy.defaultLevel === CONFIRMATION_LEVELS.AUTO
        && confirmationPolicyAllows({ policy: confirmationPolicy, risk: resolvedRisk });
  const actionPolicyResult = {
    title: actionPolicy.title,
    level: actionConfirmation.explicit ? actionConfirmation.level : actionPolicy.defaultLevel,
    configurable: actionPolicy.configurable === true,
    hardConfirmation: actionPolicy.hardConfirmation === true,
  };
  if (modeAllowsAction && confirmationAllowsAction) {
    return {
      allowed: true,
      dryRun: false,
      mode,
      risk: resolvedRisk,
      confirmationPolicy,
      actionKey: actionPolicy.key,
      actionPolicy: actionPolicyResult,
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
      confirmationPolicy,
      actionKey: actionPolicy.key,
      actionPolicy: actionPolicyResult,
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
    confirmationPolicy,
    actionKey: actionPolicy.key,
    actionPolicy: actionPolicyResult,
    sessionId: session?.sessionId || null,
    requiresConfirmation: true,
    reason: `需要确认短语 ${CONFIRMATION}（${mode}/${confirmationPolicy}/${actionPolicy.key}/${resolvedRisk}）`,
    sessionScope,
  };
}

export function buildPermissionPolicySummary({ mode, actionType, risk, confirmationPolicy } = {}) {
  const normalizedMode = normalizePermissionMode(mode);
  const normalizedRisk = normalizeRisk(risk);
  const resolvedConfirmationPolicy = normalizeConfirmationPolicy(
    confirmationPolicy,
    defaultConfirmationPolicyForMode(normalizedMode),
  );
  return {
    mode: normalizedMode,
    actionType: actionType || "unknown",
    risk: normalizedRisk,
    confirmationPolicy: resolvedConfirmationPolicy,
    automatic: permissionModeAllows({ mode: normalizedMode, risk: normalizedRisk })
      && confirmationPolicyAllows({ policy: resolvedConfirmationPolicy, risk: normalizedRisk }),
    destructiveAlwaysConfirms: true,
  };
}
