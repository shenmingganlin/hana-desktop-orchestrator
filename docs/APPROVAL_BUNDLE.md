# Approval Bundle

`approvalBundle` is the data protocol for a future visual approval panel.

It does not execute any desktop action. It only packages the materials needed for review. Each generated bundle carries a SHA-256 `bundleHash`; approval tokens copy this value as `approvalBundleHash` so preflight can bind the token to the current live bundle.

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

Bundles created before `bundleHash` was introduced may still be loaded for display, but they are not executable approval evidence. Preflight requires the stored `bundleHash` to be present and self-consistent, and requires the token's `approvalBundleHash` to match it. The correct migration is to generate a fresh bundle and token.

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
