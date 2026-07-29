# Lease Workflow

Lease Workflow binds element actions to a recent UI snapshot so the model does not need to manually carry window handles and element signatures.

## Current Flow

1. Call `ui-tree`.
2. `ui-tree` returns:
   - `leaseId`
   - `snapshotId`
   - `expiresAt`
   - `window.handle`
   - `elements[].signature`
3. Call `click-element` with:
   - `leaseId`
   - `snapshotId`
   - `elementId`
4. `click-element` restores the snapshot from the local snapshot store.
5. It recovers the original window handle and element signature.
6. It re-reads the current UIA element and checks the signature before returning a plan or invoking UIA.

## Safety Value

This prevents a common failure mode:

```text
ui-tree reads Window A
foreground changes to Window B
click-element runs without scope
```

With a lease, `click-element` restores Window A's handle and refuses stale element signatures.

## Storage

V0 uses a temp-file store:

```text
%TEMP%/hana-desktop-orchestrator/snapshot-store.json
```

Snapshots expire after 10 minutes.

## Future Work

- Move store to plugin data directory
- Bind lease to session path
- Add lease revocation
- Add post-action verification
- Add stronger element path identity
