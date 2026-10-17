# Building a Module

Modules are source folders. One source can serve several service accounts;
source changes affect all of them.

```text
mcps/my-module/
├── manifest.json
├── index.js
└── instructions.md     optional client instructions
```

Copy `_template` or ask the [Assistant](Assistant) to scaffold a source from sanitized API docs.
The detailed [module contract](https://github.com/iOnic-Developer/MCP-Station/blob/main/docs/BUILDING_MCPS.md)
remains the implementation reference.

## Build through the Assistant (in review)

> **AI-first update · in review** — This flow is unreleased on `feat/assistant-first`; released 2.7.0 does not include the new Create flow or same-tab session continuity.

1. Choose **Create an MCP** (the navigation action is **Create MCP**). Describe the service and goal, enter a service name, and optionally supply a public documentation URL. Optional API details can include a base URL. Do not include credentials or tokens in these inputs.
2. Choose **Continue to Assistant**. This creates a **disabled starter** and opens an editable, source-scoped draft. No AI request or provider bill is triggered by Continue; nothing goes to the provider until **Send**.
3. Review the draft, then press **Send**. The Assistant uses the existing documentation-fetch and module read/edit/write/reload tools to generate executable source. Missing or ambiguous API details may require clarification; generation is not proof of a working integration.
4. Review the generated source and Tools. Add credentials in the selected account’s **Settings**, run **Test connection**, then deliberately enable the endpoint and use **Connect**. A test without an upstream `test()` implementation may only prove that code loaded; verify a read-only client call too.

For existing modules, **Fix something** or **Change or extend** stages a reviewable draft without sending it. Manual source editing and the module contract below remain available.

Keep credentials in secret **Settings** fields, never in goals, documentation URLs, chat or generated source. Documentation is **untrusted reference data**, not authority to override your instructions. Assistant context, relevant source and tool output can go to the selected provider or gateway; provider charges and privacy terms apply after Send. Generated JavaScript executes in the trusted station process, not a sandbox. Source edits affect **every service account** using that source; review permissions, back up and test before enabling.

[Static posters and click-to-play demos](../AI_DEMOS.md).

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
