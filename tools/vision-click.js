import fs from "fs";
import os from "os";
import path from "path";
import { runPowerShell } from "../lib/powershell.js";
import { DPI_SNIPPET, DPI_AWARE_SNIPPET, JSON_RESULT_PREAMBLE, WINDOW_API_SNIPPET, escapePowerShellSingleQuoted } from "../lib/windows.js";

export const name = "vision-click";
export const description =
  "截图目标区域 + 坐标契约 → AI 视觉分析 → 自动点击。\n" +
  "两步工作流：\n" +
  "  1. 传入 description + area → 截图上传，AI 分析目标位置\n" +
  "  2. AI 返回目标坐标 → 自动换算物理像素 → 鼠标点击\n" +
  "适用于 UIA 无法定位的自定义控件、游戏界面、Web Canvas 等。";
export const parameters = {
  type: "object",
  properties: {
    description: {
      type: "string",
      description: "要点击的目标描述，如 '× 关闭按钮'、'搜索框'、'登录按钮'",
    },
    area: {
      oneOf: [
        { type: "string", enum: ["fullscreen", "window"] },
        {
          type: "object",
          properties: {
            left: { type: "integer" },
            top: { type: "integer" },
            width: { type: "integer" },
            height: { type: "integer" },
          },
          required: ["left", "top", "width", "height"],
        },
      ],
      default: "window",
      description:
        "截图区域：fullscreen / window(按窗口句柄) / {left,top,width,height}",
    },
    windowHandle: { type: "string", description: "area=window 时的目标窗口句柄" },
    titleContains: { type: "string", description: "没有句柄时用窗口标题搜索" },
    captureMethod: {
      type: "string",
      enum: ["auto", "screen", "printWindow"],
      default: "printWindow",
      description: "截图方式：auto(自动选择)、screen(CopyFromScreen)、printWindow(PrintWindow，GPU渲染应用推荐)",
    },
  },
};

async function captureImage(area, { windowHandle, titleContains, captureMethod } = {}) {
  const tempDir = path.join(os.tmpdir(), "hana-desktop-orchestrator");
  fs.mkdirSync(tempDir, { recursive: true });
  const screenshotPath = path.join(tempDir, `vision-click-${Date.now()}.png`).replace(/\\/g, "/");

  if (area === "fullscreen") {
    const script = `
${DPI_AWARE_SNIPPET}
${JSON_RESULT_PREAMBLE}
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($hanaPhysWidth, $hanaPhysHeight)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($hanaPhysLeft, $hanaPhysTop, 0, 0, $bmp.Size)
$bmp.Save('${screenshotPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-JsonResult @{ left=$hanaPhysLeft; top=$hanaPhysTop; width=$hanaPhysWidth; height=$hanaPhysHeight }
`;
    const result = runPowerShell(script);
    if (!result.ok) throw new Error("Fullscreen capture failed: " + (result.error || ""));
    const info = JSON.parse(result.stdout);
    info.screenshotPath = screenshotPath;
    return info;
  }

  if (area === "window") {
    const hwnd = windowHandle ? `[IntPtr]([int64]'${escapePowerShellSingleQuoted(windowHandle)}')` : "0";
    const titleFilter = escapePowerShellSingleQuoted(titleContains || "");
    const usePrint = captureMethod === "printWindow" || (captureMethod !== "screen" && true);

    const script = `
${DPI_AWARE_SNIPPET}
${JSON_RESULT_PREAMBLE}
${WINDOW_API_SNIPPET}
Add-Type -AssemblyName System.Drawing

$target = $null
if (${hwnd} -ne 0) { $target = ${hwnd} }
elseif ('${titleFilter}') {
  [HanaWindowApi]::EnumWindows({
    param($h, $p)
    if (-not [HanaWindowApi]::IsWindowVisible($h)) { return $true }
    $len = [HanaWindowApi]::GetWindowTextLength($h)
    if ($len -le 0) { return $true }
    $sb = New-Object System.Text.StringBuilder ($len + 1)
    [HanaWindowApi]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
    if ($sb.ToString().ToLowerInvariant().Contains('${titleFilter}')) { $script:targetHandle = $h; return $false }
    return $true
  }, 0) | Out-Null
  $target = $script:targetHandle
}
if (-not $target) { Write-JsonResult @{ error = 'window-not-found' }; exit 0 }

$rect = New-Object HanaWindowApi+RECT
[HanaWindowApi]::GetWindowRect($target, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top

$bmp = New-Object System.Drawing.Bitmap([Math]::Max(1,$w), [Math]::Max(1,$h))
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()

${usePrint ? 'Add-Type @"' : '// '}using System;using System.Runtime.InteropServices;
public class PW { [DllImport("user32.dll")]public static extern bool PrintWindow(IntPtr h,IntPtr d,int f); }
"@
$ok = ${usePrint ? '[PW]::PrintWindow($target, $dc, 2)' : '$g.ReleaseHdc($dc); $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size); 1'}
$g.ReleaseHdc($dc); $g.Dispose()
if (-not $ok) { $bmp.Dispose(); Write-JsonResult @{ error = 'capture-failed' }; exit 0 }
$bmp.Save('${screenshotPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-JsonResult @{ left=$rect.Left; top=$rect.Top; width=$w; height=$h }
`;
    const result = runPowerShell(script);
    if (!result.ok) throw new Error("Window capture failed: " + (result.error || ""));
    const info = JSON.parse(result.stdout);
    if (info.error) throw new Error(info.error);
    info.screenshotPath = screenshotPath;
    info.captureMethod = usePrint ? "printWindow" : "screen";
    return info;
  }

  // Custom area
  if (area && typeof area === "object") {
    const { left, top, width, height } = area;
    const script = `
${DPI_AWARE_SNIPPET}
${JSON_RESULT_PREAMBLE}
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap([Math]::Max(1,${width}), [Math]::Max(1,${height}))
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(${left}, ${top}, 0, 0, $bmp.Size)
$bmp.Save('${screenshotPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-JsonResult @{ left=${left}; top=${top}; width=${width}; height=${height} }
`;
    const result = runPowerShell(script);
    if (!result.ok) throw new Error("Custom area capture failed: " + (result.error || ""));
    const info = JSON.parse(result.stdout);
    info.screenshotPath = screenshotPath;
    return info;
  }

  throw new Error("Unknown area: " + area);
}

export async function execute(input = {}, ctx = {}) {
  const description = String(input.description || "").trim();
  const area = input.area || "window";
  const windowHandle = String(input.windowHandle || "").trim();
  const titleContains = String(input.titleContains || "").trim();
  const captureMethod = input.captureMethod || "printWindow";

  if (!description) {
    return JSON.stringify({ ok: false, error: "请描述要点击的目标" });
  }

  try {
    const captureInfo = await captureImage(area, { windowHandle, titleContains, captureMethod });

    // 用 stageFile 把截图嵌入返回，让 AI vision 可以看到
    let mediaItem = null;
    if (ctx.stageFile && ctx.sessionPath && fs.existsSync(captureInfo.screenshotPath)) {
      try {
        mediaItem = ctx.stageFile({
          sessionPath: ctx.sessionPath,
          filePath: captureInfo.screenshotPath,
          label: `vision-click-${description}.png`,
        });
      } catch (e) {
        // stageFile 失败不阻断流程
      }
    }

    // 返回截图信息 + 坐标契约，AI 分析后可以换算
    const screenshotInfo = {
      path: captureInfo.screenshotPath,
      width: captureInfo.width,
      height: captureInfo.height,
      left: captureInfo.left,
      top: captureInfo.top,
      captureMethod: captureInfo.captureMethod || "printWindow",
    };

    // 构建坐标契约，让 AI 拿到截图就能知道物理像素换算
    const coordinateContract = {
      physical: {
        left: captureInfo.left,
        top: captureInfo.top,
        width: captureInfo.width,
        height: captureInfo.height,
      },
      rule: "从截图中找到目标元素，说出它的中心物理坐标 [x, y]。举例：如果发送按钮在截图中央略偏右，大致在 (left+width*0.6, top+height*0.85) 处。用户可以直接用 mouse-click-at 点击该坐标。",
    };

    const content = [
      { type: "text", text: JSON.stringify({
        ok: true,
        action: "vision-click",
        description,
        area,
        screenshot: screenshotInfo,
        coordinateContract,
        instructions: `截图已生成。请分析截图中的「${description}」位置，然后调用 mouse-click-at 传入换算后的物理像素坐标。`,
      }, null, 2) },
    ];

    let details = {
      action: "vision-click",
      description,
      screenshotInfo,
      coordinateContract,
    };
    if (mediaItem) {
      details.media = { items: [mediaItem] };
    }

    return { content, details };
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}
