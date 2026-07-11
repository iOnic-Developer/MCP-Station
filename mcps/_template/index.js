/**
 * __NAME__ — MCP Station module (created from _template).
 *
 * The contract: export register({ server, z, getSettings, log, fetchJson })
 * and optionally export test(settings, { fetchJson }) to power the UI's
 * Test button. Edit this file in the Code editor, then hit Reload modules.
 * Ask the Claude popup for help — it knows this format inside out.
 *
 *  - server     McpServer from @modelcontextprotocol/sdk — call server.registerTool(...)
 *  - z          zod, for inputSchema fields
 *  - getSettings()  → decrypted settings declared in manifest.json (defaults applied)
 *  - log(msg)   writes to the station log panel
 *  - fetchJson(url, opts) → parsed JSON or a throw with a readable message (30 s timeout)
 */
export function register({ server, z, getSettings, log, fetchJson }) {
  server.registerTool(
    '__ID___echo', // tool names: service-prefixed snake_case, e.g. weather_get_forecast
    {
      title: 'Echo',
      description: `Example tool that echoes text back. Replace me.

Args:
  - text (string): what to echo.
Returns: the same text, plus which settings are configured.`,
      inputSchema: {
        // NOTE: a plain object of zod fields — not z.object(...)
        text: z.string().min(1).max(2000).describe('Text to echo back')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ text }) => {
      const settings = getSettings();
      const configured = Object.entries(settings).filter(([, v]) => v).map(([k]) => k);
      log(`echo called (${text.length} chars)`);
      return {
        content: [{
          type: 'text',
          text: `Echo: ${text}\n\nConfigured settings: ${configured.join(', ') || 'none yet — open Settings on this MCP'}`
        }]
      };
    }
  );

  /* A realistic second tool, ready to adapt — uncomment and edit:
  server.registerTool(
    '__ID___get_thing',
    {
      title: 'Get thing',
      description: 'Fetch a thing from the API by id.\n\nArgs: thing_id (string).\nReturns: JSON of the thing.\nErrors: "Error: api_key not configured…" | "Error: HTTP 404 …"',
      inputSchema: {
        thing_id: z.string().describe('The thing to fetch')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ thing_id }) => {
      const { api_key, base_url } = getSettings();
      if (!api_key) return { content: [{ type: 'text', text: 'Error: api_key is not configured. Open MCP Station → this MCP → Settings.' }] };
      try {
        const data = await fetchJson(`${base_url}/things/${encodeURIComponent(thing_id)}`, {
          headers: { Authorization: `Bearer ${api_key}` }
        });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2).slice(0, 25000) }], structuredContent: data };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    }
  );
  */
}

/** Optional: powers the Test button in the UI. Return { ok, message }. */
export async function test(settings) {
  if (!settings.api_key) return { ok: false, message: 'api_key not set yet — this is just the template test.' };
  return { ok: true, message: 'Settings present. Replace test() with a real API ping.' };
}
