import fs from "fs";
import os from "os";
import path from "path";
import { parseJsonOutput, runPowerShell } from "../lib/powershell.js";
import { DPI_SNIPPET, DPI_AWARE_SNIPPET, JSON_RESULT_PREAMBLE, WINDOW_API_SNIPPET } from "../lib/windows.js";

export const name = "snapshot";
export const description = "采集桌面状态：DPI、活动窗口、可见窗口列表，并可选返回一张全屏截图。";
export const parameters = {
  type: "object",
  properties: {
    includeScreenshot: { type: "boolean", default: false, description: "是否截取全屏截图" },
    maxWindows: { type: "integer", default: 30, minimum: 1, maximum: 100, description: "最多返回窗口数量" },
  },
};

export async function execute(input = {}, toolCtx = {}) {
  const includeScreenshot = input.includeScreenshot === true;
  const maxWindows = Math.min(Math.max(Number(input.maxWindows || 30), 1), 100);
  const screenshotPath = path.join(os.tmpdir(), "hana-desktop-orchestrator", `snapshot-${Date.now()}.png`).replace(/\\/g, "/");

  const screenshotBlock = includeScreenshot ? `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($hanaPhysWidth, $hanaPhysHeight)
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($hanaPhysLeft, $hanaPhysTop, 0, 0, $bmp.Size)
$bmp.Save('${screenshotPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bmp.Dispose()
` : "";

  const script = `
$ErrorActionPreference = "Stop"
${DPI_AWARE_SNIPPET}
${JSON_RESULT_PREAMBLE}
${DPI_SNIPPET}
${WINDOW_API_SNIPPET}
Add-Type -AssemblyName System.Windows.Forms
${screenshotBlock}
$foreground = [HanaWindowApi]::GetForegroundWindow()
$windows = New-Object System.Collections.ArrayList
$callback = [HanaWindowApi+EnumWindowsProc]{ param($hwnd, $lparam)
  if (-not [HanaWindowApi]::IsWindowVisible($hwnd)) { return $true }
  $len = [HanaWindowApi]::GetWindowTextLength($hwnd)
  if ($len -le 0) { return $true }
  $sb = New-Object System.Text.StringBuilder ($len + 1)
  [HanaWindowApi]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
  $processIdValue = 0
  [HanaWindowApi]::GetWindowThreadProcessId($hwnd, [ref]$processIdValue) | Out-Null
  $rect = New-Object HanaWindowApi+RECT
  [HanaWindowApi]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
  [void]$windows.Add(@{
    handle = "" + $hwnd.ToInt64()
    title = $sb.ToString()
    processId = [int]$processIdValue
    isForeground = ($hwnd -eq $foreground)
    bounds = @{ left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top }
  })
  return $windows.Count -lt ${maxWindows}
}
[HanaWindowApi]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
Write-JsonResult @{
  screen = @{ left = $hanaPhysLeft; top = $hanaPhysTop; width = $hanaPhysWidth; height = $hanaPhysHeight; scaleX = $hanaScaleX; scaleY = $hanaScaleY; dpiAware = $hanaDpiAwareSet }
  foregroundHandle = "" + $foreground.ToInt64()
  windows = @($windows)
  screenshotPath = $(if (${includeScreenshot ? "$true" : "$false"}) { '${screenshotPath}' } else { $null })
}
`;

  const snapshot = parseJsonOutput(runPowerShell(script), "snapshot");
  const content = [{ type: "text", text: JSON.stringify(snapshot, null, 2) }];
  const details = { action: "snapshot", snapshot };

  if (includeScreenshot && snapshot?.screenshotPath && fs.existsSync(snapshot.screenshotPath) && toolCtx.stageFile) {
    const mediaItem = toolCtx.stageFile({ sessionPath: toolCtx.sessionPath, filePath: snapshot.screenshotPath, label: "desktop-orchestrator-snapshot.png" });
    details.media = { items: [mediaItem] };
  }

  return { content, details };
}
