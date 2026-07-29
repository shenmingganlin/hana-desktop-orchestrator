# Changelog

## 0.2.1 - 2026-07-29

### Added

- `manage-window` with `move` / `resize` / `minimize` / `maximize` / `restore` / `close`. Restore uses `SW_RESTORE + SetForegroundWindow` (more reliable than the UIA-only path).
- `mouse-click-at`, `mouse-drag`, `mouse-wheel` for raw mode 2 input with pre-injection hit-window guard and live cursor-flight preview.
- `vision-query` and `vision-click` for vision-model-driven element location on GPU-rendered apps that UIA cannot see into.
- `tray.js` library for system tray icon enumeration (kept for future use; `manage-window restore` covers the most common case).
- `persistent-ps.js` framework for long-running PowerShell sessions (kept for future use; in-process DLL warm-up is the current performance path).
- `HanaWin32.dll` precompiled Win32 P/Invoke surface. Replaces all runtime `Add-Type @"..."@` blocks in PowerShell snippets — the root cause of spawnSync timeout.

### Fixed

- PowerShell heredoc compiler bug in `vision-click.js` triggered when the conditional `usePrint` flag was false. The `"@` terminator leaked into the script. Moved PrintWindow into the precompiled DLL and switched the call site to `[HanaPrintWindow]::PrintWindow`.
- `vision-query` prompt now distinguishes location questions from classification / multi-choice questions, and only enforces `[x, y]` output for the former. Pure number or text answers are preserved in `result.text` instead of being misparsed as coordinates.
- `vision-query` regex parser no longer greedily matches the first `(\d+,\d+)` inside an arbitrary response text. Only strict `[x, y]` / `(x, y)` brackets match.

### Known Bugs

See `README.md#known-bugs-and-limits` for the full list.

## 0.1.0 - 2026-06-07

### Added

- Added Windows-first desktop observation tools for snapshots, window listing, and UIA semantic tree inspection.
- Added lease-bound snapshot workflow with expiring `leaseId`, `snapshotId`, and `elementId` targeting.
- Added stale element protection using stable UIA element signatures.
- Added dry-run click and text-entry planning for UIA elements.
- Added post-action verification, visual verification, and region crop preview support.
- Added approval bundle protocol for human review of intended high-risk actions.
- Added Desktop Approval widget with recent bundle loading, cursor overlay preview, crop compositing, checklist review, non-executable approval tokens, preflight, final dry-run envelope, cockpit summary, audit timeline, and audit evidence export.
- Added approval token store with TTL and SHA-256 hash validation.
- Added audit timeline hash-chain support and local evidence export.
- Added self-check, protocol test matrix, fixture sandbox, and cockpit summary safety tools.
- Added package hardening scripts: `check`, `build:package`, `smoke:package`, and `install-smoke:package`.

### Safety

- Real desktop input remains disabled by default.
- Approval tokens are review evidence only and are explicitly non-executable.
- Final execution envelopes are dry-run-only and cannot execute desktop actions.
- Widget full-access is used for Hana widget surface exposure, not for enabling real input.
- No real mouse movement, keyboard input, clipboard typing, UIA Invoke, focus switching, or desktop mutation is part of this release.

### Validation

- Package structure check passes.
- Zip build passes.
- Package smoke test passes.
- Isolated install smoke test passes.
- Hana dev-slot loading smoke test passes.
- Core safe tools are registered and callable in Hana.

### Known Boundaries

- This release is a safe review cockpit and control protocol foundation, not an unlocked desktop executor.
- Live preflight reports warning status when no current approval token exists.
- Standalone audit evidence export tool wrappers are intentionally not included; the stable export path is the widget API.
- Real input readiness remains future work and must require a separate explicit approval phase.
