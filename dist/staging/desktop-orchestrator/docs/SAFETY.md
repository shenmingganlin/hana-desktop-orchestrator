# Safety Model

Desktop control is high-impact because it can write to the real user session. Desktop Orchestrator is built around staged control rather than direct input.

## Default Rules

- Observation tools are allowed by default.
- High-risk actions default to dry-run.
- UIA semantic targeting is preferred over raw coordinates.
- Lease-bound snapshots prevent stale target reuse.
- Element signatures must match before high-risk actions proceed.
- Approval tokens are non-executable review evidence.
- Preflight is read-only.
- Final execution envelope is dry-run-only.
- Real mouse/keyboard input remains closed in the current implementation.

## Real Input Gates

Future real input must pass all of these gates before any desktop action is allowed:

1. explicit user intent for real input
2. `dryRun: false`
3. plugin config `allowRealInput: true`
4. exact confirmation phrase:

```text
I_UNDERSTAND_DESKTOP_INPUT
```

5. fresh lease-bound snapshot
6. immediate element signature verification
7. post-action verification request available
8. audit event recording

The current review cockpit does not satisfy these gates by itself and does not execute real input.

## Widget Full-Access Boundary

HanaAgent currently requires widget contributions to run under `full-access`. Desktop Orchestrator uses full-access only to expose the review cockpit surface.

Full-access does not change the real-input policy. Real desktop input remains blocked unless the separate real-input gates are implemented and passed.

## Approval Tokens

Local approval tokens are intentionally non-executable:

- token type: `desktop-orchestrator-local-approval-token`
- required field: `executable: false`
- default TTL: 10 minutes
- TTL clamp: 30 seconds to 30 minutes
- saved with SHA-256 hash

The token store rejects any token where `executable` is not exactly `false`.

## Preflight and Final Envelope

Execution preflight reads local stores and verifies:

- token presence
- token TTL
- token hash
- non-executable status
- target fields
- lease snapshot availability
- snapshot element availability
- stored signature match
- checklist completeness

The final execution envelope summarizes what would still be required. It returns `executionMode: "dry-run-only"` and `executable: false`.

## Verification Layers

- `verify-action` re-reads a lease-bound UIA element and compares signatures.
- `visual-verify` samples an element region in memory and compares visual signatures.
- `region-preview` writes an explicit PNG crop for review evidence.
- The widget image proxy only serves `region-preview-*.png` from the plugin temp directory.

## Foreground Observation Boundary

`ui-tree` defaults to background-safe observation and does not activate the target window unless explicitly requested.

Some Windows Settings, UWP, and WinUI surfaces do not expand their full UIA subtree while they are in the background. For these cases, `ui-tree` supports `activateBeforeRead: true`:

- it calls `SetForegroundWindow` for the target window before reading UIA
- it waits briefly for the provider subtree to stabilize
- it records `activatedBeforeRead: true` in the result
- it does not click, type, move the cursor, capture screenshots, or invoke UIA

This is a medium-impact observation option because it changes the foreground window. It is not part of final execution and does not relax real-input gates.

## Audit Evidence

Audit events are stored locally and new events include a hash-chain:

- `previousHash`
- `eventHash`
- `chainVersion`

Old events without hashes are treated as legacy-compatible. Audit export writes a JSON evidence package and does not mutate approval state.

## Blocked Until Later

These remain intentionally unopened:

- raw mouse movement
- keyboard typing
- clipboard-assisted typing
- foreground input fallback
- drag/drop
- hotkeys
- real UIA Invoke as a default workflow
- focus/window switching as part of final execution

Observation-only foreground activation through `ui-tree.activateBeforeRead` is a separate, explicit read path. It must stay opt-in and must not be reused as an execution-side focus fallback.
