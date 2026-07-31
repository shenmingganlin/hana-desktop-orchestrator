import { buildApprovalBundle } from "../lib/approval-bundle.js";
import { saveApprovalBundle } from "../lib/approval-store.js";
import { compareElementSignature } from "../lib/element-signature.js";
import { parseJsonOutput, runHelper, runUiaHelper } from "../lib/powershell.js";
import { buildActionPlan, requireRealInputApproval, resolvePluginConfig, REAL_INPUT_CONFIRMATION } from "../lib/safety.js";
import { findSnapshotElement, loadSnapshot, saveSnapshot } from "../lib/snapshot-store.js";
import { buildVerificationRequest } from "../lib/verification.js";
import { consumeControlSession } from "../lib/control-session.js";
import { buildTextInputFallbackPlan, normalizeTextInputFallback, runTextInputFallback, verifyFocusedElementIdentity } from "../lib/text-input.js";
import { JSON_RESULT_PREAMBLE, WINDOW_API_SNIPPET } from "../lib/windows.js";

export const name = "type-element";
export const description = "按 ui-tree 的 elementId 生成文本输入计划。优先使用 UIA ValuePattern；不可用时可在显式权限和前台窗口守卫下使用 Unicode 键盘或剪贴板回退。";
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
    sessionId: { type: "string", description: "可选。由 create-control-session 返回的控制会话 ID。" },
    dryRun: { type: "boolean", default: true, description: "是否只返回计划，不执行写入" },
    fallback: { type: "string", enum: ["keyboard", "clipboard"], default: "keyboard", description: "ValuePattern 不可用时的回退方式。keyboard 使用 Unicode SendInput；clipboard 使用受保护的剪贴板粘贴并尝试恢复原文本。" },
    confirmation: { type: "string", description: `真实文本输入确认短语：${REAL_INPUT_CONFIRMATION}` },
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
  const config = resolvePluginConfig(toolCtx);
  const requestedFallback = normalizeTextInputFallback(input.fallback, "keyboard");
  const windowInfo = input.sessionId && effectiveHandle
    ? (() => {
        const result = runHelper("window-info", [effectiveHandle]);
        if (!result.ok || !result.stdout) return null;
        try { return JSON.parse(result.stdout); } catch { return null; }
      })()
    : null;
  const effectiveProcessName = String(windowInfo?.processName || "").trim();
  const targetContext = {
    leaseId,
    snapshotId,
    handle: effectiveHandle || null,
    processName: effectiveProcessName || null,
    elementId,
    expectedName: effectiveExpectedName || null,
    elementSignature: effectiveSignature || null,
  };
  const approval = requireRealInputApproval(input, config, {
    actionType: "type-element",
    target: targetContext,
  });

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
  const effectiveFallback = requestedFallback;
  const effectiveCapability = canSetValue ? capability : { ...capability, fallback: effectiveFallback };
  const effectiveApproval = requireRealInputApproval(input, config, {
    actionType: "type-element",
    target: targetContext,
    capability: canSetValue ? capability : effectiveCapability,
  });
  const fallbackConfigKey = effectiveFallback === "clipboard" ? "allowClipboardInput" : "allowKeyboardInput";
  const fallbackConfigAllowed = canSetValue || config[fallbackConfigKey] === true;
  const gatedApproval = !canSetValue && !fallbackConfigAllowed
    ? { ...effectiveApproval, allowed: false, dryRun: true, requiresConfirmation: false, reason: `${fallbackConfigKey} 未开启，${effectiveFallback} fallback 被阻止` }
    : effectiveApproval;
  const fallbackPlan = canSetValue ? null : buildTextInputFallbackPlan({
    handle: effectiveHandle,
    elementId,
    text: input.text,
    fallback: effectiveFallback,
    target: { leaseId: leaseId || null, snapshotId: snapshotId || null, expectedName: effectiveExpectedName || null, elementSignature: effectiveSignature || null },
  });

  const plan = buildActionPlan({
    type: "type-element",
    risk: gatedApproval.risk || "high",
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
      type: canSetValue ? "uia-setvalue" : fallbackPlan.action.type,
      textLength: input.text.length,
      valuePatternAvailable: capability.supportsValue === true,
      isReadOnly: capability.isReadOnly === true,
      fallback: canSetValue ? null : effectiveFallback,
      foregroundGuard: canSetValue ? false : true,
      clipboardRestored: canSetValue ? null : effectiveFallback === "clipboard",
    },
    notes: [
      storedSnapshot ? "Target restored from lease snapshot." : "Target resolved from direct input or foreground window.",
      gatedApproval.allowed ? "Real text input approved." : `Real action blocked: ${gatedApproval.reason}`,
      canSetValue ? "ValuePattern.SetValue is available." : `ValuePattern.SetValue is unavailable or read-only; ${effectiveFallback} fallback is available only after its separate capability and foreground gates pass.`,
      ...(!canSetValue ? fallbackPlan.notes : []),
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
    risk: gatedApproval.risk || "high",
    approval: gatedApproval,
    plan,
    target: plan.target,
    verificationRequest,
    capability: effectiveCapability,
    safetyNotes: ["Real text input remains blocked unless all real-input, focus, signature, session, and fallback gates pass."],
  });

  const approvalBundleSave = saveApprovalBundle(approvalBundle, { source: "type-element" });
  const actionAllowed = gatedApproval.allowed && approvalBundleSave?.ok === true;
  let setResult = null;
  let fallbackResult = null;
  let focusResult = null;
  let focusVerification = null;
  let sessionConsumption = input.sessionId ? { ok: false, pending: true } : { ok: true, skipped: true };
  // Real input requires a verified signature and persisted approval evidence.
  if (actionAllowed && signatureVerified && canSetValue) {
    sessionConsumption = input.sessionId ? consumeControlSession(input.sessionId) : { ok: true, skipped: true };
    if (!sessionConsumption.ok) {
      return JSON.stringify({ dryRun: true, approval: effectiveApproval, plan, approvalBundleSave, sessionConsumption }, null, 2);
    }
    // The snapshot index is produced by the same UIA tree walk as the helper
    // and avoids crossing the Windows process boundary with localized names.
    const targetKey = `index:${targetIndex}`;
    setResult = parseJsonOutput(runUiaHelper("uia-type", [effectiveHandle, targetKey], { input: input.text }), "type-element");
    if (setResult?.ok && storedSnapshot) {
      try { saveSnapshot(storedSnapshot); } catch { /* best-effort TTL extension */ }
    }
  } else if (actionAllowed && signatureVerified && !canSetValue && fallbackPlan?.validation?.ok) {
    // Keep fallback focus bound to the same UIA tree index used for typing;
    // localized names are not stable across the helper process boundary.
    const targetKey = `index:${targetIndex}`;
    const identityKey = String(
      storedElement?.automationId
      || storedElement?.name
      || inspectResult.element?.automationId
      || inspectResult.element?.name
      || "",
    ).trim();
    focusResult = parseJsonOutput(runUiaHelper("uia-focus", [effectiveHandle, targetKey]), "type-element-focus");
    focusVerification = focusResult?.ok
      ? verifyFocusedElementIdentity({ focusedElement: focusResult.focusedElement, handle: effectiveHandle, targetKey: identityKey })
      : { ok: false, reason: "target-element-focus-failed", focusResult };

    if (!focusVerification.ok) {
      fallbackResult = {
        ok: false,
        action: `${effectiveFallback}-type`,
        reason: "focused-element-identity-verification-failed",
        focusResult,
        focusVerification,
      };
    } else {
      sessionConsumption = input.sessionId ? consumeControlSession(input.sessionId) : { ok: true, skipped: true };
      if (!sessionConsumption.ok) {
        return JSON.stringify({ dryRun: true, approval: effectiveApproval, plan, fallbackPlan, approvalBundleSave, focusResult, focusVerification, sessionConsumption }, null, 2);
      }
      fallbackResult = runTextInputFallback({ handle: effectiveHandle, text: input.text, fallback: effectiveFallback });
      fallbackResult = { ...fallbackResult, focusResult, focusVerification };
      if (fallbackResult?.ok !== true && input.sessionId) {
        // The quota represents an attempted real action, including a helper-level
        // foreground or clipboard failure. It is intentionally not refunded.
        sessionConsumption = { ...sessionConsumption, actionAttemptFailed: true };
      }
    }
  }

  // Phase 2: 分层精简输出
  const executionAttempted = actionAllowed && signatureVerified && (
    canSetValue || (fallbackPlan?.validation?.ok === true && focusVerification?.ok === true)
  );
  const executionSucceeded = setResult?.ok === true || fallbackResult?.ok === true;
  const isDryRun = !executionAttempted;
  const base = {
    ok: approvalBundleSave?.ok === true && (isDryRun ? true : executionSucceeded),
    element: inspectResult?.element,
    signatureCheck,
    plan,
    approvalBundleSave,
    focusResult,
    focusVerification,
  };

  if (isDryRun) {
    return JSON.stringify({ ...base, approval: gatedApproval, dryRun: true, resultPhase: "pre-action-inspect", result: inspectResult, fallbackPlan }, null, 2);
  }

  return JSON.stringify({
    ...base,
    approval: gatedApproval,
    dryRun: false,
    leaseId: leaseId || null,
    snapshotId: snapshotId || null,
    capability,
    resultPhase: setResult ? "setvalue-complete" : fallbackResult ? `${effectiveFallback}-fallback-complete` : "pre-action-inspect",
    result: inspectResult,
    setResult,
    fallbackPlan,
    fallbackResult,
    sessionConsumption,
  }, null, 2);
}
