import { execute as readUiTree } from "./ui-tree.js";

export const name = "inspect-window";
export const description = "只读检查目标窗口的 UIA 结构，汇总可操作控件、输入区域、导航项、提示文本和安全观察建议。";
export const parameters = {
  type: "object",
  properties: {
    handle: { type: "string", description: "目标窗口句柄，优先使用" },
    titleContains: { type: "string", description: "窗口标题包含文本，未提供 handle 时使用" },
    maxElements: { type: "integer", default: 220, minimum: 1, maximum: 400, description: "最多读取多少 UIA 元素" },
    maxItemsPerGroup: { type: "integer", default: 12, minimum: 1, maximum: 40, description: "每组最多返回多少个代表元素" },
    includeOffscreen: { type: "boolean", default: false, description: "是否包含屏幕外元素" },
    activateBeforeRead: { type: "boolean", default: false, description: "读取前先短暂激活目标窗口；用于 UWP/WinUI 窗口，会改变前台窗口状态" },
  },
};

function parseResult(value) {
  if (typeof value === "string") return JSON.parse(value);
  if (value?.content?.[0]?.text) return JSON.parse(value.content[0].text);
  return value;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePattern(value) {
  return normalize(value).replace(/identifiers\.?$/, "");
}

function hasPattern(element, pattern) {
  const wanted = normalizePattern(pattern);
  return Array.isArray(element.patterns) && element.patterns.some((item) => normalizePattern(item) === wanted);
}

function textOf(element) {
  return [element.name, element.label, element.automationId, element.className, element.role]
    .filter(Boolean)
    .join(" ");
}

function compactElement(element) {
  return {
    elementId: element.elementId,
    index: element.index,
    name: element.name,
    label: element.label,
    role: element.role,
    automationId: element.automationId,
    className: element.className,
    enabled: element.enabled,
    offscreen: element.offscreen,
    bounds: element.bounds,
    patterns: element.patterns,
    signature: element.signature,
  };
}

function isActionable(element) {
  const role = normalize(element.role);
  return hasPattern(element, "Invoke")
    || hasPattern(element, "Toggle")
    || hasPattern(element, "ExpandCollapse")
    || hasPattern(element, "SelectionItem")
    || ["button", "menuitem", "hyperlink", "checkbox", "radiobutton", "splitbutton", "tabitem", "listitem"].includes(role);
}

function isStrongInputRole(element) {
  return ["edit", "combobox", "document", "spinner"].includes(normalize(element.role));
}

function inputRank(element) {
  let score = rank(element);
  const role = normalize(element.role);
  if (isStrongInputRole(element)) score += 80;
  if (hasPattern(element, "Value")) score += 20;
  if (["button", "hyperlink", "listitem", "menuitem", "tabitem"].includes(role)) score -= 45;
  return score;
}

function isInput(element) {
  return isStrongInputRole(element) || hasPattern(element, "Value");
}

function isNavigation(element) {
  const role = normalize(element.role);
  const text = normalize(textOf(element));
  return ["tabitem", "treeitem", "listitem", "menuitem", "navigationitem"].includes(role)
    || text.includes("navigation")
    || text.includes("nav")
    || text.includes("菜单")
    || text.includes("导航");
}

function isStatusText(element) {
  const role = normalize(element.role);
  const text = normalize(textOf(element));
  if (!["text", "statusbar", "pane", "document"].includes(role) && text.length < 4) return false;
  return [
    "error", "warning", "failed", "failure", "denied", "blocked", "required", "invalid", "success", "complete",
    "错误", "警告", "失败", "无法", "拒绝", "阻止", "需要", "无效", "成功", "完成", "异常",
  ].some((word) => text.includes(word));
}

function rank(element) {
  let score = 0;
  if (element.enabled) score += 8;
  if (!element.offscreen) score += 10;
  if (element.name) score += 8;
  if (element.automationId) score += 6;
  if (element.bounds?.width > 0 && element.bounds?.height > 0) score += 4;
  if (Array.isArray(element.patterns)) score += element.patterns.length * 2;
  return score;
}

function top(elements, maxItemsPerGroup, ranker = rank) {
  return elements
    .slice()
    .sort((left, right) => ranker(right) - ranker(left) || left.index - right.index)
    .slice(0, maxItemsPerGroup)
    .map(compactElement);
}

function countBy(elements, field) {
  const counts = new Map();
  for (const element of elements) {
    const key = element[field] || "(empty)";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 20)
    .map(([name, count]) => ({ name, count }));
}

function buildSuggestions(tree, groups) {
  const suggestions = [];
  if (groups.inputs.length > 0) suggestions.push("存在可读输入区域；下一步可用 find-control 精确锁定输入框，再生成 dry-run type-element 计划。");
  if (groups.actions.length > 0) suggestions.push("存在可操作控件；下一步可用 find-control 按名称或 Invoke 模式锁定按钮，再生成 dry-run click-element 计划。");
  if (groups.statusTexts.length > 0) suggestions.push("检测到疑似状态或错误提示文本；优先读取这些文本，再决定是否需要操作。 ");
  if ((tree.count || 0) <= 3 && tree.activatedBeforeRead !== true) suggestions.push("UIA 子树较少；若这是 UWP/WinUI 窗口，可在明确接受前台切换时使用 activateBeforeRead: true 重新观察。 ");
  if (suggestions.length === 0) suggestions.push("未发现明确的输入框、按钮或状态提示；可扩大 maxElements 或开启 includeOffscreen 做更宽观察。 ");
  return suggestions;
}

export async function execute(input = {}) {
  const maxElements = Math.min(Math.max(Number(input.maxElements || 220), 1), 400);
  const maxItemsPerGroup = Math.min(Math.max(Number(input.maxItemsPerGroup || 12), 1), 40);
  const tree = parseResult(await readUiTree({
    handle: input.handle,
    titleContains: input.titleContains,
    maxElements,
    includeOffscreen: input.includeOffscreen === true,
    activateBeforeRead: input.activateBeforeRead === true,
  }));

  if (!tree?.ok) {
    return JSON.stringify({
      ok: false,
      type: "desktop-orchestrator-inspect-window",
      error: tree?.error || "ui-tree-failed",
      source: tree,
      safety: {
        readOnly: true,
        noDesktopActionExecuted: true,
        noMouseOrKeyboardInput: true,
        noUiaInvoke: true,
      },
    }, null, 2);
  }

  const elements = Array.isArray(tree.elements) ? tree.elements : [];
  const groups = {
    actions: elements.filter(isActionable),
    inputs: elements.filter(isInput),
    navigation: elements.filter(isNavigation),
    statusTexts: elements.filter(isStatusText),
  };

  return JSON.stringify({
    ok: true,
    type: "desktop-orchestrator-inspect-window",
    window: tree.window,
    leaseId: tree.leaseId,
    snapshotId: tree.snapshotId,
    expiresAt: tree.expiresAt,
    enumerationStrategy: tree.enumerationStrategy,
    activatedBeforeRead: tree.activatedBeforeRead === true,
    summary: {
      totalElements: tree.count || elements.length,
      visibleElements: elements.filter((element) => !element.offscreen).length,
      enabledElements: elements.filter((element) => element.enabled).length,
      actionableControls: groups.actions.length,
      inputControls: groups.inputs.length,
      navigationControls: groups.navigation.length,
      statusTextCandidates: groups.statusTexts.length,
      roleCounts: countBy(elements, "role"),
      patternCounts: countBy(elements.flatMap((element) => (element.patterns || []).map((pattern) => ({ role: pattern }))), "role"),
    },
    groups: {
      actions: top(groups.actions, maxItemsPerGroup),
      inputs: top(groups.inputs, maxItemsPerGroup, inputRank),
      navigation: top(groups.navigation, maxItemsPerGroup),
      statusTexts: top(groups.statusTexts, maxItemsPerGroup),
    },
    suggestions: buildSuggestions(tree, groups),
    safety: {
      readOnly: true,
      noDesktopActionExecuted: true,
      noMouseOrKeyboardInput: true,
      noUiaInvoke: true,
    },
  }, null, 2);
}
