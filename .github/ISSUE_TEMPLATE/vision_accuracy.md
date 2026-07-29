---
name: Vision / accuracy report
about: Help us calibrate vision-query and vision-click precision
title: "[vision] "
labels: vision, bug
assignees: ""
---

Vision accuracy depends heavily on the underlying model. Filing a structured report helps us know whether a fix belongs in our prompt / parser layer or whether the user should switch vision models.

## Setup

- Vision provider / model in plugin config:
- Screenshot source: `snapshot` / `vision-click` / external PrintWindow
- Approximate target size on screen: (e.g. 158x176 px UI item)

## Test

```text
target: "<what you asked>"
expected_bbox_or_id: <if you know it>
actual_response: <paste vision-query JSON result, especially result / result.text / modelResponse>
```

## What I want

- [ ] A tool that returns ground-truth bbox for the target (e.g. via UIA, for Windows / Electron apps)
- [ ] A better vision prompt that asks for the bounding box first then computes the center
- [ ] A built-in Set-of-Mark (SoM) helper that pre-labels UIA elements and lets vision pick a number
- [ ] A different default vision model

## Anything else

(Optional) Workarounds you found.