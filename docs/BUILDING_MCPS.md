# Building MCP modules for MCP Station

*The human edition of the contract. The ✦ Claude popup carries the same rules as retained instructions — ask it and paste what it gives you.*

## The shape of a module

One folder in `mcps/`, two required files:

```
mcps/weather/
  manifest.json    identity + declared settings (drives the UI form)
  index.js         the tools (ESM)
```

Folder name = manifest `id`. The endpoint is `PUBLIC_URL/<slug>`.

## manifest.json

```json
{
  "id": "weather",
  "slug": "weather_mcp",
  "name": "Weather",
  "icon": "🌦️",
  "description": "Open-Meteo forecasts and current conditions.",
  "version": "1.0.0",
  "settings": [
    { "key": "api_key", "label": "API key", "type": "secret", "required": true, "help": "console.example.com → API keys" },
    { "key": "default_units", "label": "Units", "type": "select", "options": ["metric", "imperial"], "default": "metric" },
    { "key": "base_url", "label": "Base URL", "type": "text", "default": "https://api.example.com" }
  ]
}
```

- `id` / `slug`: lowercase letters, digits, `_`, `-`. Slug must be unique and not a reserved path (`api`, `oauth`, `token`, `register`, `assets`…). Convention: end slugs in `_mcp`.
- Setting types: `text`, `secret` (encrypted at rest, masked in the UI), `select` (needs `options`), `textarea`.
- Only settings declared here get stored or passed to your code.

## index.js

```js
export function register({ server, z, getSettings, log, fetchJson }) {
  server.registerTool(
    'weather_get_forecast',
    {
      title: 'Get forecast',
      description: `Daily forecast for a place.

Args:
  - place (string): city name or "lat,lon".
  - days (1-14, default 7).
Returns: markdown table of dates, highs/lows, precipitation.
Errors: "Error: api_key is not configured…" — set it in Settings.`,
      inputSchema: {
        place: z.string().min(2).describe('City or "lat,lon"'),
        days: z.number().int().min(1).max(14).default(7).describe('Days ahead')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ place, days }) => {
      const { api_key, base_url } = getSettings();
      if (!api_key) return { content: [{ type: 'text', text: 'Error: api_key is not configured. Open MCP Station → Weather → Settings.' }] };
      try {
        const data = await fetchJson(`${base_url}/forecast?q=${encodeURIComponent(place)}&days=${days}&key=${api_key}`);
        return { content: [{ type: 'text', text: render(data) }], structuredContent: data };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    }
  );
}

// Optional but recommended — powers the ▶ Test button:
export async function test(settings, { fetchJson }) {
  if (!settings.api_key) return { ok: false, message: 'api_key not set' };
  await fetchJson(`${settings.base_url}/ping?key=${settings.api_key}`);
  return { ok: true, message: 'API reachable' };
}
```

### What you're given

| Injected | What it is |
|---|---|
| `server` | `McpServer` from `@modelcontextprotocol/sdk` — call `server.registerTool(name, config, handler)` |
| `z` | zod — build `inputSchema` fields with it |
| `getSettings()` | decrypted settings object, manifest defaults applied |
| `log(msg)` | writes to the station Logs panel |
| `fetchJson(url, opts)` | fetch → parsed JSON; throws readable errors; 30 s timeout (override `opts.timeoutMs`) |

### House rules

1. Tool names: `service_action` snake_case — `telegram_send_message`, never bare `send`.
2. **`inputSchema` is a plain object of zod fields** — the SDK wraps it. Don't pass `z.object()`.
3. `.describe()` every field; add constraints and `.default()`s.
4. Annotations on every tool: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`.
5. Error strings tell the model what to do next, not stack traces.
6. Truncate huge outputs (~25 000 chars) with a note; paginate lists (`limit`/`offset`).
7. Secrets only via `getSettings()` — never hardcoded, never logged.
8. **No npm dependencies** — `fetchJson` + Node built-ins cover almost everything. Modules must stay self-contained in their folder.

## Workflow

1. **➕ Add MCP** (name + slug) → module scaffolds from `_template`, enabled but empty.
2. Open **‹/› Code** → replace `manifest.json` + `index.js` (ask the ✦ popup — it returns both files complete).
3. **Save & reload modules** — load errors show on the card.
4. **⚙ Settings** → fill credentials → **▶ Test**.
5. Connect `PUBLIC_URL/<slug>` in claude.ai (Settings → Connectors → Add custom connector) or Claude Code (`--header "Authorization: Bearer $MCP_TOKEN"`).

## Debugging

- Card shows a red *load error* → the exact message is on the card and in ⚙ Station → Logs.
- Tools misbehaving → add `log()` lines, watch the Logs panel while calling.
- `test()` failing → check credentials, then the endpoint URL in a browser.
- After every code change: **Reload modules** (imports are cache-busted, restarts never needed).
