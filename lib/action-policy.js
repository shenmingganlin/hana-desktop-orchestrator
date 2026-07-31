import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIRMATION_LEVELS = Object.freeze({
  AUTO: "auto",
  CONFIRM: "confirm",
});

const CONFIG_PATH = path.join(os.homedir(), ".hanako", "plugin-data", "desktop-orchestrator", "config.json");

// These keys are the stable contract used by the settings sidebar and the
// permission gate. Tool names may change; action keys should not.
export const ACTION_POLICIES = Object.freeze([
  { key: "window.focus", title: "聚焦窗口", group: "窗口", tool: "focus-window", defaultLevel: "auto", configurable: true, warning: "聚焦会改变当前前台窗口。" },
  { key: "window.manage", title: "调整窗口状态", group: "窗口", tool: "manage-window", defaultLevel: "auto", configurable: true, warning: "移动、调整大小或改变窗口状态会影响当前桌面布局。" },
  { key: "window.close", title: "关闭窗口", group: "窗口", tool: "manage-window", defaultLevel: "confirm", configurable: true, hardConfirmation: false, warningOnChange: true, warning: "向应用发送关闭指令，部分应用可能直接退出并丢失未保存内容。" },
  { key: "element.click", title: "点击 UIA 元素", group: "UIA 控制", tool: "click-element", defaultLevel: "auto", configurable: true, warning: "点击会触发目标元素的实际交互。" },
  { key: "element.type", title: "控件文本输入", group: "UIA 控制", tool: "type-element", defaultLevel: "auto", configurable: true, warning: "通过控件接口写入文本。密码、凭据等内容仍按高风险分类。" },
  { key: "input.keyboard-fallback", title: "键盘回退输入", group: "输入回退", tool: "type-element", defaultLevel: "confirm", configurable: true, warningOnChange: true, warning: "这里只控制确认频率；是否启用由“允许键盘回退”设置控制。发送前仍会校验焦点和前台窗口。" },
  { key: "input.clipboard-fallback", title: "剪贴板回退输入", group: "输入回退", tool: "type-element", defaultLevel: "confirm", configurable: true, warningOnChange: true, warning: "这里只控制确认频率；是否启用由“允许剪贴板回退”设置控制。会写入剪贴板并粘贴到前台窗口。" },
  { key: "mouse.coordinate-click", title: "坐标点击", group: "鼠标控制", tool: "mouse-click-at", defaultLevel: "confirm", configurable: true, warning: "坐标点击依赖命中窗口守卫，仍可能触发不可预期的界面操作。" },
  { key: "mouse.drag", title: "坐标拖动", group: "鼠标控制", tool: "mouse-drag", defaultLevel: "confirm", configurable: true, warning: "拖动会改变目标界面状态，且坐标路径无法提供 UIA 语义。" },
  { key: "mouse.wheel", title: "坐标滚动", group: "鼠标控制", tool: "mouse-wheel", defaultLevel: "auto", configurable: true, warning: "滚轮会作用于命中窗口下的区域。" },
  { key: "mouse.protected-click", title: "受保护坐标点击", group: "鼠标控制", tool: "protected-click", defaultLevel: "confirm", configurable: true, warning: "无 UIA 语义，必须通过审批链和窗口守卫。" },
  { key: "external.send", title: "外部发送、提交或发布", group: "系统底线", tool: "action-classifier", defaultLevel: "confirm", configurable: false, hardConfirmation: true, warning: "系统底线动作，不能设置为自动执行。" },
  { key: "external.payment", title: "支付、购买或转账", group: "系统底线", tool: "action-classifier", defaultLevel: "confirm", configurable: false, hardConfirmation: true, warning: "系统底线动作，不能设置为自动执行。" },
  { key: "credential.secret", title: "密码、凭据或令牌", group: "系统底线", tool: "action-classifier", defaultLevel: "confirm", configurable: false, hardConfirmation: true, warning: "系统底线动作，不能设置为自动执行。" },
]);

const POLICY_BY_KEY = new Map(ACTION_POLICIES.map((policy) => [policy.key, policy]));

function textOf(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).toLowerCase();
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (typeof value === "object") return Object.values(value).map(textOf).join(" ");
  return "";
}

export function getActionPolicy(key) {
  return POLICY_BY_KEY.get(String(key || "")) || null;
}

export function listActionPolicies() {
  return ACTION_POLICIES.map((policy) => ({ ...policy }));
}

export function resolveActionKey({ actionType = "unknown", action = null, target = null, capability = null, input = null } = {}) {
  const type = String(actionType || "unknown").trim().toLowerCase();
  const actionName = String(action?.type || action?.action || "").trim().toLowerCase();
  const capabilityFallback = String(capability?.fallback || input?.fallback || "").trim().toLowerCase();
  const context = textOf({ actionType: type, action, target, capability, input });

  if (type === "focus-window") return "window.focus";
  if (type === "manage-window") return actionName === "close" ? "window.close" : "window.manage";
  if (context.includes("payment") || context.includes("支付") || context.includes("checkout") || context.includes("购买") || context.includes("转账")) return "external.payment";
  if (context.includes("password") || context.includes("credential") || context.includes("secret") || context.includes("token") || context.includes("密码") || context.includes("凭据") || context.includes("令牌")) return "credential.secret";
  if (context.includes("send") || context.includes("submit") || context.includes("publish") || context.includes("发送") || context.includes("提交") || context.includes("发布")) return "external.send";
  if (type === "click-element") return "element.click";
  if (type === "type-element") {
    if (context.includes("password") || context.includes("credential") || context.includes("secret") || context.includes("token") || context.includes("密码") || context.includes("凭据") || context.includes("令牌")) return "credential.secret";
    const effectiveFallback = capability?.fallback || (capability?.supportsValue === true ? "" : input?.fallback);
    if (effectiveFallback === "clipboard" || capability?.fallback === "clipboard") return "input.clipboard-fallback";
    if (effectiveFallback === "keyboard" || capability?.fallback === "keyboard") return "input.keyboard-fallback";
    return "element.type";
  }
  if (type === "mouse-click-at") return "mouse.coordinate-click";
  if (type === "mouse-drag") return "mouse.drag";
  if (type === "mouse-wheel") return "mouse.wheel";
  if (type === "protected-click" || type === "vision-click") return "mouse.protected-click";
  return null;
}

export function resolveActionPolicy(context = {}) {
  const key = resolveActionKey(context);
  const policy = getActionPolicy(key) || {
    key: key || "unknown",
    title: key || "未注册动作",
    group: "其他",
    tool: context.actionType || "unknown",
    defaultLevel: CONFIRMATION_LEVELS.CONFIRM,
    configurable: false,
    hardConfirmation: true,
    warning: "未注册动作默认需要确认。",
  };
  return { ...policy, key: policy.key };
}

export function normalizeConfirmationLevel(value, fallback = CONFIRMATION_LEVELS.CONFIRM) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === CONFIRMATION_LEVELS.AUTO || normalized === "never" || normalized === "automatic") return CONFIRMATION_LEVELS.AUTO;
  if (normalized === CONFIRMATION_LEVELS.CONFIRM || normalized === "always" || normalized === "manual") return CONFIRMATION_LEVELS.CONFIRM;
  return fallback;
}

export function normalizeActionConfirmation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const policy of ACTION_POLICIES) {
    if (!policy.configurable || !Object.prototype.hasOwnProperty.call(value, policy.key)) continue;
    result[policy.key] = normalizeConfirmationLevel(value[policy.key], policy.defaultLevel);
  }
  return result;
}

export function getActionConfirmationConfig(config = {}) {
  return normalizeActionConfirmation(config.actionConfirmation);
}

export function resolveActionConfirmation(key, config = {}) {
  const policy = getActionPolicy(key);
  const configured = config?.actionConfirmation;
  const explicit = Boolean(
    configured && typeof configured === "object" && !Array.isArray(configured)
      && Object.prototype.hasOwnProperty.call(configured, key),
  );
  const defaultLevel = policy?.defaultLevel || CONFIRMATION_LEVELS.CONFIRM;
  const hardConfirmation = policy?.hardConfirmation === true;
  const level = hardConfirmation
    ? CONFIRMATION_LEVELS.CONFIRM
    : explicit
      ? normalizeConfirmationLevel(configured[key], defaultLevel)
      : defaultLevel;
  return { level, explicit: explicit && !hardConfirmation, defaultLevel, warning: policy?.warning || null };
}

export function loadDesktopOrchestratorConfig(configSource = null) {
  let fileConfig = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      let raw = fs.readFileSync(CONFIG_PATH, "utf8");
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      const parsed = JSON.parse(raw);
      fileConfig = parsed && typeof parsed.global === "object" ? parsed.global : {};
    }
  } catch {
    fileConfig = {};
  }

  let hostConfig = {};
  try {
    if (configSource?.getAll) hostConfig = configSource.getAll() || {};
    else if (configSource?.get) hostConfig = configSource.get() || {};
    else if (configSource && typeof configSource === "object") hostConfig = configSource;
  } catch {
    hostConfig = {};
  }
  // The file is a compatibility fallback; Hana's configuration service is the
  // source of truth whenever it supplies a value.
  return { ...fileConfig, ...hostConfig };
}

export function saveActionConfirmationConfig(actionConfirmation) {
  const normalized = normalizeActionConfirmation(actionConfirmation);
  let document = { schemaVersion: 1, global: {} };
  if (fs.existsSync(CONFIG_PATH)) {
    let raw = fs.readFileSync(CONFIG_PATH, "utf8");
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("invalid-config-document");
    document = parsed;
  }
  document.schemaVersion = Number(document.schemaVersion) || 1;
  document.global = document.global && typeof document.global === "object" ? document.global : {};
  document.global.actionConfirmation = normalized;
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const tmpPath = `${CONFIG_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  const backupPath = `${CONFIG_PATH}.${process.pid}.${Date.now()}.bak`;
  let movedExisting = false;
  try {
    // Windows cannot rename over an existing file. Keep the write assembled in
    // a temporary file and retain a rollback copy while replacing the target.
    if (fs.existsSync(CONFIG_PATH)) {
      fs.copyFileSync(CONFIG_PATH, backupPath);
      movedExisting = true;
    }
    if (fs.existsSync(CONFIG_PATH)) fs.rmSync(CONFIG_PATH, { force: true });
    fs.renameSync(tmpPath, CONFIG_PATH);
    if (movedExisting && fs.existsSync(backupPath)) fs.rmSync(backupPath, { force: true });
  } catch (error) {
    try { if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true }); } catch {}
    try {
      if (movedExisting && !fs.existsSync(CONFIG_PATH) && fs.existsSync(backupPath)) fs.copyFileSync(backupPath, CONFIG_PATH);
      if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { force: true });
    } catch {}
    throw error;
  }
  return { ok: true, configPath: CONFIG_PATH, actionConfirmation: normalized };
}

export function actionPolicyWarning(key, level) {
  const policy = getActionPolicy(key);
  if (!policy || policy.defaultLevel === level) return null;
  return policy.warning || "该动作的确认级别已修改，请确认风险。";
}
