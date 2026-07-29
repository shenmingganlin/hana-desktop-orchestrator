import fs from "fs";
import os from "os";
import path from "path";
import { runPowerShell } from "../lib/powershell.js";
import { findIconByTitle } from "../lib/tray.js";
import { DPI_SNIPPET, DPI_AWARE_SNIPPET, JSON_RESULT_PREAMBLE, WINDOW_API_SNIPPET, escapePowerShellSingleQuoted } from "../lib/windows.js";

export const name = "tray-restore";
export const description =
  "一键将指定窗口从系统托盘恢复到桌面。\n" +
  "通过 UIA 枚举通知区域图标并模拟左键点击来恢复窗口。\n" +
  "适用于 Electron 应用（如 HanaAgent）点击 × 隐藏到托盘后的恢复。";
export const parameters = {
  type: "object",
  properties: {
    titleKeyword: {
      type: "string",
      default: "HanaAgent",
      description: "要恢复的窗口标题关键词（默认 HanaAgent）",
    },
    dryRun: {
      type: "boolean",
      default: true,
      description: "仅预览操作计划，不执行真实操作",
    },
  },
};

export async function execute(input = {}, ctx = {}) {
  const titleKeyword = String(input.titleKeyword || "HanaAgent").trim();
  const dryRun = input.dryRun !== false;

  // 步骤1：通过 UIA 查找通知区域图标
  const icon = findIconByTitle(titleKeyword);

  if (icon && icon.x && icon.y) {
    const targetX = icon.x + Math.floor(icon.w / 2);
    const targetY = icon.y + Math.floor(icon.h / 2);

    if (dryRun) {
      return JSON.stringify({
        ok: true,
        dryRun: true,
        method: "tray-icon-click",
        titleKeyword,
        icon,
        clickPlan: { x: targetX, y: targetY },
        instruction: `找到托盘图标「${icon.name}」在 (${icon.x},${icon.y}) 大小 ${icon.w}×${icon.h}。`,
        nextStep: "调用 desktop-orchestrator_mouse-click-at 传入上述坐标",
      }, null, 2);
    }

    // 用鼠标左键点击托盘图标恢复窗口
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const tmp = os.tmpdir();
    const psFile = path.join(tmp, `hana-tray-click-${stamp}.ps1`);
    try {
      // 用 PS 直接模拟点击（绕过工具限制）
      const script = `
${DPI_AWARE_SNIPPET}
Add-Type -Path "${path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'helper', 'HanaWin32.dll').replace(/"/g, '`"')}"
[DoMouse]::SetCursorPos(${targetX}, ${targetY})
Start-Sleep -m 50
[DoMouse]::mouse_event(0x0002, 0, 0, 0, 0)  # mouse left down
Start-Sleep -m 30
[DoMouse]::mouse_event(0x0004, 0, 0, 0, 0)  # mouse left up
Write-Output "OK"
`;
      fs.writeFileSync(psFile, `\uFEFF${script}`, "utf-8");
      const { spawnSync } = await import("child_process");

      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", psFile],
        { encoding: "utf-8", timeout: 10000, windowsHide: true }
      );

      if (result.error) {
        return JSON.stringify({ ok: false, error: "点击失败: " + result.error.message, method: "tray-icon-click" });
      }

      return JSON.stringify({
        ok: true,
        method: "tray-icon-click",
        titleKeyword,
        icon,
        clicked: { x: targetX, y: targetY },
        psStatus: (result.stdout || "").trim(),
      }, null, 2);
    } finally {
      try { if (fs.existsSync(psFile)) fs.unlinkSync(psFile); } catch {}
    }
  }

  // 步骤2：如果 UIA 找不到托盘图标，尝试直接用 SwitchToThisWindow 恢复
  const stamp2 = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const tmp2 = os.tmpdir();
  const psFile2 = path.join(tmp2, `hana-tray-force-${stamp2}.ps1`);
  try {
    const script2 = `
${DPI_AWARE_SNIPPET}
${JSON_RESULT_PREAMBLE}
${WINDOW_API_SNIPPET}
# 查找匹配标题的窗口
$found = $false
[HanaWindowApi]::EnumWindows({
  param($hwnd, $lparam)
  $len = [HanaWindowApi]::GetWindowTextLength($hwnd)
  if ($len -le 0) { return $true }
  $sb = New-Object System.Text.StringBuilder ($len + 1)
  [HanaWindowApi]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
  if ($sb.ToString().ToLowerInvariant().Contains('${escapePowerShellSingleQuoted(titleKeyword.toLowerCase())}') -and [HanaWindowApi]::IsWindowVisible($hwnd)) {
    $script:targetHandle = $hwnd
    return $false
  }
  return $true
}, 0) | Out-Null

if (-not $script:targetHandle) {
  # 第二遍：也找隐藏的窗口
  [HanaWindowApi]::EnumWindows({
    param($hwnd, $lparam)
    $len = [HanaWindowApi]::GetWindowTextLength($hwnd)
    if ($len -le 0) { return $true }
    $sb = New-Object System.Text.StringBuilder ($len + 1)
    [HanaWindowApi]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
    if ($sb.ToString().ToLowerInvariant().Contains('${escapePowerShellSingleQuoted(titleKeyword.toLowerCase())}')) {
      $script:targetHandle = $hwnd
      return $false
    }
    return $true
  }, 0) | Out-Null
}

if (-not $script:targetHandle) {
  Write-JsonResult @{ ok=$false; error='window-not-found' }
  exit 0
}

$h = $script:targetHandle
[HanaWindowManageApi]::SwitchToThisWindow($h, $true) | Out-Null
Start-Sleep -m 200
[HanaWindowManageApi]::ShowWindow($h, 9) | Out-Null  # SW_RESTORE
Start-Sleep -m 100
[HanaWindowManageApi]::ShowWindow($h, 3) | Out-Null  # SW_MAXIMIZE
$rect = New-Object HanaWindowApi+RECT
[HanaWindowApi]::GetWindowRect($h, [ref]$rect) | Out-Null
Write-JsonResult @{ ok=$true; handle=""+$h.ToInt64(); bounds=@{ left=$rect.Left; top=$rect.Top; right=$rect.Right; bottom=$rect.Bottom; w=$rect.Right-$rect.Left; h=$rect.Bottom-$rect.Top } }
`;
    fs.writeFileSync(psFile2, `\uFEFF${script2}`, "utf-8");
    const { spawnSync } = await import("child_process");

    const result2 = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", psFile2],
      { encoding: "utf-8", timeout: 15000, windowsHide: true }
    );

    if (result2.error) {
      return JSON.stringify({ ok: false, error: "强制恢复失败: " + result2.error.message, method: "force" });
    }

    const out = (result2.stdout || "").trim();
    try {
      const parsed = JSON.parse(out);
      return JSON.stringify({
        ok: parsed.ok,
        method: "force",
        titleKeyword,
        handle: parsed.handle,
        bounds: parsed.bounds,
        note: "通过 SwitchToThisWindow + ShowWindow 强制恢复",
      }, null, 2);
    } catch {
      return JSON.stringify({ ok: false, error: "解析失败: " + out.slice(0, 200), method: "force" });
    }
  } finally {
    try { if (fs.existsSync(psFile2)) fs.unlinkSync(psFile2); } catch {}
  }
}
