# Changelog

## 0.3.0-alpha.1 - 2026-07-30

### Added

- Added a shared action-risk classifier with `observe`, `common`, `sensitive`, and `destructive` categories.
- Added `safe`, `auto-review`, and `full-access` permission policy decisions with destructive actions always requiring explicit confirmation.
- Added the `permissionMode` configuration option; `allowRealInput` remains disabled by default.
- Wired permission decisions into the existing real-action tools without changing the formal installed `0.2.5` runtime.
- Added a pure in-memory permission policy matrix to the regression suite.

### Limitations

- This alpha does not yet implement control sessions, action batches, keyboard fallback execution, or remote command envelopes.
- Existing lease, signature, window guard, approval bundle, and dry-run behavior remains in place.

## 0.2.5 - 2026-07-30

### Fixed

- Raw mouse tools now report `blocked: true` whenever approval is denied, and click-guard process metadata uses the actual target process instead of PowerShell's built-in `$PID` value.
- `region-preview` and `visual-verify` now use the precompiled DPI-awareness API instead of an inline PowerShell C# type that the script runner strips before execution.

## 0.2.4 - 2026-07-30

### Fixed

- Approval tokens now bind to the current live approval bundle through `approvalBundleHash` / `bundleHash`; missing, stale, changed, or mismatched bundles are blocked by preflight and covered by fixture regression cases.
- Legacy bundles without `bundleHash`, bundles with a tampered or internally inconsistent digest, and unsupported protocol versions remain displayable but are blocked as approval evidence until regenerated; version 2 tokens without `approvalBundleHash` and invalid bundles are rejected before storage.
- `click-element` and `type-element` now persist and verify the approval bundle before any real UIA or fallback mouse action; save failures are surfaced and block execution.
- Raw `mouse-click-at`, `mouse-drag`, and `mouse-wheel` actions now require `expectedWindow`, persist approval evidence before preview/input, reject failed overlays, and re-check the hit window immediately before injection.
- The confirmation phrase is now unconditional for real input; the `skipConfirmationPhrase` configuration escape hatch was removed.

## 0.2.3 - 2026-07-29

### Added

- `docs/SAFETY.md` aligned with the current `vision-query` directory whitelist behavior.
- Git repository hygiene: added `.gitignore` for generated build artifacts and helper build outputs.
- `skipGuard` compatibility audit confirmed the deprecated parameter is still intentionally retained as a public compatibility surface.

### Changed

- `routes/widget.js` localized the review cockpit sidebar copy to Chinese while keeping protocol labels intact.
- Removed dead locals and stale helper builders from `click-element.js`, `type-element.js`, and `verify-action.js`.

### Fixed

- `fixture-sandbox` signature-mismatch fixture now blocks correctly and is covered by `final-regression`.
- `final-regression` now includes `fixture-sandbox` so the final gate no longer misses the pure in-memory safety fixture.

## 0.2.2 - 2026-07-29

### Added

- `snapshot-window`: PrintWindow 窗口截图命令，支持 `--format png|jpeg`（用于 vision-click 场景）。
- `snapshot-full --format jpeg`：截图可保存为 JPEG quality 85，2560×1600 约 450KB vs PNG 3.5MB（缩 87%）。
- `mouse-drag` / `mouse-wheel` 搬到 `helper.exe`，降级到 PowerShell。
- 插件配置项全部改为中文，去重，增加 PNG/JPEG 格式对比说明。

### Changed

- `snapshot.js`：`includeScreenshot=true` 时三次 helper 调用（snapshot + list-windows + dpi）合并为一次 `snapshot-full` 调用，省约 28% 耗时。
- `lib/mouse-inject.js`：`mouseDrag` 和 `mouseWheel` 优先走 helper.exe，失败降级到 PS。
- `manifest.json`：删除 visionApiBase/visionApiKey/visionModel 重复定义（9 项 → 6 项），全中文标题和描述。
- `desktop-remote-operator` 技能：改为直接调 desktop-orchestrator 工具，不再经过 subagent 派 hanako。
- 通信员 `ishiki.md`：移除 subagent 中转流程，改为直接调用插件工具。

### Performance

- `snapshot` with screenshot: 三次调用 ~380ms → 一次调用 ~275ms（-28%）。

## 0.2.1 - 2026-07-29

### Added

- `manage-window` with `move` / `resize` / `minimize` / `maximize` / `restore` / `close`. Restore uses `SW_RESTORE + SetForegroundWindow` (more reliable than the UIA-only path).
- `mouse-click-at`, `mouse-drag`, `mouse-wheel` for raw mode 2 input with pre-injection hit-window guard and live cursor-flight preview.
- `vision-query` and `vision-click` for vision-model-driven element location on GPU-rendered apps that UIA cannot see into.
- `tray.js` library for system tray icon enumeration (kept for future use; `manage-window restore` covers the most common case).
- `persistent-ps.js` framework for long-running PowerShell sessions (kept for future use; in-process DLL warm-up is the current performance path).
- `HanaWin32.dll` precompiled Win32 P/Invoke surface. Replaces all runtime `Add-Type @"..."@` blocks in PowerShell snippets — the root cause of spawnSync timeout.
- `desktop-helper.exe`: compiled .NET 8 helper, replaces PowerShell for snapshot, list-windows, focus-window, manage-window, mouse-click-at, and DPI queries (2-10x faster).
- `desktop-uia-helper.exe`: compiled .NET Framework 4.8 helper, replaces PowerShell for UI Automation tree enumeration, element click (InvokePattern), and text entry (ValuePattern) (3-5x faster).
- `docs/REPRODUCIBLE_BUILD.md`: guide to rebuild all native binaries from source.
- Auto-extend lease TTL on successful invoke/write, so continuous operations on the same window don't need repeated `ui-tree` calls.
- UIA helper warm-up during plugin activation (pre-loads .NET Framework and UIA DLLs into OS cache).

### Changed

- **SAFETY.md rewritten** to match the plugin's real capability: full desktop control via UIA Invoke/SetValue, Win32 mouse injection, and native helper processes. Documents guard chain, known gaps, and native binary verification.
- **README.md**: full-access requirement now lists all capabilities (UIA APIs, Win32 interop, native processes, widget surfaces) instead of claiming it is only for the widget.
- **vision-query**: \`imagePath\` now restricted to \`%TEMP%/hana-desktop-orchestrator\` directory to prevent arbitrary file exfiltration.

### Fixed

- PowerShell heredoc compiler bug in \`vision-click.js\` triggered when the conditional \`usePrint\` flag was false. The "@ terminator leaked into the script. Moved PrintWindow into the precompiled DLL and switched the call site to \`[HanaPrintWindow]::PrintWindow\`.
- \`vision-query\` prompt now distinguishes location questions from classification / multi-choice questions, and only enforces \`[x, y]\` output for the former. Pure number or text answers are preserved in \`result.text\` instead of being misparsed as coordinates.
- \`vision-query\` regex parser no longer greedily matches the first \`(\d+,\d+)\` inside an arbitrary response text. Only strict \`[x, y]\` / \`(x, y)\` brackets match.
- \`ui-tree.js\`: removed reference to non-existent \`getForegroundWindowHwnd\` export.

### Performance

| Tool | Before (PowerShell) | After (native helper) | Speed-up |
|------|--------------------|----------------------|----------|
| snapshot | 300-500ms | ~70-220ms | 2-4x |
| list-windows | 300-400ms | ~70ms | 4-6x |
| focus-window | 300ms | ~70ms | 4x |
| manage-window | 300-400ms | ~60-250ms | 2-5x |
| mouse-click-at | 200ms | ~50ms | 4x |
| ui-tree | 400-600ms | ~100ms (helper) + ~100ms (JS) | 2-4x |
| click-element | 300-500ms | ~100ms | 3-5x |
| type-element | 300-500ms | ~100ms | 3-5x |

### Known Bugs

See \`README.md#known-bugs-and-limits\` for the full list.

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
