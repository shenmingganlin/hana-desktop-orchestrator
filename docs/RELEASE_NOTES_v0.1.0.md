# Desktop Orchestrator v0.1.0 Release Notes

## Summary

Desktop Orchestrator v0.1.0 is the first packaged local release candidate of a guarded Windows desktop-control foundation for HanaAgent.

This release focuses on observation, semantic targeting, dry-run action planning, human review, verification, audit evidence, and package hardening. It intentionally does not unlock real desktop input.

## Status

This version is validated as a stable local release candidate.

- Persistent plugin install has been verified under `C:\Users\Ganlin\.hanako\plugins\desktop-orchestrator`.
- HanaAgent restart recovery has been verified.
- The `Desktop Approval` widget reopened correctly after restart.
- The full review chain was manually confirmed green after restart.
- The packaged zip has passed package, smoke, and isolated install validation.
- No public release, git commit, or tag has been created yet.

## What This Release Provides

### Semantic Desktop Observation

- Window listing and desktop snapshot support.
- UI Automation tree inspection for semantic desktop controls.
- Safe fallback enumeration through raw UIA view and child HWND descendants.
- Optional `ui-tree.activateBeforeRead` support for Windows Settings, UWP, and WinUI surfaces whose full UIA subtree appears only after foreground activation.
- Higher-level `find-control` read tool for locating buttons, input boxes, list items, AutomationIds, class names, and supported UIA patterns without manually scanning the full tree.
- Higher-level `inspect-window` read tool for summarizing a target window into actionable controls, input controls, navigation candidates, status text candidates, and safe observation suggestions.
- Element signatures for stale-target detection.
- Lease-bound snapshot references using `leaseId`, `snapshotId`, and `elementId`.
- Button-level UIA dry-run acceptance on a standard Windows taskbar control.

### Guarded Action Planning

- Dry-run UIA element click planning.
- Dry-run UIA text-entry planning.
- Cursor overlay preview protocol for intended click locations.
- Two-phase target inspection before any high-risk action path.
- Strict stale guards for expired leases, missing snapshots, missing elements, and mismatched element signatures.

### Review Cockpit

- `Desktop Approval` widget exposed through HanaAgent's widget system.
- Narrow-sidebar-friendly layout for compact Hana panels.
- Recent approval bundle loading.
- Observation-only preview buttons.
- Region crop preview with guarded local image proxy.
- Checklist-driven review state with four required core checks: `bundle`, `target`, `overlay`, and `verification`.
- Optional visual evidence checks: `visual` and `region`.
- Non-executable local approval token generation.
- Execution preflight and final dry-run envelope.

### Verification And Evidence

- Post-action verification request model.
- Visual verification by average RGB grid signature.
- Multi-monitor and high-DPI-safe region capture using virtual-screen bounds and DPI-aware screenshot processes.
- Audit timeline with hash-chain support for new events.
- Local audit evidence JSON export through the widget API.

### Safety And Regression Tools

- Self-check tool.
- Protocol test matrix.
- Pure in-memory fixture sandbox.
- Cockpit summary dashboard.
- Package structure checker.
- Zip build script.
- Package smoke test.
- Isolated install smoke test.
- Final regression script.

## Validation Status

The release candidate has passed:

- `npm run check`: `50/50` package checks passed.
- `npm run final-regression`: `17/17` final regression steps passed.
- Package smoke: `40/40` checks passed.
- Isolated install smoke: `25/25` checks passed.
- Persistent HanaAgent restart recovery.
- Widget surface discovery at `/api/plugins/desktop-orchestrator/widget`.
- Manual widget review chain: `Generate token`, `Run preflight`, `Final envelope`, `Self-check`, and `Protocol matrix` all green.
- Consent-gated visual checks: `region-preview` and `visual-verify` passed after screen-region authorization.
- Windows Settings foreground observation: `ui-tree.activateBeforeRead: true` returned the Settings content subtree with `119` elements, including `CommandSearchTextBox` and WinUI navigation items.
- Control lookup smoke: `find-control` found the taskbar `显示隐藏的图标` button with `Invoke` support through a read-only query.
- Window inspection smoke: `inspect-window` summarized the taskbar into `31` UIA elements and `19` actionable controls without executing desktop input.

## Notable Fixes During Acceptance

- Fixed widget script leakage caused by a literal `</script>` inside an embedded JSON script block.
- Fixed widget API `403 missing_credential` failures by centralizing same-origin credentialed plugin API fetches.
- Fixed compact sidebar overflow for HanaAgent's narrow widget panel.
- Fixed approval token gating so visual and region evidence remain optional, while core safety checks remain required.
- Aligned backend preflight checklist semantics with the frontend approval checklist.
- Preserved strict stale-lease and stale-signature rejection behavior.
- Fixed multi-monitor and high-DPI visual capture where target regions could be incorrectly cropped to `1x1`.
- Added controlled foreground observation for Settings, UWP, and WinUI windows that do not expose full UIA content while backgrounded.
- Hardened `ui-tree.titleContains` resolution so a missing title returns `window-not-found` instead of falling back to the foreground window.
- Hardened UIA bounds serialization so oversized or invalid rectangle values no longer fail the entire `ui-tree` read with an `Int32` conversion error.
- Improved input-control ranking so strong input roles such as `Edit` outrank generic `Button + Value` controls in `inspect-window` and `find-control` results.
- Clarified Cockpit Summary warning copy: protocol-safe but incomplete live approval state now displays as `waiting` with a fresh-token/preflight hint instead of an alarming generic `warning` label.
- Added preflight display status (`passed` / `waiting` / `failed`) so stale leases or missing fresh approval state render as a safe waiting state instead of a red failure block.
- Bound widget preflight and final-envelope requests to the approval token record created by the current `Generate token` action, preventing stale or test token records from keeping the widget permanently in a waiting state.
- Added a widget snapshot-status precheck before token generation so expired or missing lease snapshots are caught before creating a token that can never pass preflight.
- Clarified preflight waiting headlines for missing lease snapshots and stale target elements.
- Fixed recent approval bundle/token selection so historical records with expired or missing snapshots are kept for audit but no longer treated as resumable live approval state.

## Safety Boundary

This release remains dry-run-only for desktop control.

The following are not enabled:

- Real mouse movement.
- Real mouse clicks.
- Real keyboard input.
- Clipboard-assisted typing.
- UIA Invoke execution.
- Focus switching as an execution side effect.
- Unattended desktop mutation.

`ui-tree.activateBeforeRead` is the only foreground-changing observation option in this release. It is opt-in, records `activatedBeforeRead: true`, and does not execute desktop input.

Approval tokens are local review evidence only. They are explicitly non-executable and do not grant permission to control the desktop.

The final execution envelope is also non-executable. It documents intended action gates and blockers, but it cannot execute real input.

Real input remains blocked unless all future gates are deliberately changed and separately authorized, including explicit `dryRun: false`, plugin configuration enabling real input, and the confirmation phrase `I_UNDERSTAND_DESKTOP_INPUT`.

## Known Warnings

A fresh environment without a live approval token may report warning status in:

- `self-check`
- `protocol-test-matrix`
- `cockpit-summary`

This is expected. It means the live approval chain is incomplete, not that the plugin failed to load.

Lease-bound snapshots and approval tokens are temporary. After restart or expiration, a fresh dry-run approval bundle should be generated instead of bypassing stale guards.

## Known Boundaries

- Real input readiness is future work.
- Any future real input path must require separate explicit authorization.
- Initial real execution, if ever enabled, should start with minimal UIA Invoke only.
- Raw mouse and keyboard automation should remain blocked until separately designed and reviewed.
- Windows Settings, UWP, and some WinUI surfaces may still expose incomplete UIA trees while backgrounded; use `ui-tree.activateBeforeRead: true` when foreground observation is acceptable.
- Electron/HanaAgent surfaces may expose only coarse `Pane` controls depending on app internals.
- Standalone audit evidence export tool wrappers are intentionally excluded; use the widget API export path.
- The project directory is not currently a git repository.

## Artifact

Expected package artifact:

`C:\Users\Ganlin\Desktop\OH-WorkSpace\hana-desktop-orchestrator\dist\desktop-orchestrator-0.1.0.zip`

Artifact details from final regression:

- Plugin id: `desktop-orchestrator`
- Version: `0.1.0`
- File count: `59`
- Package root shape: manifest at zip root

## Release State

This release note documents a validated local release candidate. Public publishing, git commit creation, and tag creation remain intentionally paused until explicitly requested.
