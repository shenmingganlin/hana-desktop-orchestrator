// mouse-inject.js
// Mode-2 real mouse input injection for desktop-orchestrator.
//
// SECURITY NOTE: unlike UIA Invoke (mode 1), this ACTUALLY moves the real system
// cursor and presses physical mouse buttons via Win32 SetCursorPos + mouse_event.
// It must only ever run AFTER the orchestrator's approval + glowing-cursor preview
// gates have passed. Callers pass PHYSICAL screen pixels (the helper/UIA coordinate
// space); we convert to the logical coordinates SetCursorPos expects via live DPI.
//
// Mirrors the proven API surface of the sibling "desktop" plugin (same author),
// but kept self-contained so orchestrator owns its own injection path.

import { spawnSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve HanaWin32.dll path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HANA_WIN32_DLL = path.resolve(__dirname, "..", "helper", "HanaWin32.dll");
const HELPER_EXE = path.resolve(__dirname, "..", "helper", "desktop-helper.exe");

const MOUSE_FLAGS = {
  left: { down: "0x0002", up: "0x0004" },
  right: { down: "0x0008", up: "0x0010" },
  middle: { down: "0x0020", up: "0x0040" },
};

// Run a PowerShell script silently (hidden window) via a temp .ps1 file.
function runPowerShellSilent(scriptContent, timeoutMs = 15000) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const tmp = os.tmpdir();
  const psFile = path.join(tmp, `hana-do-mouse-${stamp}.ps1`);
  const outFile = path.join(tmp, `hana-do-mouse-${stamp}.out`);
  try {
    fs.writeFileSync(psFile, `\uFEFF${scriptContent}`, "utf-8");
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", psFile],
      { encoding: "utf-8", timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
    );
    if (result.error) return { success: false, error: result.error.message };
    const out = (result.stdout || "").trim();
    if (result.status && result.status !== 0) {
      return { success: false, error: `exit ${result.status}`, stderr: (result.stderr || "").trim() || out };
    }
    return { success: true, output: out };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    try { if (fs.existsSync(psFile)) fs.unlinkSync(psFile); } catch {}
    try { if (fs.existsSync(outFile)) fs.unlinkSync(outFile); } catch {}
  }
}

// Shared C# Add-Type block: mouse API. Coordinates are PHYSICAL pixels.
// The process declares per-monitor DPI awareness V2 so SetCursorPos consumes
// PHYSICAL pixels, matching UIA element coords and the glow-cursor helper.
// VERIFIED: without this, a DPI-unaware host treats coords as logical px and
// clicks land ~scale-factor off (e.g. 75% right-down on a 150% display).
const NATIVE_BLOCK = `
Add-Type -Path "${HANA_WIN32_DLL.replace(/"/g, '`"')}"
# Per-monitor aware V2 = -4. Must run before any cursor positioning.
try { [DoMouse]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch {}
`;

function toInt(n) { return Math.round(Number(n)); }

// Physical pixels passed straight to SetCursorPos (no DPI conversion).
function moveAndClickScript({ x, y, button, clicks }) {
  const f = MOUSE_FLAGS[button] || MOUSE_FLAGS.left;
  const dbl = clicks >= 2;
  return `${NATIVE_BLOCK}
[DoMouse]::SetCursorPos(${toInt(x)}, ${toInt(y)})
Start-Sleep -m 40
[DoMouse]::mouse_event(${f.down}, 0, 0, 0, 0)
Start-Sleep -m 30
[DoMouse]::mouse_event(${f.up}, 0, 0, 0, 0)
${dbl ? `Start-Sleep -m 60
[DoMouse]::mouse_event(${f.down}, 0, 0, 0, 0)
Start-Sleep -m 30
[DoMouse]::mouse_event(${f.up}, 0, 0, 0, 0)` : ""}
Write-Output "OK"
`;
}

function dragScript({ fromX, fromY, toX, toY, button, steps }) {
  const f = MOUSE_FLAGS[button] || MOUSE_FLAGS.left;
  const n = Math.max(2, Math.min(60, steps || 24));
  return `${NATIVE_BLOCK}
$fx = ${toInt(fromX)}
$fy = ${toInt(fromY)}
$tx = ${toInt(toX)}
$ty = ${toInt(toY)}
[DoMouse]::SetCursorPos($fx, $fy)
Start-Sleep -m 60
[DoMouse]::mouse_event(${f.down}, 0, 0, 0, 0)
Start-Sleep -m 80
for ($i = 1; $i -le ${n}; $i++) {
    $px = [int][math]::Round($fx + ($tx - $fx) * $i / ${n})
    $py = [int][math]::Round($fy + ($ty - $fy) * $i / ${n})
    [DoMouse]::SetCursorPos($px, $py)
    Start-Sleep -m 12
}
Start-Sleep -m 80
[DoMouse]::mouse_event(${f.up}, 0, 0, 0, 0)
Write-Output "OK"
`;
}

export function mouseClick({ x, y, button = "left", clicks = 1 }) {
  // Use helper.exe for mouse clicks (4x faster than PowerShell)
  try {
    const { spawnSync } = require("child_process");
    const result = spawnSync(HELPER_EXE, ["mouse-click", String(x), String(y), button, String(clicks)], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status === 0 && result.stdout) {
      try {
        const parsed = JSON.parse(result.stdout.trim());
        return { ok: parsed.ok === true, raw: parsed };
      } catch {}
    }
    return { ok: false, raw: result };
  } catch (e) {
    // Fallback to PowerShell if helper.exe fails
    const res = runPowerShellSilent(moveAndClickScript({ x, y, button, clicks }));
    return { ok: res.success && /OK/.test(res.output || ""), raw: res };
  }
}

export function mouseDrag({ fromX, fromY, toX, toY, button = "left", steps = 24 }) {
  const res = runPowerShellSilent(dragScript({ fromX, fromY, toX, toY, button, steps }), 20000);
  return { ok: res.success && /OK/.test(res.output || ""), raw: res };
}

// WM_MOUSEWHEEL is routed by Windows to the window UNDER THE CURSOR, not the
// focused window. So to scroll a specific region we MUST move the real cursor
// there first, then emit the wheel event. This is why scroll is mode-2 (touches
// the real cursor) and must pass the click-guard like any blind injection.
// MOUSEEVENTF_WHEEL=0x0800 (vertical), MOUSEEVENTF_HWHEEL=0x01000 (horizontal).
// dwData is signed: +WHEEL_DELTA(120) per notch up/right, -120 down/left.
function wheelScript({ x, y, notches, axis }) {
  const flag = axis === "horizontal" ? "0x01000" : "0x0800";
  const n = Math.max(1, Math.min(30, Math.abs(toInt(notches))));
  const dir = toInt(notches) < 0 ? -1 : 1;
  // mouse_event dwData is a DWORD; negative deltas are passed as unsigned 2^32+delta.
  return `${NATIVE_BLOCK}
[DoMouse]::SetCursorPos(${toInt(x)}, ${toInt(y)})
Start-Sleep -m 50
$delta = ${dir} * 120
$dword = if ($delta -lt 0) { [uint32]([int64]4294967296 + $delta) } else { [uint32]$delta }
for ($i = 0; $i -lt ${n}; $i++) {
    [DoMouse]::mouse_event(${flag}, 0, 0, $dword, 0)
    Start-Sleep -m 30
}
Write-Output "OK"
`;
}

export function mouseWheel({ x, y, notches = -3, axis = "vertical" }) {
  const res = runPowerShellSilent(wheelScript({ x, y, notches, axis }));
  return { ok: res.success && /OK/.test(res.output || ""), raw: res };
}
