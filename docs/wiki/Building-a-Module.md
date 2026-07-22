# Building a Module

A module is a folder in `mcps/` — two required files, one optional.

```
mcps/my-module/
├── manifest.json     # id, slug, name, icon, description, version, settings[]
├── index.js          # export function register({ server, z, getSettings, log, fetchJson })
└── instructions.md   # optional — served to every client as MCP instructions at initialize
```

The full contract (with a worked example) is in
[docs/BUILDING_MCPS.md](https://github.com/iOnic-Developer/MCP-Station/blob/main/docs/BUILDING_MCPS.md).
The essentials:

## manifest.json

```json
{
  "id": "weather",
  "slug": "weather_mcp",
  "name": "Weather",
  "icon": "⛅",
  "description": "Current conditions and forecast",
  "version": "1.0.0",
  "settings": [
    { "key": "api_key", "label": "API key", "type": "secret", "required": true },
    { "key": "units", "label": "Units", "type": "select", "options": ["metric", "imperial"], "default": "metric" }
  ]
}
```

Setting types: `text`, `secret` (encrypted at rest, masked in the UI), `select`, `textarea`. The
`slug` is the URL path; keep it out of `RESERVED_SLUGS`.

## index.js

```js
export function register({ server, z, getSettings, log, fetchJson }) {
  server.registerTool(
    'get_current',
    {
      title: 'Current weather',
      description: 'Current conditions for a city.',
      inputSchema: { city: z.string().describe('City name') }  // a PLAIN object of zod fields
    },
    async ({ city }) => {
      const { api_key, units } = getSettings();               // live, decrypted config
      if (!api_key) return { content: [{ type: 'text', text: 'Error: set an API key in Settings.' }] };
      const data = await fetchJson(`https://api.example.com/weather?q=${encodeURIComponent(city)}&units=${units}&key=${api_key}`);
      return { content: [{ type: 'text', text: `${city}: ${data.temp}° ${data.summary}` }] };
    }
  );
}

// optional connectivity check for the ▶ Test button
export async function test(settings, { fetchJson }) {
  if (!settings.api_key) return { ok: false, message: 'No API key set.' };
  await fetchJson(`https://api.example.com/ping?key=${settings.api_key}`);
  return { ok: true, message: 'Reached the API.' };
}
```

## The rules that bite

- **`inputSchema` is a plain object of zod fields**, never `z.object()` — the SDK wraps the raw shape.
- **No npm dependencies inside a module.** You get `fetchJson` (and global `fetch`) injected; that's
  the HTTP surface.
- **Return actionable errors** ("set the API key in Settings") rather than throwing — Claude relays
  them to the user.
- **Hot reload:** save in the editor → ⟳ Reload modules. No restart.

## The easy way

Open ➕ **Add MCP** (or any module's ✦ **Chat**) and describe what you want, or paste the API's docs
/ an OpenAPI spec / example `curl` calls. The assistant knows this contract and writes the whole
module into the editor. Insert, toggle on, done. Then 📦 **Export** it to share.
