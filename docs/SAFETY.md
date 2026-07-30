# Safety Model

Desktop Orchestrator provides programmable desktop control through Windows UI Automation (UIA) and Win32 interop.
It is designed as a **higher-speed alternative to Hana's native Computer Use**, operating with the same privilege level
but bypassing the framework's sequential app-approval flow for automation density.

## Core Design

- **Observation first, execution second**: every high-risk tool defaults to `dryRun: true` and returns a structured plan.
- **Multi-layer guards**: lease snapshots, element signatures, confirmation phrases, and audit trails must all pass before real execution.
- **Speed over ceremony**: UIA semantic targeting (element name/automationId) avoids pixel coordinates and vision model latency.
- **Real input is gated, not forbidden**: when all guards pass, UIA Invoke/SetValue executes directly — no simulated keyboard, no mouse movement.

## Tool Categories

### Read-Only Observation (always allowed)
- `list-windows`, `snapshot`, `ui-tree`, `find-control`, `inspect-window`, `plan-action`
- `self-check`, `protocol-test-matrix`, `fixture-sandbox`, `cockpit-summary`
- `region-preview`, `verify-action`, `visual-verify`

These never invoke UIA patterns, inject mouse/keyboard, or modify window state.

### Staged Execution (default dry-run)
- `click-element`: UIA InvokePattern (or TogglePattern / ExpandCollapsePattern fallback; last-resort mouse_event fallback)
- `type-element`: UIA ValuePattern.SetValue
- `focus-window`, `manage-window` (restore/maximize/minimize/move/resize/close)
- `mouse-click-at`, `mouse-drag`, `mouse-wheel`: raw Win32 mouse injection (fallback when UIA unavailable). These tools require an explicit `expectedWindow` target, persist an approval bundle before preview or input, reject overlay delivery failures, and re-check the hit window immediately before injection.

All staged tools require these common gates before real execution:

1. `dryRun: false`
2. Plugin config `allowRealInput: true`
3. Exact confirmation phrase: `I_UNDERSTAND_DESKTOP_INPUT`

UIA element actions additionally require:

4. Fresh lease-bound snapshot (from `ui-tree`)
5. Verified element signature (matched against snapshot)
6. Post-action verification request available
7. Audit event recording

Raw coordinate mouse actions additionally require an explicit `expectedWindow`. A missing target is rejected with `no-expected-target`; these actions use the hit-window guard instead of lease-bound element signatures. Their approval bundle records `requiresFreshLease: false` and `requiresSignatureGuard: false`, then enforces overlay delivery and a final hit-window re-check immediately before Win32 input.

### Vision-Assisted (network-dependent)
- `vision-query`: sends screenshot to configured vision API; returns pixel coordinates or SoM selection
- `vision-click`: screenshots region → vision AI locates target → mouse click at coordinates

Vision tools respect the same staged-execution gates and add network-call latency.

## How Real Input Works (the guard chain)

```
user calls tool               dryRun: true ──→ returns plan + cursor overlay
                                        │
                                   dryRun: false
                                        │
                              approve via phrase + config
                                        │
                             load lease snapshot (ui-tree result)
                                        │
                           compare element signature against snapshot
                                        │
                              signatures match? ──NO──→ block, plan-only
                                        │
                                       YES
                                        │
                            execute UIA Invoke / SetValue

Raw mouse path: persist approval bundle → preview overlay → final window guard re-check → persist final guard evidence → Win32 input
                                        │
                             record audit event (hash-chained)
                                        │
                             auto-extend lease TTL (10 more minutes)
```

## What the Guard Chain Does NOT Do

- It does **not** ask Hana's native application reviewer for each tool call.
- It does **not** prove human intent (the confirmation phrase is a fixed string visible in source code and tool parameters).
- It does **not** sign audit events with a trusted key (SHA-256 hashes are for corruption detection only).
- It does **not** sandbox the helper executables (they run under the Hana process identity).

These are intentional design choices for a **replacement-level automation tool**, not gaps to be filled. Users who need
native Hana guardrails should use Hana Computer Use instead.

## Native Executable Verification

The plugin ships precompiled native binaries:

| File | Source | Build |
|------|--------|-------|
| `helper/desktop-helper.exe` | `helper/desktop-helper.cs` | `dotnet publish -c Release` (.NET 8) |
| `helper/desktop-uia-helper.exe` | `helper/desktop-uia-helper.cs` | `helper/compile-uia-helper.bat` (.NET Framework 4.8 csc) |
| `helper/HanaWin32.dll` | `helper/HanaWin32.cs` | Compiled inline via Add-Type in PowerShell |

To reproduce any binary: run the corresponding build command from the `helper/` directory.
Binaries are not Authenticode-signed. Verify against source by rebuilding locally.

## Known Gaps

- The approval token store writes to the shared user temp directory. A malicious process with the same user identity could forge audit events.
- `WM_CLOSE` for window close is a cooperative shutdown; applications may prompt "save changes?" and require user interaction to dismiss.
- UIA `SetValue` on password fields or read-only controls will fail gracefully but the error may leak field type information.

## Windows API & UIA References Used

- `user32.dll`: `SetCursorPos`, `mouse_event`, `ShowWindow`, `SetWindowPos`, `GetWindowText`, `EnumWindows`, `EnumChildWindows`, `GetForegroundWindow`, `BringWindowToTop`, `ClientToScreen`, `PrintWindow`
- `System.Windows.Automation`: `AutomationElement`, `InvokePattern`, `ValuePattern`, `TogglePattern`, `ExpandCollapsePattern`, `PropertyCondition`
- `System.Drawing`: `Bitmap`, `Graphics.CopyFromScreen`
