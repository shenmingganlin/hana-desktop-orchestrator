# Visual Verify

`visual-verify` adds a lightweight visual verification layer on top of UIA signature checks.

It only observes the screen. It does not click, type, move the mouse, save screenshots, or change desktop state.

## Flow

1. Call `ui-tree` to create a lease snapshot.
2. Choose an element with bounds.
3. Call `visual-verify` with `leaseId + snapshotId + elementId`.
4. The tool captures the element's screen region in memory.
5. It creates an average RGB grid signature.
6. Call it again with `expectedVisualSignature` to compute `diffScore`.

## Signature

Current V0 algorithm:

```text
avg-rgb-grid-v1
```

Default grid size is `8`, producing 64 average-color cells.

## Result

- First call: `passed: null`, `reason: baseline-captured`
- Compare call: `passed: true` when `diffScore <= threshold`
- Default threshold: `0.08`

## Limits

This is a coarse visual signal, not OCR or semantic vision.

Future versions should add:

- screenshot file staging for inspection
- region crop previews
- perceptual hash
- OCR anchors
- template/image anchors
- before/after action visual verification bundles
