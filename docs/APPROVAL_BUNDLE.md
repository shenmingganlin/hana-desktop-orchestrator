# Approval Bundle

`approvalBundle` is the data protocol for a future visual approval panel.

It does not execute any desktop action. It only packages the materials needed for review. Bound approval bundles use protocol `version: 2` and carry a SHA-256 `bundleHash`; approval tokens copy this value as `approvalBundleHash` so preflight can bind the token to the current live bundle.

## Contents

An approval bundle includes:

- `approval`: dry-run or real-input gate result
- `plan`: guarded action plan
- `target`: lease-bound target metadata
- `cursorOverlay`: optional cursor preview protocol
- `verificationRequest`: UIA signature verification request
- `previewRequests`: suggested visual tools to call
- `capability`: UIA pattern availability
- `safety`: explicit safety requirements
- `bundleHash`: stable SHA-256 digest of the bundle contents, excluding the `bundleHash` field itself

## Preview Requests

The bundle can suggest follow-up tool calls:

```text
desktop-orchestrator_visual-verify
desktop-orchestrator_region-preview
```

These requests are not executed automatically.

## Compatibility

Bundles and tokens from protocol `version: 1` may still be loaded for display, but they are not executable approval evidence. The token store accepts only the current token version and requires `approvalBundleHash`; preflight also requires the current bundle version, a present and self-consistent `bundleHash`, and a matching token digest. The correct migration is to generate a fresh version 2 bundle and token. The approval store applies the same write-time validation: unsupported versions, missing hashes, and content/hash mismatches are rejected before a record is written.

## Safety

The bundle is preview-first. Real desktop input remains blocked unless all real-input gates pass:

- `dryRun: false`
- plugin config `allowRealInput: true`
- confirmation phrase `I_UNDERSTAND_DESKTOP_INPUT`
- fresh lease
- signature guard

## Future UI

A future approval panel can render:

- action summary
- crop preview
- cursor overlay
- verification status
- final confirmation controls
