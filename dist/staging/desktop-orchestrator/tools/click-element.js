import { buildApprovalBundle } from "../lib/approval-bundle.js";
import { saveApprovalBundle } from "../lib/approval-store.js";
import { buildCursorOverlay } from "../lib/cursor-overlay.js";
import { getCursorOverlayClient } from "../lib/cursor-overlay-client.js";
import { compareElementSignature } from "../lib/element-signature.js";
import { parseJsonOutput, runPowerShell } from "../lib/powershell.js";
import { buildActionPlan, requireRealInputApproval, resolvePluginConfig, REAL_INPUT_CONFIRMATION } from "../lib/safety.js";
import { findSnapshotElement, loadSnapshot } from "../lib/snapshot-store.js";
import { buildVerificationRequest } from "../lib/verification.js";
import { escapePowerShellSingleQuoted, JSON_RESULT_PREAMBLE, WINDOW_API_SNIPPET } from "../lib/windows.js";

export const name = "click-element";
export const description = "按 ui-tree 的 elementId 生成元素点击计划。支持 leaseId + snapshotId 自动恢复窗口和签名；签名校验通过后才允许 UIA Invoke。";
export const parameters = {
  type: "object",
  required: ["elementId"],
  properties: {
    elementId: { type: "string", description: "来自 ui-tree 的快照内元素 id，例如 el-0" },
    leaseId: { type: "string", description: "来自 ui-tree 的 leaseId；提供后会自动恢复窗口和元素签名" },
    snapshotId: { type: "string", description: "来自 ui-tree 的 snapshotId；与 leaseId 配合可从 snapshot store 恢复目标" },
    elementSignature: { type: "string", description: "来自 ui-tree 的元素签名；未提供时会尝试从 lease 快照恢复" },
    handle: { type: "string", description: "目标窗口句柄；lease 快照中的窗口句柄优先级更高" },
    titleContains: { type: "string", description: "窗口标题包含文本，未提供 handle/lease 时使用；都不提供则使用前台窗口" },
    expectedName: { type: "string", description: "可选。用于防止元素漂移的名称校验；未提供时会尝试从 lease 快照恢复" },
    dryRun: { type: "boolean", default: true, description: "是否只返回计划和 cursorOverlay，不执行点击" },
    confirmation: { type: "string", description: `真实 UIA 点击确认短语：${REAL_INPUT_CONFIRMATION}` },
    showCursor: { type: "boolean", default: true, description: "真实点击前是否显示发光光标飞向目标的动画浮层（不移动真实系统鼠标）。默认 true。" },
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

function buildResolveElementScript({ targetIndex, handle, titleContains, expectedName }) {
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
$invokePattern = $null
$supportsInvoke = $match.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern) -and $invokePattern
$element = @{
  elementId = 'el-${targetIndex}'
  name = $current.Name
  automationId = $current.AutomationId
  className = $current.ClassName
  role = ($current.ControlType.ProgrammaticName -replace '^ControlType\\.', '')
  enabled = $current.IsEnabled
  bounds = @{ left = [int]$rect.Left; top = [int]$rect.Top; right = [int]$rect.Right; bottom = [int]$rect.Bottom; width = [int]$rect.Width; height = [int]$rect.Height; centerX = [int]($rect.Left + $rect.Width / 2); centerY = [int]($rect.Top + $rect.Height / 2) }
}
Write-JsonResult @{ ok = $true; mode = 'inspect'; element = $element; capability = @{ supportsInvoke = [bool]$supportsInvoke } }
`;
}

function buildInvokeScript({ targetIndex, handle, titleContains, expectedName }) {
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
$pattern = $null
if (-not ($match.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern) -and $pattern)) {
  Write-JsonResult @{ ok = $false; error = 'invoke-pattern-unavailable'; elementId = 'el-${targetIndex}' }
  exit 0
}
try {
  $pattern.Invoke()
  Write-JsonResult @{ ok = $true; mode = 'uia-invoke'; elementId = 'el-${targetIndex}' }
} catch {
  Write-JsonResult @{ ok = $false; error = 'invoke-failed'; message = $_.Exception.Message; elementId = 'el-${targetIndex}' }
}
`;
}

export async function execute(input = {}, toolCtx = {}) {
  const elementId = String(input.elementId || "").trim();
  if (!/^el-\d+$/.test(elementId)) throw new Error("elementId 必须形如 el-0");

  const leaseContext = buildLeaseContext(input, elementId);
  if (leaseContext.error) return JSON.stringify(leaseContext.error, null, 2);

  const { leaseId, snapshotId, storedSnapshot, storedElement } = leaseContext;
  const targetIndex = Number(elementId.slice(3));
  const effectiveHandle = storedSnapshot?.window?.handle || input.handle || "";
  const effectiveSignature = String(input.elementSignature || storedElement?.signature || "").trim();
  const effectiveExpectedName = input.expectedName ?? storedElement?.name ?? "";
  const approval = requireRealInputApproval(input, resolvePluginConfig(toolCtx));
  const scriptInput = {
    targetIndex,
    handle: escapePowerShellSingleQuoted(effectiveHandle),
    titleContains: escapePowerShellSingleQuoted(input.titleContains || ""),
    expectedName: escapePowerShellSingleQuoted(effectiveExpectedName || ""),
  };

  const inspectResult = parseJsonOutput(runPowerShell(buildResolveElementScript(scriptInput)), "click-element");
  if (!inspectResult?.ok) return JSON.stringify({ dryRun: true, approval, leaseId: leaseId || null, snapshotId: snapshotId || null, result: inspectResult }, null, 2);

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
  const center = inspectResult.element?.bounds
    ? { x: inspectResult.element.bounds.centerX, y: inspectResult.element.bounds.centerY }
    : null;
  let invokeResult = null;
  let cursorFlight = null;
  // Hard gate: real UIA invoke requires a VERIFIED signature, not merely an absent one.
  // Without a verified signature the action stays plan-only no matter the approval state.
  if (approval.allowed && signatureVerified && capability.supportsInvoke === true) {
    // Fly the glowing overlay cursor to the target BEFORE invoking. This is a pure
    // visual overlay (separate transparent window); it never moves the real system
    // cursor. Failures here are non-fatal — the click still proceeds.
    if (center && input.showCursor !== false) {
      try {
        const overlayClient = getCursorOverlayClient({ pluginDir: toolCtx.pluginDir, dataDir: toolCtx.dataDir, log: toolCtx.log });
        const flyOk = await overlayClient.clickAt({
          toX: center.x,
          toY: center.y,
          durationMs: 520,
          clicks: 1,
          label: inspectResult.element?.name || elementId,
        });
        cursorFlight = { requested: true, delivered: flyOk === true };
        // Let the flight visibly land before the real click.
        if (flyOk) await new Promise((r) => setTimeout(r, 560));
      } catch (err) {
        cursorFlight = { requested: true, delivered: false, error: err?.message || String(err) };
      }
    }
    invokeResult = parseJsonOutput(runPowerShell(buildInvokeScript(scriptInput)), "click-element-invoke");
  }

  const overlay = center ? buildCursorOverlay({ to: center, label: inspectResult.element?.name || elementId }) : null;
  const plan = buildActionPlan({
    type: "click-element",
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
    action: { type: "uia-click", elementId, center, invokePatternAvailable: capability.supportsInvoke === true },
    notes: [
      storedSnapshot ? "Target restored from lease snapshot." : "Target resolved from direct input or foreground window.",
      approval.allowed ? "Real UIA invoke approved." : `Real action blocked: ${approval.reason}`,
      capability.supportsInvoke === true ? "InvokePattern is available." : "InvokePattern is unavailable; action remains plan-only.",
      signatureVerified
        ? "Element signature guard passed (verified against snapshot) before any invoke."
        : "Element signature NOT verified (no expected signature supplied); real invoke blocked, plan-only.",
      "cursorOverlay can be rendered by a future widget as a smooth preview cursor.",
    ],
  });

  const verificationRequest = buildVerificationRequest({
    actionType: "click-element",
    leaseId: leaseId || null,
    snapshotId: snapshotId || null,
    elementId,
    expectedSignature: effectiveSignature || signatureCheck.actualSignature,
    expectedName: effectiveExpectedName || null,
    expectedHandle: effectiveHandle || null,
  });

  const approvalBundle = buildApprovalBundle({
    actionType: "click-element",
    risk: "high",
    approval,
    plan,
    target: plan.target,
    cursorOverlay: overlay,
    verificationRequest,
    capability,
    safetyNotes: ["Real click remains blocked unless all real-input gates pass."],
  });

  const approvalRecord = saveApprovalBundle(approvalBundle, { source: "click-element" });

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
    cursorOverlay: overlay,
    cursorFlight,
    resultPhase: "pre-action-inspect",
    result: inspectResult,
    invokeResult,
  }, null, 2);
}
