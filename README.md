# Desktop Orchestrator

Desktop Orchestrator is a guarded Windows desktop control platform for HanaAgent.

It is designed as a stronger alternative to simple mouse/keyboard plugins: it separates observation, targeting, planning, approval, execution preflight, and verification so desktop control can become powerful without becoming reckless.

## Requirements

- Windows 10 / 11 (PowerShell 5.1 built-in; PowerShell 7 recommended for non-ASCII paths)
- Node.js 18+
- HanaAgent with full-access enabled (the plugin needs it for UIA APIs, Win32 interop, native helper processes, and widget surfaces)
- For `vision-query` / `vision-click`: a vision-capable LLM API (Anthropic-format or OpenAI-format). Defaults to MiniMax Anthropic. See configuration below.

## Install

1. Drop the `desktop-orchestrator` folder into your HanaAgent plugins directory (default `~/.hanako/plugins/`).
2. Restart HanaAgent so the plugin loader scans and registers the tool list.
3. Open the plugin settings page and fill in the vision API fields if you want vision tools.

The plugin directory must contain `manifest.json`, `index.js`, and the `tools/`, `lib/`, `routes/`, `helper/` folders. Source `desktop-orchestrator-v0.2.1-完整版.zip` is a redistributable bundle; the development repo is this folder.

## Configuration

Plugin config (stored in `%APPDATA%/hana-desktop-orchestrator/config.json` or the plugin-data folder):

| Key | Description | Default |
| --- | --- | --- |
| `allowRealInput` | Master switch for real mouse/keyboard actions. It must be explicitly enabled before any mode can execute desktop input. | `false` |
| `permissionMode` | `safe` asks for every real action; `auto-review` allows common actions and asks for sensitive ones; `full-access` allows non-destructive actions and still asks before destructive actions. | `safe` |
| `defaultSnapshotFormat` | Screenshot encoding. | `png` |
| `allowKeyboardInput` | Enables the keyboard fallback only after UIA focus succeeds and the target window remains foreground. | `false` |
| `allowClipboardInput` | Enables the clipboard fallback for plain-text clipboard state only; rich or binary clipboard state is rejected. | `false` |
| `maxWindowResults` | How many windows `list-windows` returns. | `40` |
| `visionApiBase` | Vision API base URL (Anthropic-format like `https://api.minimaxi.com/anthropic` or OpenAI-format). | empty |
| `visionApiKey` | Vision API key. | empty |
| `visionModel` | Vision model id, e.g. `MiniMax-M3`, `claude-3-5-sonnet-20241022`, `gpt-4o`. | empty |

Without a vision config, `vision-query` and `vision-click` return a clear error explaining how to set it.

### Permission modes (0.3.0-alpha.1)

The first permission-policy slice adds a shared decision kernel without changing the default safety boundary:

- `safe`: read-only actions are allowed; real actions require the exact confirmation phrase.
- `auto-review`: common actions may run after `allowRealInput` is enabled; sensitive and destructive actions require confirmation.
- `full-access`: common and sensitive actions may run after `allowRealInput` is enabled; destructive actions still require confirmation.

All modes remain subject to the existing lease, element-signature, window-guard, approval-bundle, and post-action verification paths. `allowRealInput`, `allowKeyboardInput`, and `allowClipboardInput` remain `false` by default. This alpha also adds opt-in local control sessions with explicit scope, TTL, action limits, revocation, and hash integrity checks. Action batches and remote command envelopes remain follow-up work.

## Safety

High-risk tools default to dry-run. Real input first requires:

1. `dryRun: false` in the tool input.
2. `allowRealInput: true` in the plugin config.
3. The configured `permissionMode` decision.
4. When `sessionId` is supplied, a valid control session whose scope matches the action and target.

In `safe`, the exact confirmation phrase `I_UNDERSTAND_DESKTOP_INPUT` is required for every real action. In `auto-review` and `full-access`, the shared policy can allow common or sensitive actions automatically, while destructive actions still require the phrase. Any missing gate returns a dry-run envelope without touching the system. The plugin keeps an append-only local audit timeline at `%TEMP%/hana-desktop-orchestrator/audit-timeline.json`. Control sessions are stored separately at `%TEMP%/hana-desktop-orchestrator/control-session-store.json`; session creation and revocation require `I_UNDERSTAND_DESKTOP_INPUT` and never execute desktop input.

## Known Bugs and Limits

These are real issues found during development and stress testing. PRs welcome.

- **MiniMax vision-query coordinate regression is unreliable.** Direct "give me the pixel coordinates of X" questions return coordinates with ~100px+ error even when the target is large and obvious. M3 is better than M2 at SoM-style multi-choice questions but still loses to a human pixel estimate.
- **Hana framework caches the tool list at install time.** New `tools/*.js` files added after the first plugin load are NOT auto-registered; you must reinstall the plugin (drag the folder back into Hana's install surface) for new tools to appear.
- **`focus-window` returns `ok: false` for some Electron/WebView2 windows** because UIPI prevents non-foreground thread input attach. `manage-window restore` with the `SW_RESTORE+Foreground` detail path is a more reliable fallback.
- **PowerShell 5.1 multi-line here-string compilation sometimes fails** when inlined through JavaScript template literals that contain conditional heredoc headers. We removed all such patterns in this release; if you add new tools, prefer `HanaWin32.dll` for any new Win32 bindings.
- **Some Electron apps (Tabbit, Chrome) hide page content behind GPU `Intermediate D3D Window`** so UIA only sees the browser chrome. Vision is the only path to interact with page internals.

## Design Position

This project is not a clone of HanaAgent's experimental Computer Use and not a thin wrapper around raw mouse clicks.

It aims to provide:

1. desktop state snapshots
2. target-window oriented control
3. UIA-first semantic actions
4. lease-bound stale-target protection
5. explicit dry-run planning before dangerous actions
6. permission-mode and review-cockpit decisions before real-input execution
7. post-action and visual verification hooks
8. local audit evidence export

## Current Tool Set

| Tool | Purpose | Risk |
| --- | --- | --- |
| `desktop-orchestrator_snapshot` | Capture screen/window state and optionally a screenshot | Low |
| `desktop-orchestrator_list-windows` | List visible top-level windows | Low |
| `desktop-orchestrator_focus-window` | Bring a selected window to foreground | Medium |
| `desktop-orchestrator_find-control` | Find matching UIA controls in a target window and return the best candidates | Low |
| `desktop-orchestrator_inspect-window` | Summarize a target window into actionable controls, inputs, navigation, status text, and observation suggestions | Low |
| `desktop-orchestrator_plan-action` | Convert intent into a guarded action plan | Low |
| `desktop-orchestrator_protected-click` | Perform or dry-run a guarded click | High |
| `desktop-orchestrator_ui-tree` | Read window-scoped UIA element summaries and create a short-lived lease | Low |
| `desktop-orchestrator_click-element` | Dry-run or invoke a UIA element click after lease/signature verification | High |
| `desktop-orchestrator_type-element` | Dry-run or set text through UIA ValuePattern; keyboard/clipboard fallback requires separate config gates, UIA focus, foreground verification, and optional session capability | High |
| `desktop-orchestrator_verify-action` | Re-read a lease-bound UIA element and verify its signature | Low |
| `desktop-orchestrator_visual-verify` | Capture an element region in memory and compare visual signatures | Low |
| `desktop-orchestrator_region-preview` | Capture a lease-bound element crop as a PNG preview | Low |
| `desktop-orchestrator_self-check` | Read local protocol stores and summarize safety gate health | Low |
| `desktop-orchestrator_protocol-test-matrix` | Exercise non-destructive token rejection and dry-run gate cases | Low |
| `desktop-orchestrator_fixture-sandbox` | Run pure in-memory protocol fixtures for pass/block scenarios | Low |
| `desktop-orchestrator_cockpit-summary` | Aggregate self-check, protocol matrix, and fixture sandbox status | Low |
| `desktop-orchestrator_manage-window` | Move / resize / minimize / maximize / restore / close a window. Uses `SW_RESTORE+Foreground` for reliable restore. | Medium |
| `desktop-orchestrator_mouse-click-at` | Mode 2: real `SetCursorPos` + `mouse_event` with pre-injection guard (verifies target window at click point). | High |
| `desktop-orchestrator_mouse-drag` | Real mouse drag from start to end coordinates with guard. | High |
| `desktop-orchestrator_mouse-wheel` | Real mouse wheel at coordinates. | High |
| `desktop-orchestrator_vision-query` | Send a screenshot to the configured vision API and return coordinates / text answer. | Low (read-only) |
| `desktop-orchestrator_vision-click` | PrintWindow + visual analysis + return click plan with `coordinateContract`. | Medium |
| `desktop-orchestrator_create-control-session` | Create a scoped, expiring local control session after explicit confirmation. | High |
| `desktop-orchestrator_inspect-control-session` | Inspect a local control session without executing desktop input. | Low |
| `desktop-orchestrator_revoke-control-session` | Revoke a local control session after explicit confirmation. | High |

`find-control` is the first higher-level read tool built on top of `ui-tree`: callers can ask for a button, input box, list item, AutomationId, class name, or supported pattern without manually scanning the full UIA tree.

`inspect-window` adds a window-level read summary: it groups visible UIA elements into action controls, input controls, navigation candidates, and status/error text candidates, then suggests the next safe observation or dry-run planning step.

High-risk tools default to dry-run. Real input remains blocked unless the applicable gates pass: `dryRun: false`, plugin config `allowRealInput: true`, permission policy, and for session-bound actions a valid scoped session. `safe` actions still require the exact confirmation phrase `I_UNDERSTAND_DESKTOP_INPUT`; session creation and revocation always require it.

## Review Cockpit

The widget at `/api/plugins/desktop-orchestrator/widget` is a review cockpit, not an execution panel.

It supports:

- recent approval bundle loading
- cursor overlay simulation
- guarded region-preview image proxy
- approval checklist state machine
- non-executable local approval tokens
- execution preflight
- final dry-run envelope
- self-check
- protocol test matrix
- fixture sandbox
- cockpit summary dashboard
- audit timeline display
- audit evidence JSON export with hash-chain verification

The widget uses \`full-access\` because the plugin operates at the same system-privilege level as Hana's native Computer Use. Full-access is required for:
- UIA InvokePattern (click-element), ValuePattern.SetValue, and explicitly gated text fallbacks (type-element)
- Keyboard fallback sends Unicode input only after UIA SetFocus and foreground checks; clipboard fallback uses stdin transport and refuses rich clipboard state
- Real mouse click, drag, and wheel injection (mouse-click-at, mouse-drag, mouse-wheel)
- Window focus, move, resize, minimize, maximize, and close (focus-window, manage-window)
- Screen capture via PrintWindow / CopyFromScreen (snapshot, region-preview)
- Native helper process execution (desktop-helper.exe, desktop-uia-helper.exe)
- Widget review cockpit surface

All high-risk tools default to \`dryRun: true\` and require explicit confirmation plus signature verification before real execution. Text fallback input also requires the corresponding `allowKeyboardInput` or `allowClipboardInput` setting; these settings are independent of `allowRealInput`. Raw coordinate mouse tools additionally require `expectedWindow`, persist approval evidence before input, reject failed cursor previews, and re-check the hit window immediately before injection. See [\`docs/SAFETY.md\`](docs/SAFETY.md) for the full guard chain.

## Audit Evidence

Audit events are stored in `%TEMP%/hana-desktop-orchestrator/audit-timeline.json`.

New events include `previousHash` and `eventHash` so the local timeline can be verified as a hash chain. Older events without hashes are treated as legacy-compatible rather than corruption.

Audit evidence export is available through the widget API:

```text
POST /api/audit-evidence-export
```

The export writes a local JSON evidence package. It does not mutate approval state and does not execute desktop input.

## Known Dev-Tool Boundary

The audit export helper and widget API are stable, but standalone audit export tool wrappers were not registered by the current dev tool discovery path. Keeping export behind the widget API avoids destabilizing the registered tool list.

## Architecture

```text
Hana tool or widget API
  -> input schema
  -> safety policy
  -> lease/signature/audit helpers
  -> PowerShell bridge when observation is required
  -> Windows API / UI Automation
  -> structured result
```

Core modules:

- `lib/powershell.js`: hidden PowerShell runner with temp files
- `lib/safety.js`: common guards for high-risk actions
- `lib/windows.js`: shared Windows PowerShell snippets
- `lib/snapshot-store.js`: lease-bound snapshot store
- `lib/element-signature.js`: stale-target signatures
- `lib/approval-store.js`: recent approval bundle store
- `lib/approval-token-store.js`: non-executable token store with TTL/hash
- `lib/execution-preflight.js`: read-only preflight gate
- `lib/final-execution-envelope.js`: dry-run-only final envelope
- `lib/audit-timeline.js`: local audit timeline with hash-chain support
- `lib/audit-evidence-export.js`: local evidence package export
- `tools/*.js`: HanaAgent tool entry points
- `routes/widget.js`: review cockpit UI and API routes

## Safety Principle

The plugin should know what it is controlling before it controls it.

Raw coordinate input is allowed only as a guarded fallback, not as the primary interaction model. Real input remains intentionally unopened in the current implementation.
