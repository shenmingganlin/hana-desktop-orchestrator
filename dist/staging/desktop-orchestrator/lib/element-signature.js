import crypto from "crypto";

export function normalizeElementForSignature(element = {}) {
  const bounds = element.bounds || {};
  return {
    role: String(element.role || ""),
    name: String(element.name || ""),
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

export function compareElementSignature(element = {}, expectedSignature = "") {
  const actualSignature = buildElementSignature(element);
  const expected = String(expectedSignature || "").trim();
  // Fail-closed: a missing expected signature is NOT a pass. It is "unverified".
  // Only an expected signature that actually matches counts as verified.
  const matched = Boolean(expected) && actualSignature === expected;
  const reason = !expected
    ? "missing-expected-signature"
    : matched
      ? "signature-match"
      : "signature-mismatch";
  return {
    // ok stays true only when there is nothing to contradict (no expected sig OR a real match),
    // so existing dry-run inspection paths keep working; real execution must check `verified`.
    ok: !expected || matched,
    verified: matched,
    reason,
    expectedSignature: expected || null,
    actualSignature,
    normalized: normalizeElementForSignature(element),
  };
}
