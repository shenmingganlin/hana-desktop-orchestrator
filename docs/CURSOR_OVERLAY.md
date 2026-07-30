# Cursor Overlay Protocol

Cursor Overlay is a visual preview protocol for desktop actions.

The goal is not to move the real mouse immediately. The goal is to show the user where the agent intends to act before dangerous input is executed.

## Why It Matters

Desktop automation is hard to trust when actions are invisible. A smooth cursor overlay gives the user a readable chain:

```text
intent -> target element -> preview cursor -> confirmed action
```

## Data Shape

```json
{
  "kind": "cursor-overlay",
  "version": 1,
  "intent": "preview-click-target",
  "cursor": {
    "shape": "arrow",
    "hotspot": { "x": 4, "y": 4 },
    "theme": "hana-glow"
  },
  "motion": {
    "easing": "cubic-bezier(0.22, 1, 0.36, 1)",
    "durationMs": 520,
    "dwellMs": 160,
    "keyframes": [
      { "t": 0, "x": 100, "y": 100, "opacity": 0.72, "scale": 0.96 },
      { "t": 0.78, "x": 300, "y": 240, "opacity": 1, "scale": 1 },
      { "t": 1, "x": 300, "y": 240, "opacity": 1, "scale": 1.04 }
    ]
  },
  "target": {
    "label": "确定",
    "center": { "x": 300, "y": 240 },
    "pulse": true
  }
}
```

## Rendering Direction

A future widget can render this as:

- a translucent cursor texture
- a target pulse circle
- a short dwell before click
- optional trail glow
- optional label bubble

## Safety Rule

Cursor overlay is preview-only. It must not imply that real input was executed.

Real input remains controlled by safety policy and confirmation gates.
