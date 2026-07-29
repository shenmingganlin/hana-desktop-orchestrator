import { buildElementSignature } from "../lib/element-signature.js";
import { parseJsonOutput, runPowerShell } from "../lib/powershell.js";
import { saveSnapshot } from "../lib/snapshot-store.js";
import { escapePowerShellSingleQuoted, JSON_RESULT_PREAMBLE, WINDOW_API_SNIPPET } from "../lib/windows.js";

export const name = "ui-tree";
export const description = "读取目标窗口的 Windows UI Automation 元素摘要，返回快照内 elementId、角色、文本、边界和可用模式。";
export const parameters = {
  type: "object",
  properties: {
    handle: { type: "string", description: "目标窗口句柄，优先使用" },
    titleContains: { type: "string", description: "窗口标题包含文本，未提供 handle 时使用；都不提供则使用前台窗口" },
    maxElements: { type: "integer", default: 80, minimum: 1, maximum: 300, description: "最多返回元素数量" },
    includeOffscreen: { type: "boolean", default: false, description: "是否包含屏幕外元素" },
    activateBeforeRead: { type: "boolean", default: false, description: "读取前先短暂激活目标窗口；用于 UWP/WinUI 等后台不展开 UIA 子树的窗口，会改变前台窗口状态" },
  },
};

function diagnoseEmptyTree(result, { handle, titleContains, activateBeforeRead } = {}) {
  const diag = result.enumerationDiagnostics || {};
  const win = result.window || {};
  const b = win.bounds || {};
  const overlapDescendants = Number(diag.rootOverlapDescendants || 0);
  const overlapChildren = Array.isArray(diag.rootOverlapChildren) ? diag.rootOverlapChildren : [];
  const minimized = (Number(b.left) <= -20000) || (Number(b.top) <= -20000);
  const hints = [];
  let likelyCause = "unknown";

  if (minimized) {
    likelyCause = "window-minimized";
    hints.push("目标窗口坐标在屏幕外（疑似最小化）。请先还原/聚焦该窗口，再重新调用 ui-tree。");
  } else if (overlapDescendants > 0) {
    // The window's own subtree is empty but the desktop root sees plenty of elements:
    // classic UWP/WinUI host mismatch (e.g. SystemSettings vs ApplicationFrameHost).
    likelyCause = "uwp-host-mismatch";
    const frameHost = overlapChildren.find((c) => /ApplicationFrameHost/i.test(c.className || "") || /ApplicationFrameWindow/i.test(c.className || ""));
    hints.push("目标窗口自身子树为空，但桌面根可见大量元素——典型的 UWP/WinUI 宿主错位（如『设置』的真实 UI 挂在 ApplicationFrameHost 而非逻辑进程）。");
    hints.push("请用 list-windows 找到同名窗口中 processName 为 ApplicationFrameHost 的那个句柄，改用它重试。");
    if (frameHost?.processId) hints.push(`候选宿主进程 PID=${frameHost.processId}。`);
    if (!activateBeforeRead) hints.push("也可加 activateBeforeRead=true 让窗口前置后展开 UIA 子树（会改变前台窗口）。");
  } else {
    likelyCause = "no-accessible-tree";
    hints.push("该窗口未暴露任何 UIA 元素（可能是纯 GDI 绘制、受保护窗口或无障碍树为空）。");
    if (!activateBeforeRead) hints.push("可尝试 activateBeforeRead=true。");
  }

  return {
    isEmpty: true,
    likelyCause,
    queriedBy: handle ? "handle" : titleContains ? "titleContains" : "foreground",
    triedStrategy: result.enumerationStrategy || null,
    rootOverlapDescendants: overlapDescendants,
    hints,
  };
}

export async function execute(input = {}) {
  const handle = escapePowerShellSingleQuoted(input.handle || "");
  const titleContains = escapePowerShellSingleQuoted(input.titleContains || "");
  const maxElements = Math.min(Math.max(Number(input.maxElements || 80), 1), 300);
  const includeOffscreen = input.includeOffscreen === true;
  const activateBeforeRead = input.activateBeforeRead === true;

  const script = `
$ErrorActionPreference = "Stop"
${JSON_RESULT_PREAMBLE}
${WINDOW_API_SNIPPET}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Resolve-TargetWindow {
  if ('${handle}') { return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([int64]'${handle}')) }
  if ('${titleContains}') {
    $needle = '${titleContains}'.ToLowerInvariant()
    $script:hanaTargetHandle = [IntPtr]::Zero
    $callback = [HanaWindowApi+EnumWindowsProc]{ param($hwnd, $lparam)
      if (-not [HanaWindowApi]::IsWindowVisible($hwnd)) { return $true }
      $len = [HanaWindowApi]::GetWindowTextLength($hwnd)
      if ($len -le 0) { return $true }
      $sb = New-Object System.Text.StringBuilder ($len + 1)
      [HanaWindowApi]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
      if ($sb.ToString().ToLowerInvariant().Contains($needle)) { $script:hanaTargetHandle = $hwnd; return $false }
      return $true
    }
    [HanaWindowApi]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
    if ($script:hanaTargetHandle -ne [IntPtr]::Zero) { return [System.Windows.Automation.AutomationElement]::FromHandle($script:hanaTargetHandle) }
    return $null
  }
  return [System.Windows.Automation.AutomationElement]::FromHandle([HanaWindowApi]::GetForegroundWindow())
}

function Pattern-Names($el) {
  $items = @()
  try { $p = $null; if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $items += 'Invoke' } } catch {}
  try { $p = $null; if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { $items += 'Value' } } catch {}
  try { $p = $null; if ($el.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$p)) { $items += 'Scroll' } } catch {}
  try { $p = $null; if ($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { $items += 'Toggle' } } catch {}
  return @($items)
}

function Safe-Int($value) {
  try { $number = [double]$value } catch { return $null }
  if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { return $null }
  if ($number -lt [int]::MinValue -or $number -gt [int]::MaxValue) { return $null }
  return [int][Math]::Round($number)
}

function Rect-ToJson($rect, $includeCenter) {
  $left = Safe-Int $rect.Left
  $top = Safe-Int $rect.Top
  $width = Safe-Int $rect.Width
  $height = Safe-Int $rect.Height
  $result = @{
    left = $left
    top = $top
    right = Safe-Int $rect.Right
    bottom = Safe-Int $rect.Bottom
    width = $width
    height = $height
  }
  if ($includeCenter) {
    $result.centerX = Safe-Int ($rect.Left + ($rect.Width / 2))
    $result.centerY = Safe-Int ($rect.Top + ($rect.Height / 2))
  }
  return $result
}

function Collect-RawDescendants($root, $limit) {
  $items = New-Object System.Collections.ArrayList
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  function Visit-RawNode($node) {
    if ($items.Count -ge $limit) { return }
    $child = $null
    try { $child = $walker.GetFirstChild($node) } catch { $child = $null }
    while ($null -ne $child -and $items.Count -lt $limit) {
      [void]$items.Add($child)
      Visit-RawNode $child
      try { $child = $walker.GetNextSibling($child) } catch { $child = $null }
    }
  }
  Visit-RawNode $root
  return $items
}

function Collect-ChildWindowDescendants($nativeHandle, $limit) {
  $items = New-Object System.Collections.ArrayList
  $children = New-Object System.Collections.ArrayList
  $callback = [HanaWindowApi+EnumChildWindowsProc]{ param($hwnd, $lparam)
    [void]$script:hanaChildHandles.Add($hwnd)
    return $script:hanaChildHandles.Count -lt 200
  }
  $script:hanaChildHandles = New-Object System.Collections.ArrayList
  [HanaWindowApi]::EnumChildWindows([IntPtr]([int64]$nativeHandle), $callback, [IntPtr]::Zero) | Out-Null
  foreach ($childHandle in $script:hanaChildHandles) {
    if ($items.Count -ge $limit) { break }
    $childElement = $null
    try { $childElement = [System.Windows.Automation.AutomationElement]::FromHandle($childHandle) } catch { $childElement = $null }
    if ($null -eq $childElement) { continue }
    $childCurrent = $null
    try { $childCurrent = $childElement.Current } catch { $childCurrent = $null }
    if ($null -ne $childCurrent) {
      [void]$children.Add(@{
        handle = "" + $childHandle.ToInt64()
        name = $childCurrent.Name
        automationId = $childCurrent.AutomationId
        className = $childCurrent.ClassName
        processId = $childCurrent.ProcessId
        role = ($childCurrent.ControlType.ProgrammaticName -replace '^ControlType\\.', '')
      })
    }
    $descendants = $childElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($descendant in $descendants) {
      if ($items.Count -ge $limit) { break }
      [void]$items.Add($descendant)
    }
    if ($items.Count -eq 0) {
      $raw = Collect-RawDescendants $childElement $limit
      foreach ($rawItem in $raw) {
        if ($items.Count -ge $limit) { break }
        [void]$items.Add($rawItem)
      }
    }
  }
  return @{ items = $items; children = @($children) }
}

$window = Resolve-TargetWindow
if ($null -eq $window) { Write-JsonResult @{ ok = $false; error = 'window-not-found' }; exit 0 }
$activatedBeforeRead = $false
if (${activateBeforeRead ? "$true" : "$false"} -and $window.Current.NativeWindowHandle -ne 0) {
  [HanaForegroundApi]::BringToForeground([IntPtr]([int64]$window.Current.NativeWindowHandle)) | Out-Null
  Start-Sleep -Milliseconds 900
  $window = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([int64]$window.Current.NativeWindowHandle))
  $activatedBeforeRead = $true
}
$windowRect = $window.Current.BoundingRectangle
$targetProcessId = $window.Current.ProcessId
$enumerationStrategy = 'window-descendants'
$found = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$enumerationDiagnostics = @{
  windowDescendants = $found.Count
  windowRawDescendants = $null
  childWindows = $null
  childWindowDescendants = $null
  rootProcessDescendants = $null
  rootOverlapChildren = $null
  rootOverlapDescendants = $null
}
if ($found.Count -eq 0) {
  $found = Collect-RawDescendants $window ([Math]::Max(${maxElements} * 20, 600))
  $enumerationStrategy = 'window-raw-descendants'
  $enumerationDiagnostics.windowRawDescendants = $found.Count
}
if ($found.Count -eq 0) {
  $childResult = Collect-ChildWindowDescendants $window.Current.NativeWindowHandle ([Math]::Max(${maxElements} * 20, 600))
  $found = $childResult.items
  $enumerationStrategy = 'child-window-descendants'
  $enumerationDiagnostics.childWindows = $childResult.children
  $enumerationDiagnostics.childWindowDescendants = $found.Count
}
if ($found.Count -eq 0 -and $targetProcessId -gt 0) {
  $processCondition = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ProcessIdProperty), ([int]$targetProcessId)
  $found = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $processCondition)
  $enumerationStrategy = 'root-process-descendants'
  $enumerationDiagnostics.rootProcessDescendants = $found.Count
}
if ($found.Count -eq 0) {
  $overlapDescendants = New-Object System.Collections.ArrayList
  $overlapChildren = New-Object System.Collections.ArrayList
  $rootChildren = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($child in $rootChildren) {
    $childCurrent = $null
    try { $childCurrent = $child.Current } catch { continue }
    $childRect = $childCurrent.BoundingRectangle
    if ($childRect.Width -le 0 -or $childRect.Height -le 0) { continue }
    $left = [Math]::Max($windowRect.Left, $childRect.Left)
    $top = [Math]::Max($windowRect.Top, $childRect.Top)
    $right = [Math]::Min($windowRect.Right, $childRect.Right)
    $bottom = [Math]::Min($windowRect.Bottom, $childRect.Bottom)
    if (($right - $left) -le 8 -or ($bottom - $top) -le 8) { continue }
    [void]$overlapChildren.Add(@{
      name = $childCurrent.Name
      automationId = $childCurrent.AutomationId
      className = $childCurrent.ClassName
      processId = $childCurrent.ProcessId
      role = ($childCurrent.ControlType.ProgrammaticName -replace '^ControlType\\.', '')
      bounds = Rect-ToJson $childRect $false
    })
    $descendants = $child.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($descendant in $descendants) { [void]$overlapDescendants.Add($descendant) }
  }
  $enumerationDiagnostics.rootOverlapChildren = @($overlapChildren)
  $enumerationDiagnostics.rootOverlapDescendants = $overlapDescendants.Count
}
$elements = New-Object System.Collections.ArrayList
$index = 0
foreach ($el in $found) {
  if ($elements.Count -ge ${maxElements}) { break }
  $current = $null
  try { $current = $el.Current } catch { continue }
  if (-not ${includeOffscreen ? "$true" : "$false"} -and $current.IsOffscreen) { continue }
  $rect = $current.BoundingRectangle
  if ($rect.Width -le 0 -or $rect.Height -le 0) { continue }
  $label = @($current.Name, $current.AutomationId, $current.ClassName) | Where-Object { $_ } | Select-Object -First 1
  if (-not $label -and $current.ControlType.ProgrammaticName) { $label = $current.ControlType.ProgrammaticName }
  $elementId = 'el-' + $index
  [void]$elements.Add(@{
    elementId = $elementId
    index = $index
    name = $current.Name
    automationId = $current.AutomationId
    className = $current.ClassName
    role = ($current.ControlType.ProgrammaticName -replace '^ControlType\\.', '')
    enabled = $current.IsEnabled
    offscreen = $current.IsOffscreen
    bounds = Rect-ToJson $rect $true
    patterns = @(Pattern-Names $el)
    label = $label
  })
  $index++
}
Write-JsonResult @{
  ok = $true
  snapshotId = [guid]::NewGuid().ToString()
  window = @{ title = $window.Current.Name; handle = "" + $window.Current.NativeWindowHandle; processId = $window.Current.ProcessId; bounds = Rect-ToJson $windowRect $false }
  enumerationStrategy = $enumerationStrategy
  enumerationDiagnostics = $enumerationDiagnostics
  activatedBeforeRead = $activatedBeforeRead
  count = $elements.Count
  elements = @($elements)
}
`;

  const result = parseJsonOutput(runPowerShell(script), "ui-tree");
  if (Array.isArray(result?.elements)) {
    result.elements = result.elements.map((element) => ({
      ...element,
      signature: buildElementSignature(element),
    }));
  }
  // #10 fix: don't silently return an empty tree. Interpret the diagnostics and tell the
  // caller WHY it is empty and what to try next, instead of leaving raw fields to guess from.
  if (result?.ok && result.count === 0) {
    result.diagnosis = diagnoseEmptyTree(result, { handle: input.handle, titleContains: input.titleContains, activateBeforeRead });
  }
  if (result?.ok && result?.snapshotId) {
    const stored = saveSnapshot(result);
    result.leaseId = stored.leaseId;
    result.expiresAt = stored.expiresAt;
  }
  return JSON.stringify(result, null, 2);
}
