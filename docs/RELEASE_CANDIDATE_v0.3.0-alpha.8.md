# Release Candidate Record: v0.3.0-alpha.8-rc2

Date: 2026-07-31
Status: Release candidate
Core baseline commit: `cfb9081ffe96dc0b35e83926fa6f33049c7b6f88`
RC2 packaging commit: `a895544 fix: make alpha.8 package reproducible`
Documentation commit: `300372b docs: rewrite README in Chinese`
Core baseline message: `fix: support descendant focus for winui inputs`

## Artifact

- Package: `dist/desktop-orchestrator-0.3.0-alpha.8.zip`
- SHA-256: `96B0638AC6FA58616D97350AEFDA8C3442C07E1CBE3D971387ECECCE32EC776B`
- Archive file count: `139`
- Manifest version: `0.3.0-alpha.8`
- Package version: `0.3.0-alpha.8`
- Proposed local tag: `v0.3.0-alpha.8-rc2`
- RC audit record is intentionally excluded from the plugin ZIP to avoid self-referential hashes.

## Verification

### Automated checks

- `npm run check:syntax`: passed
- `npm run check:package`: passed, `69/69`
- `npm run final-regression`: passed, `50/50`
- `npm run build:package` repeated twice: identical SHA-256
- `npm run smoke:package`: passed, `46/46` before final RC2 run
- `npm run install-smoke:package`: passed, `35/35` before final RC2 run
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

## Packaging Evidence

The package builder now produces deterministic ZIP bytes by using a stable sorted file order and a fixed entry timestamp. The package includes an explicit documentation allowlist; RC audit records remain repository evidence and are excluded from the installable artifact. Two consecutive builds produced the same SHA-256: `96B0638AC6FA58616D97350AEFDA8C3442C07E1CBE3D971387ECECCE32EC776B`.

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
- Git working tree clean before RC2 packaging changes
- RC1 remains available as `v0.3.0-alpha.8-rc1`; it was not rewritten

## Known Boundaries

This RC does not claim compatibility with:

- exclusive fullscreen DirectX or Vulkan applications
- hardware overlay surfaces
- protected video surfaces
- anti-cheat protected applications

Those require separate target-specific testing. Any new defect found after this freeze should be fixed in `alpha.9` or a later release, without modifying this RC2 baseline.
