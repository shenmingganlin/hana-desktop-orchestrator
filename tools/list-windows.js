import { parseJsonOutput, runPowerShell } from "../lib/powershell.js";
import { DPI_AWARE_SNIPPET, JSON_RESULT_PREAMBLE, WINDOW_API_SNIPPET } from "../lib/windows.js";

export const name = "list-windows";
export const description = "列出当前可见的顶层窗口，返回标题、进程、窗口句柄和边界信息。";
export const parameters = {
  type: "object",
  properties: {
    maxResults: { type: "integer", default: 40, minimum: 1, maximum: 200, description: "最多返回窗口数量" },
    titleContains: { type: "string", description: "按窗口标题模糊过滤，可选" },
  },
};

export async function execute(input = {}) {
  const maxResults = Math.min(Math.max(Number(input.maxResults || 40), 1), 200);
  const titleContains = String(input.titleContains || "").replace(/'/g, "''");

  const script = `
$ErrorActionPreference = "Stop"
${DPI_AWARE_SNIPPET}
${JSON_RESULT_PREAMBLE}
${WINDOW_API_SNIPPET}
$items = New-Object System.Collections.ArrayList
$foreground = [HanaWindowApi]::GetForegroundWindow()
$callback = [HanaWindowApi+EnumWindowsProc]{ param($hwnd, $lparam)
  if (-not [HanaWindowApi]::IsWindowVisible($hwnd)) { return $true }
  $len = [HanaWindowApi]::GetWindowTextLength($hwnd)
  if ($len -le 0) { return $true }
  $sb = New-Object System.Text.StringBuilder ($len + 1)
  [HanaWindowApi]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
  $title = $sb.ToString()
  if ('${titleContains}' -and $title.ToLowerInvariant().IndexOf('${titleContains}'.ToLowerInvariant()) -lt 0) { return $true }
  $processIdValue = 0
  [HanaWindowApi]::GetWindowThreadProcessId($hwnd, [ref]$processIdValue) | Out-Null
  $rect = New-Object HanaWindowApi+RECT
  [HanaWindowApi]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
  $processName = $null
  try { $processName = (Get-Process -Id $processIdValue -ErrorAction Stop).ProcessName } catch {}
  [void]$items.Add(@{
    handle = "" + $hwnd.ToInt64()
    title = $title
    processId = [int]$processIdValue
    processName = $processName
    isForeground = ($hwnd -eq $foreground)
    bounds = @{ left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top }
  })
  return $items.Count -lt ${maxResults}
}
[HanaWindowApi]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
Write-JsonResult @{ count = $items.Count; windows = @($items) }
`;

  return JSON.stringify(parseJsonOutput(runPowerShell(script), "list-windows"));
}
