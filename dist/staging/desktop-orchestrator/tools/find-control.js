import { execute as readUiTree } from "./ui-tree.js";

export const name = "find-control";
export const description = "在目标窗口的 UIA 树中查找匹配的控件，返回候选元素和最佳匹配；只读，不执行点击、输入或 Invoke。";
export const parameters = {
  type: "object",
  properties: {
    handle: { type: "string", description: "目标窗口句柄，优先使用" },
    titleContains: { type: "string", description: "窗口标题包含文本，未提供 handle 时使用" },
    query: { type: "string", description: "要查找的控件关键词，会匹配 name、label、automationId、className、role" },
    role: { type: "string", description: "可选控件角色过滤，如 Button、Edit、ListItem、Text、Pane" },
    automationId: { type: "string", description: "可选 AutomationId 精确或包含匹配" },
    className: { type: "string", description: "可选 className 包含匹配" },
    pattern: { type: "string", description: "可选能力过滤，如 Invoke、Value、Scroll、Toggle" },
    maxElements: { type: "integer", default: 160, minimum: 1, maximum: 300, description: "最多读取多少 UIA 元素" },
    maxMatches: { type: "integer", default: 12, minimum: 1, maximum: 50, description: "最多返回多少个匹配候选" },
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

function includes(value, needle) {
  if (!needle) return true;
  return normalize(value).includes(needle);
}

function isStrongInputRole(element) {
  return ["edit", "combobox", "document", "spinner"].includes(normalize(element.role));
}

function isActionRole(element) {
  return ["button", "hyperlink", "listitem", "menuitem", "tabitem", "checkbox", "radiobutton"].includes(normalize(element.role));
}

function hasInputIntent(filters) {
  if (["edit", "combobox", "document", "spinner"].includes(filters.role)) return true;
  if (filters.pattern === "value") return true;
  return ["input", "edit", "search", "text", "输入", "搜索", "查找"].some((word) => filters.query.includes(word));
}

function scoreElement(element, filters) {
  let score = 0;
  const query = filters.query;
  const fields = [
    [element.name, 45],
    [element.label, 35],
    [element.automationId, 30],
    [element.className, 18],
    [element.role, 16],
  ];

  if (query) {
    let matched = false;
    for (const [value, weight] of fields) {
      const text = normalize(value);
      if (!text) continue;
      if (text === query) {
        score += weight + 30;
        matched = true;
      } else if (text.includes(query)) {
        score += weight;
        matched = true;
      }
    }
    if (!matched) return null;
  }

  if (filters.role) {
    if (normalize(element.role) !== filters.role) return null;
    score += 28;
  }

  if (filters.automationId) {
    if (!includes(element.automationId, filters.automationId)) return null;
    score += normalize(element.automationId) === filters.automationId ? 35 : 24;
  }

  if (filters.className) {
    if (!includes(element.className, filters.className)) return null;
    score += 16;
  }

  if (filters.pattern) {
    const patterns = Array.isArray(element.patterns) ? element.patterns.map(normalize) : [];
    if (!patterns.includes(filters.pattern)) return null;
    score += 22;
  }

  if (element.enabled) score += 6;
  if (!element.offscreen) score += 8;
  if (element.bounds?.width > 0 && element.bounds?.height > 0) score += 4;
  if (Array.isArray(element.patterns) && element.patterns.length > 0) score += element.patterns.length;

  if (hasInputIntent(filters)) {
    if (isStrongInputRole(element)) score += 80;
    if (isActionRole(element)) score -= 35;
  }

  return score;
}

export async function execute(input = {}) {
  const maxElements = Math.min(Math.max(Number(input.maxElements || 160), 1), 300);
  const maxMatches = Math.min(Math.max(Number(input.maxMatches || 12), 1), 50);
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
      type: "desktop-orchestrator-find-control",
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

  const filters = {
    query: normalize(input.query),
    role: normalize(input.role),
    automationId: normalize(input.automationId),
    className: normalize(input.className),
    pattern: normalize(input.pattern),
  };

  const matches = (tree.elements || [])
    .map((element) => ({ element, score: scoreElement(element, filters) }))
    .filter((item) => item.score !== null)
    .sort((left, right) => right.score - left.score || left.element.index - right.element.index)
    .slice(0, maxMatches)
    .map(({ element, score }) => ({
      score,
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
    }));

  return JSON.stringify({
    ok: true,
    type: "desktop-orchestrator-find-control",
    query: input.query || null,
    filters: {
      role: input.role || null,
      automationId: input.automationId || null,
      className: input.className || null,
      pattern: input.pattern || null,
    },
    window: tree.window,
    leaseId: tree.leaseId,
    snapshotId: tree.snapshotId,
    expiresAt: tree.expiresAt,
    enumerationStrategy: tree.enumerationStrategy,
    activatedBeforeRead: tree.activatedBeforeRead === true,
    totalElementsScanned: tree.count || 0,
    matchCount: matches.length,
    bestMatch: matches[0] || null,
    matches,
    safety: {
      readOnly: true,
      noDesktopActionExecuted: true,
      noMouseOrKeyboardInput: true,
      noUiaInvoke: true,
    },
  }, null, 2);
}
