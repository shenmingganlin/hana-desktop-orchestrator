# Contributing

Thanks for considering a contribution. This plugin sits between an LLM and the user's actual Windows desktop, so we lean conservative on what ships.

## Quick rules

- **No new runtime `Add-Type @"..."@` blocks.** All Win32 P/Invoke goes through `helper/HanaWin32.cs` → `HanaWin32.dll`. The precompiled DLL avoids `spawnSync ETIMEDOUT`.
- **High-risk tools must default to dry-run.** Real input is gated by three independent conditions; please do not weaken them.
- **PowerShell heredoc through JS template literals is fragile.** If you find a way to inline a here-string in a PS script, prefer to add a new method to `HanaWin32.cs` instead.
- **One commit per logical change.** Squash noise commits locally before pushing if you have them.
- **Tests:** `npm run check` runs syntax + package structure. Run it before opening a PR.

## Setup

```bash
git clone https://github.com/Ganlin/hana-desktop-orchestrator.git
cd hana-desktop-orchestrator
npm run check
```

You can develop without HanaAgent: every tool is a normal ES module with `export async function execute(input, ctx)`. Test individual tools with:

```bash
node --input-type=module -e "import('./tools/find-control.js').then(m => m.execute({...}))"
```

For full integration testing you need HanaAgent installed and the plugin folder dropped into `~/.hanako/plugins/`.

## Code structure

| Path | Purpose |
| --- | --- |
| `index.js` | Plugin lifecycle: warm up DLL, register tools, mount routes |
| `manifest.json` | Plugin manifest: name, version, contributions, configuration schema |
| `tools/*.js` | HanaAgent tool entry points. One file per tool, each exporting `name`, `description`, `parameters`, `execute`. |
| `lib/*.js` | Shared utilities (PowerShell bridge, Windows API snippets, lease store, signatures, audit timeline). |
| `routes/widget.js` | The review cockpit widget HTML + API. |
| `helper/HanaWin32.cs` | Single source of truth for Win32 P/Invoke. Recompile with `csc.exe` after editing. |
| `helper/HanaWin32.dll` | Compiled Win32 surface. Do not edit by hand. |
| `scripts/*.js` | Build / smoke / install verification helpers. |

## Adding a new tool

1. Create `tools/<your-tool>.js`. Export `name`, `description`, `parameters`, `execute`.
2. Use `lib/powershell.js` `runPowerShell` for any PS bridge. Do not call `spawnSync` directly.
3. If your tool mutates the desktop, copy the safety pattern from `tools/mouse-click-at.js`:
   - `dryRun: true` default
   - Require `I_UNDERSTAND_DESKTOP_INPUT` to flip to real
   - Honor `ctx.config.allowRealInput`
4. Run `npm run check:syntax` and `npm run check:package`.
5. Open a PR with a short description and at least one `desktop-orchestrator_self-check` / `cockpit-summary` after the change.

## Adding a new Win32 binding

1. Edit `helper/HanaWin32.cs`.
2. Recompile:
   ```powershell
   & "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" -target:library -out:helper\HanaWin32.dll helper\HanaWin32.cs
   ```
3. Reference it from your tool's PS script — `lib/powershell.js` `prepareScript` injects the DLL on every call.

## Vision accuracy

Vision tools have known limits. Please file vision-accuracy reports under the "Vision / accuracy report" issue template rather than as general bugs. We want to know whether fixes belong in our prompt layer, our parser, or in your hands as a model choice.

## License

By contributing, you agree your contributions are licensed under the project's MIT license.