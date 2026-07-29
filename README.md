# Desktop Orchestrator

Desktop Orchestrator is a guarded Windows desktop control platform for HanaAgent.

It is designed as a stronger alternative to simple mouse/keyboard plugins: it separates observation, targeting, planning, approval, execution preflight, and verification so desktop control can become powerful without becoming reckless.

## Design Position

This project is not a clone of HanaAgent's experimental Computer Use and not a thin wrapper around raw mouse clicks.

It aims to provide:

1. desktop state snapshots
2. target-window oriented control
3. UIA-first semantic actions
4. lease-bound stale-target protection
5. explicit dry-run planning before dangerous actions
6. review cockpit approval before any future real-input phase
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
| `desktop-orchestrator_type-element` | Dry-run or set text through UIA ValuePattern after lease/signature verification | High |
| `desktop-orchestrator_verify-action` | Re-read a lease-bound UIA element and verify its signature | Low |
| `desktop-orchestrator_visual-verify` | Capture an element region in memory and compare visual signatures | Low |
| `desktop-orchestrator_region-preview` | Capture a lease-bound element crop as a PNG preview | Low |
| `desktop-orchestrator_self-check` | Read local protocol stores and summarize safety gate health | Low |
| `desktop-orchestrator_protocol-test-matrix` | Exercise non-destructive token rejection and dry-run gate cases | Low |
| `desktop-orchestrator_fixture-sandbox` | Run pure in-memory protocol fixtures for pass/block scenarios | Low |
| `desktop-orchestrator_cockpit-summary` | Aggregate self-check, protocol matrix, and fixture sandbox status | Low |

`find-control` is the first higher-level read tool built on top of `ui-tree`: callers can ask for a button, input box, list item, AutomationId, class name, or supported pattern without manually scanning the full UIA tree.

`inspect-window` adds a window-level read summary: it groups visible UIA elements into action controls, input controls, navigation candidates, and status/error text candidates, then suggests the next safe observation or dry-run planning step.

High-risk tools default to dry-run. Real input remains blocked unless all future gates pass: `dryRun: false`, plugin config `allowRealInput: true`, and the exact confirmation phrase `I_UNDERSTAND_DESKTOP_INPUT`.

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

The widget uses `full-access` only because HanaAgent currently requires full-access to expose widget surfaces. This does not enable real desktop input.

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
