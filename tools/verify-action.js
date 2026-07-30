import { compareElementSignature } from "../lib/element-signature.js";
import { parseJsonOutput, runUiaHelper } from "../lib/powershell.js";
import { findSnapshotElement, loadSnapshot } from "../lib/snapshot-store.js";

export const name = "verify-action";
export const description = "复查 lease 绑定的 UIA 元素是否仍可解析且签名一致。只做观察，不执行任何桌面动作。";
export const parameters = {
  type: "object",
  required: ["leaseId", "snapshotId", "elementId"],
  properties: {
    leaseId: { type: "string", description: "来自 ui-tree 或动作工具 verificationRequest 的 leaseId" },
    snapshotId: { type: "string", description: "来自 ui-tree 或动作工具 verificationRequest 的 snapshotId" },
    elementId: { type: "string", description: "来自 ui-tree 的快照内元素 id，例如 el-0" },
    expectedSignature: { type: "string", description: "期望元素签名；未提供时从 lease snapshot 恢复" },
    expectedName: { type: "string", description: "可选名称校验；未提供时从 lease snapshot 恢复" },
    expectedHandle: { type: "string", description: "可选窗口句柄校验；未提供时从 lease snapshot 恢复" },
  },
};

export async function execute(input = {}) {
  const leaseId = String(input.leaseId || "").trim();
  const snapshotId = String(input.snapshotId || "").trim();
  const elementId = String(input.elementId || "").trim();
  if (!leaseId) throw new Error("leaseId 是必填项");
  if (!snapshotId) throw new Error("snapshotId 是必填项");
  if (!/^el-\d+$/.test(elementId)) throw new Error("elementId 必须形如 el-0");

  const storedSnapshot = loadSnapshot({ leaseId, snapshotId });
  if (!storedSnapshot) {
    return JSON.stringify({
      ok: false,
      passed: false,
      reason: "lease-snapshot-not-found",
      leaseId,
      snapshotId,
      elementId,
      message: "未找到 lease 快照，可能已过期。请重新调用 ui-tree。",
    }, null, 2);
  }

  const storedElement = findSnapshotElement(storedSnapshot, elementId);
  if (!storedElement) {
    return JSON.stringify({
      ok: false,
      passed: false,
      reason: "element-not-found-in-lease-snapshot",
      leaseId,
      snapshotId,
      elementId,
    }, null, 2);
  }

  const expectedHandle = String(input.expectedHandle || storedSnapshot.window?.handle || "").trim();
  if (!expectedHandle) {
    return JSON.stringify({ ok: false, passed: false, reason: "window-handle-missing", leaseId, snapshotId, elementId }, null, 2);
  }

  const expectedSignature = String(input.expectedSignature || storedElement.signature || "").trim();
  const targetIndex = Number(elementId.slice(3));
  const helperTreeResult = parseJsonOutput(runUiaHelper("uia-tree", [expectedHandle, String(Math.max(targetIndex + 1, 240))]), "verify-action-tree");
  const helperElement = Array.isArray(helperTreeResult?.elements)
    ? helperTreeResult.elements.find((element) => Number(element.index) === targetIndex) || null
    : null;
  const result = helperElement
    ? {
        ok: true,
        mode: "verify",
        element: {
          elementId: `el-${helperElement.index}`,
          name: helperElement.name || "",
          automationId: helperElement.automationId || "",
          className: helperElement.className || "",
          role: helperElement.role || "",
          enabled: helperElement.isEnabled !== false,
          bounds: helperElement.bounds || null,
        },
      }
    : { ok: false, error: "element-not-found", elementId };

  if (!result?.ok) {
    return JSON.stringify({
      ok: false,
      passed: false,
      reason: result?.error || "verify-failed",
      leaseId,
      snapshotId,
      elementId,
      result,
    }, null, 2);
  }

  const signatureCheck = compareElementSignature(result.element, expectedSignature);
  return JSON.stringify({
    ok: true,
    passed: signatureCheck.ok,
    reason: signatureCheck.ok ? "signature-match" : "signature-mismatch",
    leaseId,
    snapshotId,
    elementId,
    expectedHandle,
    signatureCheck,
    result,
  }, null, 2);
}
