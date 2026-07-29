import { buildApprovalBundle } from "../lib/approval-bundle.js";
import { saveApprovalBundle } from "../lib/approval-store.js";
import { compareElementSignature } from "../lib/element-signature.js";
import { parseJsonOutput, runPowerShell } from "../lib/powershell.js";
import { buildActionPlan, requireRealInputApproval, resolvePluginConfig, REAL_INPUT_CONFIRMATION } from "../lib/safety.js";
import { findSnapshotElement, loadSnapshot } from "../lib/snapshot-store.js";
import { buildVerificationRequest } from "../lib/verification.js";
import { escapePowerShellSingleQuoted, JSON_RESULT_PREAMBLE, WINDOW_API_SNIPPET } from "../lib/windows.js";

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

function buildInspectScript({ targetIndex, handle, titleContains, expectedName }) {
  return `
$ErrorActionPreference = "Stop"
${JSON_RESULT_PREAMBLE}
${WINDOW_API_SNIPPET}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Resolve-TargetWindow {
  if ('${handle}') { return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([int64]'${handle}')) }
  if ('${titleContains}') {
    $needle = '${titleContains}'.ToLowerInvariant()
    $targetHandle = [IntPtr]::Zero
    $callback = [HanaWindowApi+EnumWindowsProc]{ param($hwnd, $lparam)
      if (-not [HanaWindowApi]::IsWindowVisible($hwnd)) { return $true }
      $len = [HanaWindowApi]::GetWindowTextLength($hwnd)
      if ($len -le 0) { return $true }
      $sb = New-Object System.Text.StringBuilder ($len + 1)
      [HanaWindowApi]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
      if ($sb.ToString().ToLowerInvariant().Contains($needle)) { $script:targetHandle = $hwnd; return $false }
      return $true
    }
    [HanaWindowApi]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
    if ($targetHandle -ne [IntPtr]::Zero) { return [System.Windows.Automation.AutomationElement]::FromHandle($targetHandle) }
  }
  return [System.Windows.Automation.AutomationElement]::FromHandle([HanaWindowApi]::GetForegroundWindow())
}

$window = Resolve-TargetWindow
if ($null -eq $window) { Write-JsonResult @{ ok = $false; error = 'window-not-found' }; exit 0 }
$found = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$match = $null
$visibleIndex = 0
foreach ($el in $found) {
  $current = $null
  try { $current = $el.Current } catch { continue }
  if ($current.IsOffscreen) { continue }
  $rect = $current.BoundingRectangle
  if ($rect.Width -le 0 -or $rect.Height -le 0) { continue }
  if ($visibleIndex -eq ${targetIndex}) { $match = $el; break }
  $visibleIndex++
}
if ($null -eq $match) { Write-JsonResult @{ ok = $false; error = 'element-not-found'; elementId = 'el-${targetIndex}' }; exit 0 }
$current = $match.Current
if ('${expectedName}' -and $current.Name -ne '${expectedName}') { Write-JsonResult @{ ok = $false; error = 'element-name-mismatch'; expected = '${expectedName}'; actual = $current.Name; elementId = 'el-${targetIndex}' }; exit 0 }
$rect = $current.BoundingRectangle
$valuePattern = $null
$supportsValue = $match.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) -and $valuePattern
$currentValue = $null
$isReadOnly = $null
if ($supportsValue) {
  try { $currentValue = $valuePattern.Current.Value } catch { $currentValue = $null }
  try { $isReadOnly = $valuePattern.Current.IsReadOnly } catch { $isReadOnly = $null }
}
$element = @{
  elementId = 'el-${targetIndex}'
  name = $current.Name
  automationId = $current.AutomationId
  className = $current.ClassName
  role = ($current.ControlType.ProgrammaticName -replace '^ControlType\\.', '')
  enabled = $current.IsEnabled
  bounds = @{ left = [int]$rect.Left; top = [int]$rect.Top; right = [int]$rect.Right; bottom = [int]$rect.Bottom; width = [int]$rect.Width; height = [int]$rect.Height; centerX = [int]($rect.Left + $rect.Width / 2); centerY = [int]($rect.Top + $rect.Height / 2) }
}
Write-JsonResult @{ ok = $true; mode = 'inspect'; element = $element; capability = @{ supportsValue = [bool]$supportsValue; isReadOnly = $isReadOnly; currentValue = $currentValue } }
`;
}

function buildSetValueScript({ targetIndex, handle, titleContains, expectedName, text }) {
  return `
$ErrorActionPreference = "Stop"
${JSON_RESULT_PREAMBLE}
${WINDOW_API_SNIPPET}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Resolve-TargetWindow {
  if ('${handle}') { return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([int64]'${handle}')) }
  if ('${titleContains}') {
    $needle = '${titleContains}'.ToLowerInvariant()
    $targetHandle = [IntPtr]::Zero
    $callback = [HanaWindowApi+EnumWindowsProc]{ param($hwnd, $lparam)
      if (-not [HanaWindowApi]::IsWindowVisible($hwnd)) { return $true }
      $len = [HanaWindowApi]::GetWindowTextLength($hwnd)
      if ($len -le 0) { return $true }
      $sb = New-Object System.Text.StringBuilder ($len + 1)
      [HanaWindowApi]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
      if ($sb.ToString().ToLowerInvariant().Contains($needle)) { $script:targetHandle = $hwnd; return $false }
      return $true
    }
    [HanaWindowApi]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
    if ($targetHandle -ne [IntPtr]::Zero) { return [System.Windows.Automation.AutomationElement]::FromHandle($targetHandle) }
  }
  return [System.Windows.Automation.AutomationElement]::FromHandle([HanaWindowApi]::GetForegroundWindow())
}

$window = Resolve-TargetWindow
if ($null -eq $window) { Write-JsonResult @{ ok = $false; error = 'window-not-found' }; exit 0 }
$found = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$match = $null
$visibleIndex = 0
foreach ($el in $found) {
  $current = $null
  try { $current = $el.Current } catch { continue }
  if ($current.IsOffscreen) { continue }
  $rect = $current.BoundingRectangle
  if ($rect.Width -le 0 -or $rect.Height -le 0) { continue }
  if ($visibleIndex -eq ${targetIndex}) { $match = $el; break }
  $visibleIndex++
}
if ($null -eq $match) { Write-JsonResult @{ ok = $false; error = 'element-not-found'; elementId = 'el-${targetIndex}' }; exit 0 }
$current = $match.Current
if ('${expectedName}' -and $current.Name -ne '${expectedName}') { Write-JsonResult @{ ok = $false; error = 'element-name-mismatch'; expected = '${expectedName}'; actual = $current.Name; elementId = 'el-${targetIndex}' }; exit 0 }
$valuePattern = $null
if (-not ($match.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) -and $valuePattern)) {
  Write-JsonResult @{ ok = $false; error = 'value-pattern-unavailable'; elementId = 'el-${targetIndex}' }
  exit 0
}
if ($valuePattern.Current.IsReadOnly) {
  Write-JsonResult @{ ok = $false; error = 'value-pattern-readonly'; elementId = 'el-${targetIndex}' }
  exit 0
}
$valuePattern.SetValue('${text}')
Write-JsonResult @{ ok = $true; mode = 'uia-setvalue'; elementId = 'el-${targetIndex}' }
`;
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

  const commonScriptInput = {
    targetIndex,
    handle: escapePowerShellSingleQuoted(effectiveHandle),
    titleContains: escapePowerShellSingleQuoted(input.titleContains || ""),
    expectedName: escapePowerShellSingleQuoted(effectiveExpectedName || ""),
  };

  const inspectResult = parseJsonOutput(runPowerShell(buildInspectScript(commonScriptInput)), "type-element");
  if (!inspectResult?.ok) {
    return JSON.stringify({ dryRun: true, approval, leaseId: leaseId || null, snapshotId: snapshotId || null, result: inspectResult }, null, 2);
  }

  const signatureCheck = compareElementSignature(inspectResult.element, effectiveSignature);
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
  const signatureVerified = signatureCheck.verified === true;
  const canSetValue = capability.supportsValue === true && capability.isReadOnly !== true;
  let setResult = null;
  // Hard gate: real UIA SetValue requires a VERIFIED signature. Writing text into an
  // unverified element is the highest-risk path, so an absent signature forces plan-only.
  if (approval.allowed && signatureVerified && canSetValue) {
    setResult = parseJsonOutput(runPowerShell(buildSetValueScript({
      ...commonScriptInput,
      text: escapePowerShellSingleQuoted(input.text),
    })), "type-element-setvalue");
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

  const approvalRecord = saveApprovalBundle(approvalBundle, { source: "type-element" });

  return JSON.stringify({
    dryRun: !approval.allowed,
    approval,
    leaseId: leaseId || null,
    snapshotId: snapshotId || null,
    signatureCheck,
    capability,
    plan,
    verificationRequest,
    approvalBundle,
    approvalRecord,
    resultPhase: "pre-action-inspect",
    result: inspectResult,
    setResult,
  }, null, 2);
}
