# Architecture

Desktop Orchestrator is split into five layers.

## 1. Observation Layer

Collects the state of the desktop:

- screen size
- DPI scale
- active window
- visible top-level windows
- optional screenshot
- future UIA element tree
- future OCR text anchors

## 2. Targeting Layer

Narrows an action to an intended scope:

- window title
- process id
- native window handle
- class name
- element id
- visual anchor

The targeting layer should reject ambiguous matches instead of guessing silently.

## 3. Planning Layer

Produces an explicit action plan before execution:

```json
{
  "risk": "high",
  "target": { "windowTitle": "Notepad" },
  "action": { "type": "click", "x": 120, "y": 80 },
  "preconditions": ["target window is foreground"],
  "verification": ["capture snapshot after action"]
}
```

## 4. Execution Layer

Executes the plan through the safest available channel:

1. semantic UIA action
2. window-scoped UIA value action
3. clipboard-assisted text input
4. guarded foreground mouse/keyboard fallback

## 5. Verification Layer

After execution, the plugin should re-observe the target and return enough evidence for the model to judge success.

V1 only provides the structure. Later versions should make verification mandatory for high-risk actions.

## Why Not Raw Control First

Raw mouse/keyboard input is universal but weakly grounded. A strong desktop plugin should not merely move the cursor. It should preserve the chain:

```text
intent -> target -> plan -> action -> observation -> verification
```
