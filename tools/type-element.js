import { buildApprovalBundle } from "../lib/approval-bundle.js";
import { saveApprovalBundle } from "../lib/approval-store.js";
import { compareElementSignature } from "../lib/element-signature.js";
import { parseJsonOutput, runUiaHelper } from "../lib/powershell.js";
import { buildActionPlan, requireRealInputApproval, resolvePluginConfig, REAL_INPUT_CONFIRMATION } from "../lib/safety.js";
import { findSnapshotElement, loadSnapshot, saveSnapshot } from "../lib/snapshot-store.js";
import { buildVerificationRequest } from "../lib/verification.js";
import { JSON_RESULT_PREAMBLE, WINDOW_API_SNIPPET } from "../lib/windows.js";

export const name = "type-element";
export const description = "按 ui-tree 的 elementId 生成文本输入计划。支持 leaseId + snapshotId 自动恢复窗口和签名；真实写入仅使用 UIA ValuePattern.SetValue。";
export const parameters = {
  type: "object",
  required: ["elementId", "text"],
  properties: {
    elementId: { type: "string", description: "来自 ui-tree 的快照内元素 id，例如 el-0" },
    text: { type: "string", description: "要写入目标元素的文本" },
    leaseId: { type: "string", description: "来自 ui-tree 的 leaseId；提供后会自动恢复窗口和元素签名" },
    snapshotId: { type: "string", description: "来自 ui-tree 的 snapshotId；与 leaseId 配合可从 snapshot store 恢复目标" },
    elementSignature: { type: "string", description: "来自 ui-tree 的元素签名；未提供时会尝试从 lease 快照恢复" },
    handle: { type: "string", description: "目标窗口句柄；lease 快照中的窗口句柄优先级更高" },
    titleContains: { type: "string", description: "窗口标题包含文本，未提供 handle/lease 时使用；都不提供则使用前台窗口" },
    expectedName: { type: "string", description: "可选。用于防止元素漂移的名称校验；未提供时会尝试从 lease 快照恢复" },
    dryRun: { type: "boolean", default: true, description: "是否只返回计划，不执行写入" },
    confirmation: { type: "string", description: `真实 UIA 文本写入确认短语：${REAL_INPUT_CONFIRMATION}` },
  },
};

function buildLeaseContext(input, elementId) {
  const leaseId = String(input.leaseId || "").trim();
  const snapshotId = String(input.snapshotId || "").trim();
  const storedSnapshot = leaseId && snapshotId ? loadSnapshot({ leaseId, snapshotId }) : null;

  if (leaseId && snapshotId && !storedSnapshot) {
    return {
      error: {
        dryRun: true,
        stale: true,
        approval: { allowed: false, dryRun: true, reason: "lease-snapshot-not-found" },
        leaseId,
        snapshotId,
        elementId,
        message: "未找到 lease 快照，可能已过期。请重新调用 ui-tree。",
      },
    };
  }

  const storedElement = storedSnapshot ? findSnapshotElement(storedSnapshot, elementId) : null;
  if (storedSnapshot && !storedElement) {
    return {
      error: {
        dryRun: true,
        stale: true,
        approval: { allowed: false, dryRun: true, reason: "element-not-found-in-lease-snapshot" },
        leaseId,
        snapshotId,
        elementId,
        message: "lease 快照中不存在该 elementId，请重新调用 ui-tree。",
      },
    };
  }

  return { leaseId, snapshotId, storedSnapshot, storedElement };
}

export async function execute(input = {}, toolCtx = {}) {
  const elementId = String(input.elementId || "").trim();
  if (!/^el-\d+$/.test(elementId)) throw new Error("elementId 必须形如 el-0");
  if (typeof input.text !== "string") throw new Error("text 必须是字符串");

  const leaseContext = buildLeaseContext(input, elementId);
  if (leaseContext.error) return JSON.stringify(leaseContext.error, null, 2);

  const { leaseId, snapshotId, storedSnapshot, storedElement } = leaseContext;
  const targetIndex = Number(elementId.slice(3));
  const effectiveHandle = storedSnapshot?.window?.handle || input.handle || "";
  const effectiveSignature = String(input.elementSignature || storedElement?.signature || "").trim();
  const effectiveExpectedName = input.expectedName ?? storedElement?.name ?? "";
  const approval = requireRealInputApproval(input, resolvePluginConfig(toolCtx));

  const helperTreeResult = parseJsonOutput(
    runUiaHelper("uia-tree", [effectiveHandle, String(Math.max(targetIndex + 1, 240))]),
    "type-element-tree"
  );
  const helperElement = Array.isArray(helperTreeResult?.elements)
    ? helperTreeResult.elements.find((element) => Number(element.index) === targetIndex) || null
    : null;
  let inspectResult = helperElement
    ? {
        ok: true,
        element: {
          elementId: `el-${helperElement.index}`,
          name: helperElement.name || "",
          automationId: helperElement.automationId || "",
          className: helperElement.className || "",
          role: helperElement.role || "",
          enabled: helperElement.isEnabled !== false,
          bounds: helperElement.bounds || null,
          supportsValue: helperElement.supportsValue === true,
          isReadOnly: helperElement.isReadOnly === true,
          currentValue: helperElement.currentValue ?? null,
        },
        capability: {
          supportsValue: helperElement.supportsValue === true,
          isReadOnly: helperElement.isReadOnly === true,
          currentValue: helperElement.currentValue ?? null,
        },
      }
    : { ok: false, error: "element-not-found", elementId };
  if (!inspectResult?.ok) {
    return JSON.stringify({ dryRun: true, approval, leaseId: leaseId || null, snapshotId: snapshotId || null, result: inspectResult }, null, 2);
  }

  const signatureCheck = compareElementSignature(inspectResult.element, effectiveSignature);
  let signatureVerified = signatureCheck.verified === true;
  
  // automationId can help locate the target, but it must not bypass the
  // snapshot-bound signature gate.
  
  if (!signatureCheck.ok) {
    return JSON.stringify({
      dryRun: true,
      stale: true,
      approval: { allowed: false, dryRun: true, reason: "stale-element-signature" },
      leaseId: leaseId || null,
      snapshotId: snapshotId || null,
      elementId,
      signatureCheck,
      result: inspectResult,
      message: "元素签名与 ui-tree 快照不一致，请重新获取 ui-tree 后再操作。",
    }, null, 2);
  }

  const capability = inspectResult.capability || {};
  const canSetValue = capability.supportsValue === true && capability.isReadOnly !== true;
  let setResult = null;
  // Hard gate: real UIA SetValue requires a VERIFIED signature. Writing text into an
  // unverified element is the highest-risk path, so an absent signature forces plan-only.
  if (approval.allowed && signatureVerified && canSetValue) {
    const targetKey = storedElement?.automationId || storedElement?.name || String(targetIndex);
    setResult = parseJsonOutput(runUiaHelper("uia-type", [effectiveHandle, targetKey, input.text]), "type-element");
    // Auto-extend lease TTL on successful write (10 more minutes)
    if (setResult?.ok && storedSnapshot) {
      try { saveSnapshot(storedSnapshot); } catch { /* best-effort TTL extension */ }
    }
  }

  const plan = buildActionPlan({
    type: "type-element",
    risk: "high",
    target: {
      leaseId: leaseId || null,
      snapshotId: snapshotId || null,
      handle: effectiveHandle || null,
      titleContains: input.titleContains || null,
      elementId,
      expectedName: effectiveExpectedName || null,
      elementSignature: effectiveSignature || signatureCheck.actualSignature,
    },
    action: {
      type: canSetValue ? "uia-setvalue" : "clipboard-assisted-typing-plan-only",
      textLength: input.text.length,
      valuePatternAvailable: capability.supportsValue === true,
      isReadOnly: capability.isReadOnly === true,
    },
    notes: [
      storedSnapshot ? "Target restored from lease snapshot." : "Target resolved from direct input or foreground window.",
      approval.allowed ? "Real UIA SetValue approved." : `Real action blocked: ${approval.reason}`,
      canSetValue ? "ValuePattern.SetValue is available." : "ValuePattern.SetValue is unavailable or read-only; keyboard/clipboard fallback is plan-only.",
      signatureVerified
        ? "Element signature guard passed (verified against snapshot) before any write."
        : "Element signature NOT verified (no expected signature supplied); real write blocked, plan-only.",
    ],
  });

  const verificationRequest = buildVerificationRequest({
    actionType: "type-element",
    leaseId: leaseId || null,
    snapshotId: snapshotId || null,
    elementId,
    expectedSignature: effectiveSignature || signatureCheck.actualSignature,
    expectedName: effectiveExpectedName || null,
    expectedHandle: effectiveHandle || null,
  });

  const approvalBundle = buildApprovalBundle({
    actionType: "type-element",
    risk: "high",
    approval,
    plan,
    target: plan.target,
    verificationRequest,
    capability,
    safetyNotes: ["Real text input remains blocked unless all real-input gates pass."],
  });

  saveApprovalBundle(approvalBundle, { source: "type-element" });

  // Phase 2: 分层精简输出
  const isDryRun = !approval.allowed;
  const base = {
    ok: !isDryRun || approval.dryRun === undefined,
    element: inspectResult?.element,
    signatureCheck,
    plan,
  };

  if (isDryRun) {
    return JSON.stringify({ ...base, dryRun: true, resultPhase: "pre-action-inspect", result: inspectResult }, null, 2);
  }

  return JSON.stringify({
    ...base,
    dryRun: false,
    leaseId: leaseId || null,
    snapshotId: snapshotId || null,
    capability,
    resultPhase: setResult ? "setvalue-complete" : "pre-action-inspect",
    result: inspectResult,
    setResult,
  }, null, 2);
}
