# Building a Module

**Stable and beta:** modules are source folders. **Beta:** one source can serve several accounts;
source changes affect all of them.

```text
mcps/my-module/
├── manifest.json
├── index.js
└── instructions.md     optional client instructions
```

Copy `_template` or ask the [Assistant](Assistant) to scaffold a source from sanitized API docs.
The detailed [module contract](https://github.com/iOnic-Developer/MCP-Station/blob/redesign/public-product/docs/BUILDING_MCPS.md)
remains the implementation reference.

## Minimal manifest

```json
{
  "id": "weather",
  "slug": "weather_mcp",
  "name": "Weather",
  "icon": "⛅",
  "description": "Weather service tools",
  "version": "1.0.0",
  "settings": [
    { "key": "api_key", "label": "API key", "type": "secret", "required": true }
  ]
}
```

Supported form types are `text`, `secret`, `select`, and `textarea`. Use secret fields for credentials;
ordinary source files are not encrypted secret storage. Keep IDs/slugs unique and non-reserved.

## Registration shape

```js
export function register({ server, z, getSettings }) {
  server.registerTool('check_configuration', {
    title: 'Check configuration',
    description: 'Check whether this account has an API key; does not test the service.',
    inputSchema: {}
  }, async () => {
    const configured = Boolean(getSettings().api_key);
    return {
      content: [{ type: 'text', text: configured ? 'API key supplied.' : 'Set an API key in Settings.' }],
      isError: !configured
    };
  });
}
```

Use a plain object of Zod fields for `inputSchema`, not `z.object()`. Platform helpers include
`fetchJson` and global `fetch`; do not assume arbitrary npm dependencies are installed. Add an
optional `test(settings, {fetchJson})` export for a meaningful upstream connectivity check.
The example above checks configuration only and never validates an upstream key.

## Account-safe source

Get per-request settings from the injected `getSettings()` closure. Do not store credentials in
module-global variables. Account snapshots prevent ordinary cross-request settings mutation,
not malicious module access: JavaScript runs in the trusted station process.

Return actionable errors without secrets. Make destructive actions explicit and require appropriate
confirmation. Review generated code, inspect Tools, test, and reload before enabling access.
The Station management module is another privileged way to create/edit source remotely.

## Share source, not state

Module ZIP export excludes managed configuration/chat, not arbitrary embedded secrets. Review it
before sharing. Account records and usage require a full private backup. [Backups](Backups).
