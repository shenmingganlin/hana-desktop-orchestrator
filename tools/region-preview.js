import fs from "fs";
import os from "os";
import path from "path";
import { parseJsonOutput, runPowerShell } from "../lib/powershell.js";
import { findSnapshotElement, loadSnapshot } from "../lib/snapshot-store.js";
import { JSON_RESULT_PREAMBLE } from "../lib/windows.js";
import { buildCoordinateContract } from "../lib/coord-contract.js";

export const name = "region-preview";
export const description = "把 lease 绑定元素的屏幕区域裁剪成 PNG 预览图。只截图，不点击、不输入、不移动鼠标。";
export const parameters = {
  type: "object",
  required: ["leaseId", "snapshotId", "elementId"],
  properties: {
    leaseId: { type: "string", description: "来自 ui-tree 的 leaseId" },
    snapshotId: { type: "string", description: "来自 ui-tree 的 snapshotId" },
    elementId: { type: "string", description: "来自 ui-tree 的快照内元素 id，例如 el-0" },
    padding: { type: "integer", default: 8, minimum: 0, maximum: 120, description: "围绕元素 bounds 扩展的像素" },
    label: { type: "string", description: "可选预览图标签" },
  },
};

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function escapePowerShellSingleQuoted(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function buildCaptureScript({ left, top, width, height, outputPath }) {
  return `
$ErrorActionPreference = "Stop"
${JSON_RESULT_PREAMBLE}
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class HanaDpiAwareness {
  [DllImport("Shcore.dll")]
  public static extern int SetProcessDpiAwareness(int value);
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
  public static void Enable() {
    try { SetProcessDpiAwareness(2); } catch {}
    try { SetProcessDPIAware(); } catch {}
  }
}
"@
[HanaDpiAwareness]::Enable()

$screenBounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$left = [Math]::Max($screenBounds.Left, [int]${left})
$top = [Math]::Max($screenBounds.Top, [int]${top})
$right = [Math]::Min($screenBounds.Right, $left + [int]${width})
$bottom = [Math]::Min($screenBounds.Bottom, $top + [int]${height})
$captureWidth = [Math]::Max(1, $right - $left)
$captureHeight = [Math]::Max(1, $bottom - $top)
$outputPath = '${escapePowerShellSingleQuoted(outputPath)}'
$outputDir = [System.IO.Path]::GetDirectoryName($outputPath)
if (-not [System.IO.Directory]::Exists($outputDir)) { [System.IO.Directory]::CreateDirectory($outputDir) | Out-Null }

$bitmap = New-Object System.Drawing.Bitmap $captureWidth, $captureHeight
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size)
  $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-JsonResult @{
    ok = $true
    mode = 'region-preview'
    filePath = $outputPath
    region = @{ left = $left; top = $top; width = $captureWidth; height = $captureHeight }
  }
} finally {
  if ($graphics) { $graphics.Dispose() }
  if ($bitmap) { $bitmap.Dispose() }
}
`;
}

export async function execute(input = {}, toolCtx = {}) {
  const leaseId = String(input.leaseId || "").trim();
  const snapshotId = String(input.snapshotId || "").trim();
  const elementId = String(input.elementId || "").trim();
  if (!leaseId) throw new Error("leaseId 是必填项");
  if (!snapshotId) throw new Error("snapshotId 是必填项");
  if (!/^el-\d+$/.test(elementId)) throw new Error("elementId 必须形如 el-0");

  const storedSnapshot = loadSnapshot({ leaseId, snapshotId });
  if (!storedSnapshot) {
    return JSON.stringify({ ok: false, reason: "lease-snapshot-not-found", leaseId, snapshotId, elementId }, null, 2);
  }

  const storedElement = findSnapshotElement(storedSnapshot, elementId);
  if (!storedElement?.bounds) {
    return JSON.stringify({ ok: false, reason: "element-bounds-not-found", leaseId, snapshotId, elementId }, null, 2);
  }

  const padding = clampInteger(input.padding, 8, 0, 120);
  const bounds = storedElement.bounds;
  const left = Math.max(0, Number(bounds.left) - padding);
  const top = Math.max(0, Number(bounds.top) - padding);
  const width = Math.max(1, Number(bounds.width) + padding * 2);
  const height = Math.max(1, Number(bounds.height) + padding * 2);
  const outputPath = path.join(os.tmpdir(), "hana-desktop-orchestrator", `region-preview-${Date.now()}-${elementId}.png`).replace(/\\/g, "/");

  const result = parseJsonOutput(runPowerShell(buildCaptureScript({ left, top, width, height, outputPath })), "region-preview");

  // The cropped image maps 1:1 to result.region (physical pixels). Attach the
  // contract so ratio-based targeting on this crop resolves to clickable pixels.
  const contract = result?.ok && result?.region ? buildCoordinateContract(result.region, { kind: "region-preview" }) : {};
  const content = [{ type: "text", text: JSON.stringify({ leaseId, snapshotId, elementId, ...result, ...contract }, null, 2) }];
  const details = { action: "region-preview", leaseId, snapshotId, elementId, result };

  if (result?.ok && result?.filePath && fs.existsSync(result.filePath) && toolCtx.stageFile) {
    const label = input.label || `desktop-orchestrator-${elementId}-preview.png`;
    const mediaItem = toolCtx.stageFile({ sessionPath: toolCtx.sessionPath, filePath: result.filePath, label });
    details.media = { items: [mediaItem] };
  }

  return { content, details };
}
