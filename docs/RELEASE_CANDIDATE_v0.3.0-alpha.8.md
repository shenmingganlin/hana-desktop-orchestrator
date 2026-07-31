# Release Candidate Record: v0.3.0-alpha.8-rc1

Date: 2026-07-31
Status: Release candidate
Baseline commit: `cfb9081ffe96dc0b35e83926fa6f33049c7b6f88`
Baseline message: `fix: support descendant focus for winui inputs`

## Artifact

- Package: `dist/desktop-orchestrator-0.3.0-alpha.8.zip`
- SHA-256: `A2C30F55F40F3D316C0B0B38ADD7AD72985A558BE85A58891E7BE75EBBEA4793`
- Manifest version: `0.3.0-alpha.8`
- Package version: `0.3.0-alpha.8`
- Proposed local tag: `v0.3.0-alpha.8-rc1`

## Verification

### Automated checks

- `npm run check:syntax`: passed
- `npm run check:package`: passed, `69/69`
- `npm run final-regression`: passed, `50/50` (completed before RC freeze)
- Text input matrix: passed, `16/16`
- Native safe smoke: passed, `5/5`
- Hana host self-check: passed, `7/7`

### Host and compatibility matrix

- WinUI / Notepad: ValuePattern, keyboard fallback, clipboard fallback passed
- WinForms: ValuePattern, descendant-focus keyboard fallback, clipboard fallback passed
- WPF: ValuePattern, descendant-focus keyboard fallback, clipboard fallback passed
- Chromium / Edge web input: ValuePattern, descendant-focus keyboard fallback, clipboard fallback passed
- Chromium / Edge Canvas: UIA exposed only the Canvas surface; protected visual click and post-click state verification passed
- Native Direct2D: `D2D1_RENDER_TARGET_TYPE_DEFAULT` window created; `PrintWindow` captured the GPU-rendered client area; protected visual click and post-click state verification passed

## Safety Evidence

All real desktop actions used the explicit confirmation phrase `I_UNDERSTAND_DESKTOP_INPUT`.

Visual actions were validated with:

- fresh window screenshots
- target window handle matching
- hit-window matching
- foreground-window checks
- post-action screenshot and state comparison

The tested temporary targets were local and harmless state toggles. No input was sent to QQ, WeChat, HanaAgent chat, or another external communication surface.

The alpha.8 baseline retains these defaults and boundaries:

- real input disabled by default
- keyboard fallback disabled by default
- clipboard fallback disabled by default
- real mouse movement disabled by default
- dry-run and confirmation gates remain active
- lease, signature, top-level window, foreground, and hit-window guards remain active

## Cleanup

- Temporary Canvas and Direct2D windows closed
- Temporary test HTML, profiles, source files, and executables removed
- Temporary test processes confirmed at zero
- Git working tree clean before RC record creation

## Known Boundaries

This RC does not claim compatibility with:

- exclusive fullscreen DirectX or Vulkan applications
- hardware overlay surfaces
- protected video surfaces
- anti-cheat protected applications

Those require separate target-specific testing. Any new defect found after this freeze should be fixed in `alpha.9` or a later release, without modifying this RC baseline.
