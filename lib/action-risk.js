export const ACTION_RISKS = Object.freeze({
  OBSERVE: "observe",
  COMMON: "common",
  SENSITIVE: "sensitive",
  DESTRUCTIVE: "destructive",
});

const DESTRUCTIVE_TERMS = [
  "delete", "remove", "erase", "destroy", "close", "shutdown", "kill",
  "删除", "移除", "清空", "关闭", "关机", "终止", "注销", "发送", "提交", "发布",
  "支付", "购买", "转账", "密码", "password", "credential", "secret",
];

const SENSITIVE_TERMS = [
  "send", "submit", "publish", "login", "sign-in", "signin", "payment", "checkout",
  "clipboard", "keyboard", "raw", "coordinate", "vision", "password", "token",
  "发送", "提交", "发布", "登录", "支付", "剪贴板", "键盘", "坐标", "密码", "令牌",
];

const OBSERVE_ACTIONS = new Set([
  "list-windows", "snapshot", "ui-tree", "find-control", "inspect-window",
  "plan-action", "region-preview", "verify-action", "visual-verify", "vision-query",
  "vision-click", "self-check", "protocol-test-matrix", "fixture-sandbox", "cockpit-summary",
]);

function textOf(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).toLowerCase();
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (typeof value === "object") return Object.values(value).map(textOf).join(" ");
  return "";
}

function containsTerm(text, terms) {
  return terms.some((term) => text.includes(term));
}

export function normalizeRisk(value, fallback = ACTION_RISKS.SENSITIVE) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.values(ACTION_RISKS).includes(normalized) ? normalized : fallback;
}

export function classifyAction({ actionType = "unknown", action = null, target = null, input = null, capability = null } = {}) {
  const type = String(actionType || "unknown").trim().toLowerCase();
  const contextText = textOf({ type, action, target, input, capability });

  if (OBSERVE_ACTIONS.has(type)) return ACTION_RISKS.OBSERVE;
  if (type === "manage-window" && String(action?.type || action?.action || "").toLowerCase() === "close") {
    return ACTION_RISKS.DESTRUCTIVE;
  }
  if (containsTerm(contextText, DESTRUCTIVE_TERMS)) return ACTION_RISKS.DESTRUCTIVE;
  if (type === "protected-click" || type === "mouse-click-at" || type === "mouse-drag" || type === "vision-click") {
    return ACTION_RISKS.SENSITIVE;
  }
  if (containsTerm(contextText, SENSITIVE_TERMS)) return ACTION_RISKS.SENSITIVE;
  if (["click-element", "type-element", "mouse-wheel", "focus-window", "manage-window"].includes(type)) {
    return ACTION_RISKS.COMMON;
  }
  return ACTION_RISKS.SENSITIVE;
}

export function describeRisk(risk) {
  const normalized = normalizeRisk(risk);
  return {
    risk: normalized,
    destructive: normalized === ACTION_RISKS.DESTRUCTIVE,
    requiresConfirmationByDefault: normalized === ACTION_RISKS.SENSITIVE || normalized === ACTION_RISKS.DESTRUCTIVE,
  };
}
