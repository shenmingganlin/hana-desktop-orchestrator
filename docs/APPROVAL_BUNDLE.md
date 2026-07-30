# Approval Bundle

`approvalBundle` is the data protocol for a future visual approval panel.

It does not execute any desktop action. It only packages the materials needed for review.

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

## Preview Requests

The bundle can suggest follow-up tool calls:

```text
desktop-orchestrator_visual-verify
desktop-orchestrator_region-preview
```

These requests are not executed automatically.

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
