# Stale Snapshot Guard

Stale Snapshot Guard prevents the agent from acting on an element that no longer matches the UI snapshot it inspected.

## Problem

`elementId` values are snapshot-local. If a window changes between `ui-tree` and `click-element`, an id such as `el-3` may point to a different control.

## Current V0.3 Guard

`ui-tree` emits an `element.signature` for each element. The signature is derived from:

- role
- name
- automationId
- className
- enabled state
- rounded bounds

`click-element` accepts `elementSignature`. Before returning a click plan or invoking UIA, it recomputes the current element signature and rejects mismatches.

## Example Flow

```text
ui-tree -> el-4 + signature abcd1234
click-element elementId=el-4 elementSignature=abcd1234
  -> signature matches: return plan
  -> signature mismatch: return stale=true and refuse action
```

## Limits

This is a lightweight guard. It does not store full snapshots yet.

Future versions should add:

- session-local snapshot store
- snapshot expiration
- window lease id
- stronger element path identity
- post-action verification snapshot
