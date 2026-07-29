// click-guard.js — MODE 2 pre-injection safety check.
//
// WHY THIS EXISTS:
// mouse-click-at / mouse-drag are BLIND: they push the system cursor to a raw
// physical coordinate and press. The coordinate is usually picked from an earlier
// ui-tree / screenshot snapshot. Between "pick coordinate" and "press", the
// foreground window can change (the user clicks elsewhere, a popup steals focus,
// the agent's own window stays on top). If that happens, the blind click lands on
// whatever window now sits under that pixel — NOT the intended target.
//
// Real-world failure this guards against (observed 2026-06-08): clicking the
// Settings "个性化" nav item at (234,483) while the agent's own HanaAgent window
// was still foreground — the click hit HanaAgent, not Settings, and dismissed the
// target.
//
// HOW:
// We resolve, in a SINGLE DPI-aware PowerShell pass (physical pixels, matching UIA
// element coords and SetCursorPos), the window that actually sits UNDER the click
// point via WindowFromPoint (honours Z-order / occlusion), plus the current
// foreground window. The caller can then assert the hit window matches the intended
// target before any real injection.
//
// This is OBSERVE-ONLY. It never moves the cursor, clicks, types, or focuses.

import { spawnSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HANA_WIN32_DLL = path.resolve(__dirname, "..", "helper", "HanaWin32.dll");

const PROBE_BLOCK = `
Add-Type -Path "${HANA_WIN32_DLL.replace(/"/g, '`"')}"
# Per-monitor aware V2 = -4. MUST run before any geometry read so WindowFromPoint /
# GetWindowRect return PHYSICAL pixels, matching the click coordinate space.
try { [HanaClickGuard]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch {}

function Get-WinInfo([IntPtr]$h) {
  if ($h -eq [IntPtr]::Zero) { return $null }
  $len = [HanaClickGuard]::GetWindowTextLength($h)
  $sb = New-Object System.Text.StringBuilder ($len + 1)
  [HanaClickGuard]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
  $pid = 0
  [HanaClickGuard]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null
  $name = $null
  try { $name = (Get-Process -Id $pid -ErrorAction Stop).ProcessName } catch {}
  $r = New-Object HanaClickGuard+RECT
  [HanaClickGuard]::GetWindowRect($h, [ref]$r) | Out-Null
  return @{
    handle = "" + $h.ToInt64()
    title = $sb.ToString()
    processId = [int]$pid
    processName = $name
    bounds = @{ left = $r.Left; top = $r.Top; right = $r.Right; bottom = $r.Bottom }
  }
}
`;

function runProbe(scriptBody, timeoutMs = 12000) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const psFile = path.join(os.tmpdir(), `hana-clickguard-${stamp}.ps1`);
  try {
    fs.writeFileSync(psFile, `\uFEFF${scriptBody}`, "utf-8");
    const res = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", psFile],
      { encoding: "utf-8", timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
    );
    if (res.error) return { ok: false, error: res.error.message };
    const out = (res.stdout || "").trim();
    try {
      return { ok: true, data: JSON.parse(out) };
    } catch {
      return { ok: false, error: `parse-failed: ${out.slice(0, 200)}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try { if (fs.existsSync(psFile)) fs.unlinkSync(psFile); } catch {}
  }
}

// Resolve, in physical pixels, the top-level window under (x,y) and the current
// foreground window. Returns { ok, hitWindow, foregroundWindow, error }.
export function probeClickPoint({ x, y }) {
  const px = Math.round(Number(x));
  const py = Math.round(Number(y));
  const body = `
${PROBE_BLOCK}
$pt = New-Object HanaClickGuard+POINT
$pt.X = ${px}
$pt.Y = ${py}
$leaf = [HanaClickGuard]::WindowFromPoint($pt)
# GA_ROOT = 2: walk up to the top-level owner window so we compare against the
# same handle list-windows / ui-tree report, not an inner child control.
$root = if ($leaf -ne [IntPtr]::Zero) { [HanaClickGuard]::GetAncestor($leaf, 2) } else { [IntPtr]::Zero }
$fg = [HanaClickGuard]::GetForegroundWindow()
$result = @{
  point = @{ x = ${px}; y = ${py} }
  hitWindow = (Get-WinInfo $root)
  foregroundWindow = (Get-WinInfo $fg)
}
$result | ConvertTo-Json -Depth 6 -Compress
`;
  const res = runProbe(body);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, ...res.data };
}

// Decide whether a blind click at (x,y) is safe to deliver.
// expected: optional { handle?, processName?, processId? } describing the intended
//   target window. When provided, the hit window under the point must match.
// Returns { allowed, reason, hitWindow, foregroundWindow, checks }.
export function evaluateClickSafety({ x, y, expected = null } = {}) {
  const probe = probeClickPoint({ x, y });
  const checks = [];
  if (!probe.ok) {
    return {
      allowed: false,
      reason: `click-guard-probe-failed: ${probe.error}`,
      hitWindow: null,
      foregroundWindow: null,
      checks,
    };
  }

  const hit = probe.hitWindow || null;
  const fg = probe.foregroundWindow || null;

  const hitExists = Boolean(hit && hit.handle);
  checks.push({ name: "point-hits-a-window", passed: hitExists, hitHandle: hit?.handle || null });

  let matchesExpected = true;
  if (expected && hitExists) {
    matchesExpected = false;
    if (expected.handle && String(expected.handle) === String(hit.handle)) matchesExpected = true;
    else if (expected.processId && Number(expected.processId) === Number(hit.processId)) matchesExpected = true;
    else if (expected.processName && hit.processName && expected.processName.toLowerCase() === hit.processName.toLowerCase()) matchesExpected = true;
    checks.push({
      name: "hit-window-matches-expected-target",
      passed: matchesExpected,
      expected,
      actual: { handle: hit.handle, processId: hit.processId, processName: hit.processName },
    });
  }

  // When no explicit expected target is given we still surface a soft warning if the
  // window under the point is the agent's own host (clicking ourselves is almost
  // always a focus-drift bug, not intent).
  const hitIsSelf = hitExists && /HanaAgent|electron/i.test(`${hit.processName || ""} ${hit.title || ""}`);
  checks.push({ name: "hit-window-not-agent-self", passed: !hitIsSelf, hitProcess: hit?.processName || null });

  const allowed = hitExists && matchesExpected;
  let reason = "click-target-verified";
  if (!hitExists) reason = "no-window-under-point";
  else if (!matchesExpected) reason = "hit-window-differs-from-expected-target";
  else if (hitIsSelf && !expected) reason = "warning-hit-agent-self-but-allowed";

  return { allowed, reason, hitWindow: hit, foregroundWindow: fg, checks };
}
