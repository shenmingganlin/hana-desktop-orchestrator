import crypto from "crypto";

export function normalizeElementForSignature(element = {}) {
  const bounds = element.bounds || {};
  // 排除 role 和 name：中文 Windows 上 C# helper 用 LocalizedControlType
  // 返回中文 role（如"按钮"），而 click-element 的 PS 脚本用
  // ControlType.ProgrammaticName 返回英文 role（如"Button"），两者永远不相等。
  // name 也可能因编码问题（GBK vs UTF-8）产生乱码差异。
  // 仅依赖 automationId、className、enabled 和 bounds 这些不易因语言/编码漂移的字段。
  return {
    automationId: String(element.automationId || ""),
    className: String(element.className || ""),
    enabled: element.enabled !== false,
    bounds: {
      left: Math.round(Number(bounds.left || 0)),
      top: Math.round(Number(bounds.top || 0)),
      width: Math.round(Number(bounds.width || 0)),
      height: Math.round(Number(bounds.height || 0)),
    },
  };
}

export function buildElementSignature(element = {}) {
  const normalized = normalizeElementForSignature(element);
  const payload = JSON.stringify(normalized);
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Build a matchKey from element properties, following the same format as ui-tree's PS output.
 * Format: "aid:{automationId}|name:{name}|role:{role}|cls:{className}"
 */
export function buildMatchKey(element = {}) {
  const parts = [];
  if (element.automationId) parts.push(`aid:${element.automationId}`);
  if (element.name) parts.push(`name:${element.name}`);
  parts.push(`role:${element.role || ''}`);
  if (element.className) parts.push(`cls:${element.className}`);
  return parts.join('|');
}

export function compareElementSignature(element = {}, expectedSignature = "") {
  const actualSignature = buildElementSignature(element);
  const expected = String(expectedSignature || "").trim();
  const matched = Boolean(expected) && actualSignature === expected;
  const reason = !expected
    ? "missing-expected-signature"
    : matched
      ? "signature-match"
      : "signature-mismatch";
  return {
    ok: !expected || matched,
    verified: matched,
    reason,
    expectedSignature: expected || null,
    actualSignature,
    normalized: normalizeElementForSignature(element),
  };
}
