import { compareElementSignature } from "../lib/element-signature.js";
import { parseJsonOutput, runPowerShell } from "../lib/powershell.js";
import { findSnapshotElement, loadSnapshot } from "../lib/snapshot-store.js";
import { escapePowerShellSingleQuoted, JSON_RESULT_PREAMBLE, WINDOW_API_SNIPPET } from "../lib/windows.js";

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

function buildVerifyScript({ targetIndex, handle, expectedName }) {
  return `
$ErrorActionPreference = "Stop"
${JSON_RESULT_PREAMBLE}
${WINDOW_API_SNIPPET}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$window = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([int64]'${handle}'))
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
$element = @{
  elementId = 'el-${targetIndex}'
  name = $current.Name
  automationId = $current.AutomationId
  className = $current.ClassName
  role = ($current.ControlType.ProgrammaticName -replace '^ControlType\\.', '')
  enabled = $current.IsEnabled
  bounds = @{ left = [int]$rect.Left; top = [int]$rect.Top; right = [int]$rect.Right; bottom = [int]$rect.Bottom; width = [int]$rect.Width; height = [int]$rect.Height; centerX = [int]($rect.Left + $rect.Width / 2); centerY = [int]($rect.Top + $rect.Height / 2) }
}
Write-JsonResult @{ ok = $true; mode = 'verify'; element = $element }
`;
}

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
  const expectedName = input.expectedName ?? storedElement.name ?? "";
  const targetIndex = Number(elementId.slice(3));
  const result = parseJsonOutput(runPowerShell(buildVerifyScript({
    targetIndex,
    handle: escapePowerShellSingleQuoted(expectedHandle),
    expectedName: escapePowerShellSingleQuoted(expectedName),
  })), "verify-action");

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
