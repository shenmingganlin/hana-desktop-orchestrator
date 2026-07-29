export const JSON_RESULT_PREAMBLE = `
function Write-JsonResult($value) {
  $json = $value | ConvertTo-Json -Depth 8 -Compress
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $json
}
`;

export const DPI_SNIPPET = `
$hanaHdc = [HanaDpiApi]::GetDC([IntPtr]::Zero)
$hanaDpiX = [HanaDpiApi]::GetDeviceCaps($hanaHdc, 88)
$hanaDpiY = [HanaDpiApi]::GetDeviceCaps($hanaHdc, 90)
$hanaScaleX = [math]::Round($hanaDpiX / 96.0, 4)
$hanaScaleY = [math]::Round($hanaDpiY / 96.0, 4)
[HanaDpiApi]::ReleaseDC([IntPtr]::Zero, $hanaHdc) | Out-Null
`;

export const WINDOW_API_SNIPPET = `
`;

// Window-management Win32 surface: ShowWindow (state), SetWindowPos (move/resize),
// PostMessage (graceful WM_CLOSE), IsZoomed/IsIconic (state readback). Coexists
// with HanaWindowApi (different class name). All geometry is PHYSICAL pixels
// because callers run under PerMonitorV2 DPI awareness (DPI_AWARE_SNIPPET).
export const WINDOW_MANAGE_SNIPPET = `
`;

export const MOUSE_API_SNIPPET = `
`;

export function escapePowerShellSingleQuoted(value) {
  return String(value ?? "").replace(/'/g, "''");
}

// Makes the current PowerShell process DPI-aware (PerMonitorV2) BEFORE any
// screen measurement or capture. Without this, a DPI-unaware process gets
// virtualized: GetSystemMetrics returns logical pixels (e.g. 1707x1067) while
// the real screen is physical (e.g. 2560x1600 at 150%), so a logical-sized
// bitmap captures only the top-left ~66%. Must run before reading screen
// bounds. Use Win32 GetSystemMetrics (reflects DPI awareness immediately),
// NOT .NET SystemInformation/Screen (cached at pre-awareness logical values).
export const DPI_AWARE_SNIPPET = `
$hanaDpiAwareSet = $false
try {
  # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
  if ([HanaDpiAware]::SetProcessDpiAwarenessContext([IntPtr]-4)) { $hanaDpiAwareSet = $true }
} catch {}
if (-not $hanaDpiAwareSet) {
  try { [HanaDpiAware]::SetProcessDpiAwareness(2) | Out-Null; $hanaDpiAwareSet = $true } catch {}
}
if (-not $hanaDpiAwareSet) {
  try { [HanaDpiAware]::SetProcessDPIAware() | Out-Null } catch {}
}
# Physical virtual-screen geometry via Win32 (SM_*VIRTUALSCREEN = 76/77/78/79).
$hanaPhysLeft = [HanaDpiAware]::GetSystemMetrics(76)
$hanaPhysTop = [HanaDpiAware]::GetSystemMetrics(77)
$hanaPhysWidth = [HanaDpiAware]::GetSystemMetrics(78)
$hanaPhysHeight = [HanaDpiAware]::GetSystemMetrics(79)
`;
