# Verify Action

`verify-action` closes the loop after a planned or executed high-risk desktop action.

It only observes. It does not click, type, move the mouse, or change the desktop.

## Flow

1. `ui-tree` creates a lease snapshot.
2. `click-element` or `type-element` returns a `verificationRequest`.
3. `verify-action` uses the request to re-read the target window and element.
4. It compares the current element signature with the expected signature.
5. It returns `passed: true` only when the target still matches.

## Current Checks

- lease snapshot exists
- target window handle can be resolved
- snapshot-local `elementId` can be re-read
- expected name still matches when available
- element signature still matches

## Safety Order

```text
plan action -> verify target -> optional real action -> verify again
```

Current V0 verification is UIA-signature based. Screenshot diff and visual verification are future work.
