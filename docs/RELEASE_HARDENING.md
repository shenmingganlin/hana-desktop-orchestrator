# Release Hardening Checklist

This checklist captures the current pre-release hardening state for Desktop Orchestrator.

## Safety Gates

- [x] High-risk tools default to dry-run.
- [x] Real input requires explicit future gates.
- [x] Confirmation phrase is documented: `I_UNDERSTAND_DESKTOP_INPUT`.
- [x] Approval tokens are non-executable.
- [x] Token store rejects `executable !== false`.
- [x] Execution preflight is read-only.
- [x] Final envelope is dry-run-only.
- [x] Widget confirmation remains disabled.

## Review Cockpit

- [x] Recent approval bundle loading.
- [x] Cursor overlay simulation.
- [x] Region preview crop background.
- [x] Guarded preview image proxy.
- [x] Approval checklist.
- [x] Local approval token generation.
- [x] Execution preflight button.
- [x] Final envelope button.
- [x] Self-check button.
- [x] Protocol matrix button.
- [x] Fixture sandbox button.
- [x] Cockpit summary dashboard.
- [x] Audit timeline panel.
- [x] Audit evidence export button.

## Protocol Tests

- [x] `desktop-orchestrator_self-check` registered.
- [x] `desktop-orchestrator_protocol-test-matrix` registered.
- [x] `desktop-orchestrator_fixture-sandbox` registered.
- [x] `desktop-orchestrator_cockpit-summary` registered.
- [x] Invalid token rejection covered.
- [x] Executable token rejection covered.
- [x] Expired token fixture covered.
- [x] Hash mismatch fixture covered.
- [x] Signature mismatch fixture covered.
- [x] Complete fixture chain covered.

## Audit Evidence

- [x] Audit timeline store exists.
- [x] New audit events include `previousHash` and `eventHash`.
- [x] Legacy events without hashes are compatible.
- [x] Evidence package export writes JSON.
- [x] Export does not mutate approval state.
- [x] Export does not execute desktop input.

## Known Boundary

Standalone audit export tool wrappers were not reliably registered by the current dev tool discovery path. The stable path is the widget API:

```text
POST /api/audit-evidence-export
```

Do not reintroduce export wrappers until the tool discovery behavior is diagnosed.

## Pre-Release Smoke Commands

```bash
node --check routes/widget.js
node --check lib/audit-timeline.js
node --check lib/audit-evidence-export.js
node --check lib/cockpit-summary.js
node --check tools/self-check.js
node --check tools/protocol-test-matrix.js
node --check tools/fixture-sandbox.js
node --check tools/cockpit-summary.js
```

Then verify through the dev tools:

- reload dev slot with full-access allowed
- invoke `desktop-orchestrator_self-check`
- invoke `desktop-orchestrator_protocol-test-matrix`
- invoke `desktop-orchestrator_fixture-sandbox`
- invoke `desktop-orchestrator_cockpit-summary`
- confirm widget surface `/api/plugins/desktop-orchestrator/widget`

## Still Blocked

- real mouse movement
- keyboard typing
- clipboard typing fallback
- raw coordinate execution
- focus switching as part of final execution
- release packaging/version bump
