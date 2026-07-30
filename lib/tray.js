// tray.js
// Windows 通知区域（系统托盘）操作库。
// 支持枚举托盘图标、定位指定图标的按钮区域、模拟点击。
// Windows 11 22H2+ 托盘结构有变化，部分传统 API 可能无效，
// 此模块提供降级策略：尝试 UIA → 回退到区域点击。

import { spawnSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";
import { HANA_WIN32_DLL } from "./powershell.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 枚举通知区域所有托盘图标。
 * 返回数组 [ { name, handle, rect } ] 或空数组。
 */
export function enumerateTrayIcons() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const tmp = os.tmpdir();
  const psFile = path.join(tmp, `hana-tray-enum-${stamp}.ps1`);
  try {
    const script = `
Add-Type -Path "${HANA_WIN32_DLL.replace(/"/g, '`"')}"
$ErrorActionPreference = "Stop"

# 方法1：通过 UIA 枚举通知区域图标（Win11 兼容）
try {
  Add-Type -AssemblyName UIAutomationClient
  $tb = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
    New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "Shell_TrayWnd"))
  if ($tb) {
    $nt = $tb.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
      New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "TrayNotifyWnd"))
    if (-not $nt) {
      # Win11 22H2+ 可能用其他类名
      $nt = $tb.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
        New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "NotifyIconOverflowWindow"))
    }
    $icons = @()
    if ($nt) {
      $children = $nt.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
      foreach ($child in $children) {
        $name = $child.Current.Name
        $rect = $child.Current.BoundingRectangle
        if ($name -and $rect.Width -gt 0 -and $rect.Height -gt 0) {
          $icons += @{ name=$name; handle=""+$child.Current.NativeWindowHandle; x=[int]$rect.Left; y=[int]$rect.Top; w=[int]$rect.Width; h=[int]$rect.Height }
        }
      }
    }
    if ($icons.Count -gt 0) {
      Write-Output ($icons | ConvertTo-Json -Compress -Depth 3)
      exit 0
    }
  }
} catch {}

# 方法2：通过窗口枚举（传统方法，Win10 兼容）
try {
  $icons = @()
  $callback = {
    param($hwnd, $lparam)
    $len = [HanaWindowApi]::GetWindowTextLength($hwnd)
    if ($len -gt 0) {
      $sb = New-Object System.Text.StringBuilder ($len + 1)
      [HanaWindowApi]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
      $rect = New-Object HanaWindowApi+RECT
      [HanaWindowApi]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
      $w = $rect.Right - $rect.Left
      $h = $rect.Bottom - $rect.Top
      if ($w -gt 0 -and $h -gt 0) {
        $icons += @{ name=$sb.ToString(); handle=""+$hwnd.ToInt64(); x=$rect.Left; y=$rect.Top; w=$w; h=$h }
      }
    }
    return $true
  }
  [HanaWindowApi]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
  if ($icons.Count -gt 0) {
    Write-Output ($icons | ConvertTo-Json -Compress -Depth 3)
    exit 0
  }
} catch {}

# 方法3：返回空数组
Write-Output "[]"
`;
    fs.writeFileSync(psFile, `\uFEFF${script}`, "utf-8");
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", psFile],
      { encoding: "utf-8", timeout: 10000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
    );
    if (result.error) return [];
    const out = (result.stdout || "").trim();
    if (!out || out === "[]") return [];
    return JSON.parse(out);
  } catch {
    return [];
  } finally {
    try { if (fs.existsSync(psFile)) fs.unlinkSync(psFile); } catch {}
  }
}

/**
 * 根据窗口标题关键词查找通知区域中的图标。
 * @param {string} keyword - 要匹配的标题关键词
 * @returns {object|null} { name, handle, x, y, w, h }
 */
export function findIconByTitle(keyword) {
  if (!keyword) return null;
  const icons = enumerateTrayIcons();
  const kw = keyword.toLowerCase();
  for (const icon of icons) {
    if (icon.name && icon.name.toLowerCase().includes(kw)) {
      return icon;
    }
  }
  return null;
}
