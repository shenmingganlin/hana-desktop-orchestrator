# Security

This plugin can drive your real mouse and keyboard. With great power comes great footguns.

## Threat model

You run this plugin because you trust an LLM with the ability to control your Windows session. The plugin is the layer between the LLM and the OS. Its job is to make that interaction **reviewable**, **revokable**, and **least-surprising**.

The plugin is NOT a sandbox. It does not stop the LLM from doing dumb things — it stops dumb things from being executed silently.

## Trust boundaries

- **LLM ↔ plugin:** JSON tool inputs. The plugin trusts the LLM only as far as the schema and safety gates enforce.
- **Plugin ↔ OS:** PowerShell bridge + Windows API. The plugin trusts Microsoft.
- **User ↔ plugin:** Confirmation phrases, plugin config, widget cockpit. The user is the final authority.

## What the plugin will NOT do without your say-so

- Move the real mouse or send real clicks (`mouse-click-at`, `mouse-drag`, `mouse-wheel`).
- Invoke a UIA element action that mutates state (`click-element` `Invoke` pattern, `type-element` ValuePattern).
- Move, resize, or close a window.
- Modify plugin configuration.

All of the above require:

1. `dryRun: false` in the tool input.
2. `allowRealInput: true` in the plugin config.
3. The exact phrase `I_UNDERSTAND_DESKTOP_INPUT` in the tool input.

If any of those is missing, the tool returns a dry-run envelope and does not touch the system.

## What the plugin DOES do without confirmation

- Snapshot the screen (`snapshot` with `includeScreenshot`).
- List visible windows.
- Read UIA trees.
- Inspect a window.
- Send a screenshot to a vision API (uses your configured `visionApiKey`).

These are all read-only and reversible. They do, however, leak information: a screenshot can contain personal data, and your vision API provider sees the image.

## Reporting a vulnerability

Open an issue or a private security advisory on GitHub. Please do not post a public issue that exposes an exploit before a fix is available.