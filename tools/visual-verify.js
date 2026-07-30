import { parseJsonOutput, runPowerShell } from "../lib/powershell.js";
import { findSnapshotElement, loadSnapshot } from "../lib/snapshot-store.js";
import { DPI_AWARE_SNIPPET, JSON_RESULT_PREAMBLE } from "../lib/windows.js";

export const name = "visual-verify";
export const description = "对 lease 绑定元素区域做截图采样，生成视觉签名并可与期望签名计算差异。只观察，不执行任何桌面动作。";
export const parameters = {
  type: "object",
  required: ["leaseId", "snapshotId", "elementId"],
  properties: {
    leaseId: { type: "string", description: "来自 ui-tree 的 leaseId" },
    snapshotId: { type: "string", description: "来自 ui-tree 的 snapshotId" },
    elementId: { type: "string", description: "来自 ui-tree 的快照内元素 id，例如 el-0" },
    expectedVisualSignature: { type: "array", items: { type: "string" }, description: "上一次 visual-verify 返回的 visualSignature.cells" },
    threshold: { type: "number", default: 0.08, description: "差异通过阈值，0 到 1；越小越严格" },
    gridSize: { type: "integer", default: 8, minimum: 2, maximum: 16, description: "采样网格边长" },
    padding: { type: "integer", default: 0, minimum: 0, maximum: 80, description: "围绕元素 bounds 扩展的像素" },
  },
};

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function normalizeThreshold(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.08;
  return Math.max(0, Math.min(1, number));
}

function parseRgb(cell) {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(String(cell || ""));
  if (!match) return null;
  const hex = match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function computeDiffScore(actualCells, expectedCells) {
  if (!Array.isArray(actualCells) || !Array.isArray(expectedCells) || actualCells.length !== expectedCells.length || actualCells.length === 0) {
    return null;
  }

  let total = 0;
  let compared = 0;
  for (let index = 0; index < actualCells.length; index++) {
    const actual = parseRgb(actualCells[index]);
    const expected = parseRgb(expectedCells[index]);
    if (!actual || !expected) return null;
    total += Math.abs(actual[0] - expected[0]) + Math.abs(actual[1] - expected[1]) + Math.abs(actual[2] - expected[2]);
    compared++;
  }
  return compared > 0 ? total / (compared * 255 * 3) : null;
}

function buildCaptureScript({ left, top, width, height, gridSize }) {
  return `
$ErrorActionPreference = "Stop"
${DPI_AWARE_SNIPPET}
${JSON_RESULT_PREAMBLE}
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$screenBounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$left = [Math]::Max($screenBounds.Left, [int]${left})
$top = [Math]::Max($screenBounds.Top, [int]${top})
$right = [Math]::Min($screenBounds.Right, $left + [int]${width})
$bottom = [Math]::Min($screenBounds.Bottom, $top + [int]${height})
$captureWidth = [Math]::Max(1, $right - $left)
$captureHeight = [Math]::Max(1, $bottom - $top)
$gridSize = [int]${gridSize}

$bitmap = New-Object System.Drawing.Bitmap $captureWidth, $captureHeight
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size)
  $cells = New-Object System.Collections.Generic.List[string]
  for ($gy = 0; $gy -lt $gridSize; $gy++) {
    for ($gx = 0; $gx -lt $gridSize; $gx++) {
      $x0 = [Math]::Floor($gx * $captureWidth / $gridSize)
      $x1 = [Math]::Max($x0 + 1, [Math]::Floor(($gx + 1) * $captureWidth / $gridSize))
      $y0 = [Math]::Floor($gy * $captureHeight / $gridSize)
      $y1 = [Math]::Max($y0 + 1, [Math]::Floor(($gy + 1) * $captureHeight / $gridSize))
      $stepX = [Math]::Max(1, [Math]::Floor(($x1 - $x0) / 4))
      $stepY = [Math]::Max(1, [Math]::Floor(($y1 - $y0) / 4))
      [int64]$r = 0
      [int64]$g = 0
      [int64]$b = 0
      [int]$count = 0
      for ($y = $y0; $y -lt $y1; $y += $stepY) {
        for ($x = $x0; $x -lt $x1; $x += $stepX) {
          $pixel = $bitmap.GetPixel([int]$x, [int]$y)
          $r += $pixel.R
          $g += $pixel.G
          $b += $pixel.B
          $count++
        }
      }
      if ($count -le 0) { $count = 1 }
      $avgR = [Math]::Round($r / $count)
      $avgG = [Math]::Round($g / $count)
      $avgB = [Math]::Round($b / $count)
      $cells.Add(('#{0:X2}{1:X2}{2:X2}' -f [int]$avgR, [int]$avgG, [int]$avgB)) | Out-Null
    }
  }
  Write-JsonResult @{
    ok = $true
    mode = 'visual-signature'
    region = @{ left = $left; top = $top; width = $captureWidth; height = $captureHeight; gridSize = $gridSize }
    visualSignature = @{ algorithm = 'avg-rgb-grid-v1'; gridSize = $gridSize; cells = @($cells) }
  }
} finally {
  if ($graphics) { $graphics.Dispose() }
  if ($bitmap) { $bitmap.Dispose() }
}
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
    return JSON.stringify({ ok: false, passed: false, reason: "lease-snapshot-not-found", leaseId, snapshotId, elementId }, null, 2);
  }

  const storedElement = findSnapshotElement(storedSnapshot, elementId);
  if (!storedElement?.bounds) {
    return JSON.stringify({ ok: false, passed: false, reason: "element-bounds-not-found", leaseId, snapshotId, elementId }, null, 2);
  }

  const gridSize = clampInteger(input.gridSize, 8, 2, 16);
  const padding = clampInteger(input.padding, 0, 0, 80);
  const threshold = normalizeThreshold(input.threshold);
  const bounds = storedElement.bounds;
  const left = Math.max(0, Number(bounds.left) - padding);
  const top = Math.max(0, Number(bounds.top) - padding);
  const width = Math.max(1, Number(bounds.width) + padding * 2);
  const height = Math.max(1, Number(bounds.height) + padding * 2);

  const result = parseJsonOutput(runPowerShell(buildCaptureScript({ left, top, width, height, gridSize })), "visual-verify");
  if (!result?.ok) {
    return JSON.stringify({ ok: false, passed: false, reason: result?.error || "capture-failed", leaseId, snapshotId, elementId, result }, null, 2);
  }

  const actualCells = result.visualSignature?.cells || [];
  const expectedCells = input.expectedVisualSignature;
  const diffScore = computeDiffScore(actualCells, expectedCells);
  const hasExpected = Array.isArray(expectedCells);
  const passed = hasExpected ? diffScore !== null && diffScore <= threshold : null;

  return JSON.stringify({
    ok: true,
    passed,
    reason: hasExpected ? (passed ? "visual-diff-within-threshold" : "visual-diff-above-threshold") : "baseline-captured",
    leaseId,
    snapshotId,
    elementId,
    threshold,
    diffScore,
    visualSignature: result.visualSignature,
    region: result.region,
  }, null, 2);
}
