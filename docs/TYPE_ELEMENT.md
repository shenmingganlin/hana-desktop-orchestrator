# Type Element

`type-element` creates a guarded text input plan for a UI Automation element.

## Flow

1. Call `ui-tree` and choose an editable element.
2. Pass `leaseId + snapshotId + elementId` to `type-element`.
3. The tool restores the original window handle and element signature from the lease snapshot.
4. It inspects the current UIA element.
5. It compares the current signature with the lease signature.
6. Only after the signature guard passes can a real write be considered.

## Execution Policy

Default behavior is dry-run.

Real write requires all gates:

- `dryRun: false`
- plugin config `allowRealInput: true`
- confirmation phrase `I_UNDERSTAND_DESKTOP_INPUT`
- matching element signature
- UIA `ValuePattern` available
- target not read-only

## Fallback Policy

Clipboard-assisted or keyboard typing is not executed in V0.

If `ValuePattern` is unavailable, the tool returns a plan with:

```text
clipboard-assisted-typing-plan-only
```

This keeps text input powerful enough to plan, but prevents accidental foreground keyboard injection.

## Safety Order

The safe order is:

```text
restore lease -> inspect element -> verify signature -> optional UIA SetValue
```

No write should happen before signature verification.
