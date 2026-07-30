# Tool Discovery Notes

During development, standalone audit export tool wrappers were created and passed syntax checks, but did not appear in the dev plugin tool list after reload.

Observed wrappers:

- `tools/audit-evidence-export.js`
- `tools/audit-export.js`

Both were removed because they were not registered and could mislead future maintenance.

## Stable Export Path

Audit evidence export is implemented in:

```text
lib/audit-evidence-export.js
```

The stable UI/API path is:

```text
POST /api/audit-evidence-export
```

## Risk

Do not assume that every new file in `tools/*.js` will be registered by the current dev tool discovery path. Always verify through plugin diagnostics after adding tools.

## Validation Pattern

1. Run `node --check` for the tool file.
2. Reload the dev plugin.
3. Check diagnostics for the prefixed tool name.
4. Invoke the registered tool.
5. If the tool does not appear, do not leave the wrapper in place unless its absence is intentionally documented.

## Current Decision

Keep audit export behind widget API until the tool discovery behavior is understood.
