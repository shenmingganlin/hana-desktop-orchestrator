# Approval Widget / Review Cockpit

The approval widget at `routes/widget.js` is now a review cockpit. It is designed for evidence gathering, dry-run inspection, and safety gate visualization.

It does not execute real desktop input.

## Platform Constraint

HanaAgent currently requires `full-access` for `contributes.widget`.

Desktop Orchestrator is loaded with full-access in the dev slot only so the widget surface can be exposed. This is not permission to execute mouse or keyboard input.

## Main Capabilities

The cockpit supports:

- recent approval bundle auto-load through `GET /api/recent`
- approval bundle parser
- normalized action/risk/status summary
- target metadata table
- DOM-only cursor overlay animation
- guarded region-preview image proxy
- approval checklist state machine
- non-executable local approval token generation
- execution preflight
- final dry-run envelope
- self-check
- protocol test matrix
- fixture sandbox
- cockpit summary dashboard
- audit timeline display
- audit evidence export

## Cockpit Summary

The top dashboard calls `POST /api/cockpit-summary` and aggregates:

- `self-check`
- `protocol-test-matrix`
- `fixture-sandbox`

Status values:

- `healthy`: all relevant checks pass
- `warning`: protocol is safe but current live approval state is incomplete, such as no approval token
- `failed`: an unexpected protocol failure exists

A missing live approval token is usually `warning`, not a crash.

## Approval Checklist

The checklist tracks:

1. approval bundle loaded
2. target lease / element / signature complete
3. cursor overlay available
4. visual verification run
5. region preview crop loaded
6. verification request available

When all checks pass, the widget can generate a local approval token. The token is review evidence only and must have `executable: false`.

## Preflight

`POST /api/execution-preflight` runs read-only checks against the selected approval token, its target, and the current live approval bundle for that target.

Preflight requires the current approval protocol version, `approvalBundleHash` in the token, and compares it with the current bundle's `bundleHash`. A legacy version, missing bundle, changed bundle, or mismatched digest blocks the token even when the checklist booleans, snapshot, and element signature still pass. The token store rejects unsupported versions and version 2 tokens without a bundle hash before writing them.

It does not click, type, focus, move the cursor, capture screenshots, or invoke UIA.

## Final Envelope

`POST /api/final-execution-envelope` builds a dry-run-only final review package.

It reports:

- intended action
- preflight result
- blocked reasons
- required final gates
- safety notes

It always returns `executionMode: "dry-run-only"` and `executable: false` in the current implementation. The click and type tools also persist their approval bundle before any real input path; a failed save blocks the action and is returned as `approvalBundleSave`.

## Preview APIs

The cockpit has observation-only preview APIs:

- `POST /api/preview/visual-verify`
- `POST /api/preview/region-preview`
- `GET /api/preview-image`

The image proxy only serves `region-preview-*.png` files from `%TEMP%/hana-desktop-orchestrator`.

## Audit Timeline and Export

The cockpit exposes:

- `GET /api/audit-timeline`
- `POST /api/audit-timeline`
- `POST /api/audit-evidence-export`

New audit events include a hash-chain. Export creates a local JSON evidence package with timeline events, verification results, and safety metadata.

Audit export is intentionally exposed through widget API. Standalone export tool wrappers were not reliably registered by the current dev tool discovery path, so they were removed to keep the tool list stable.

## Current Safety Boundary

The widget never performs:

- real click
- real typing
- OS cursor movement
- keyboard input
- UIA Invoke
- focus/window switching
- clipboard writes

The confirmation button remains disabled. Real input remains a separate future phase.
