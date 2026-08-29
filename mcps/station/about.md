# MCP Station ⛽ — the station managing itself

This module exposes MCP Station's own admin operations as MCP tools, so an AI can build and
maintain the station's other MCPs without opening the admin UI. It drives the exact same
functions the web UI drives — there is no second code path and no session cookie involved.

**Endpoint:** `PUBLIC_URL/station/mcp` · **Settings:** none — it manages the station it runs in.

## What it's for

- "What MCPs do I have, and is anything broken?" → `station_list_mcps`
- "Build me an MCP for <service>" → `station_guide` → `station_create_mcp` → `station_write_file`
- "Fix the bug in the Sonarr module" → `station_read_file` → `station_write_file`
- "Set the n8n API key" → `station_get_settings` → `station_configure_mcp`
- "Take the Xero one offline for now" → `station_set_enabled`

## Building a new MCP, end to end

1. **`station_guide`** — read the contract first. It is not optional: two rules bite every time —
   `inputSchema` is a plain object of zod fields (never `z.object()`), and modules may not add
   npm dependencies (use the injected `fetchJson` and Node built-ins).
2. **`station_create_mcp`** — `slug` becomes both the folder name/id and the URL path. This only
   writes a stub from `_template`.
3. **`station_write_file`** — replace `manifest.json`, then `index.js`, then `about.md`. Each write
   hot-reloads every module, and the reply tells you whether the new code imported cleanly. If it
   says `FAILED to load`, fix the content and write the same path again.
4. **`station_configure_mcp`** — fill the settings the manifest declares.
5. **`station_inspect_mcp`** — verify. This runs the module and asks it what tools it has, so it
   reports what the module really does rather than what the source appears to say.

The new MCP is then live at `PUBLIC_URL/<slug>/mcp`.

## Tools

| Tool | What it does |
|---|---|
| `station_guide` | The module contract — folder layout, manifest schema, `registerTool` shape, house rules |
| `station_list_mcps` | All modules: id, slug, enabled, configured, load errors |
| `station_inspect_mcp` | A module's real tools, by running it over an in-memory transport |
| `station_list_files` | Files in a module folder, with sizes |
| `station_read_file` | Read one file (`.js` / `.json` / `.md` / `.txt`, ≤512 KB) |
| `station_get_settings` | Settings schema + current values, secrets masked |
| `station_create_mcp` | Scaffold a new module from `_template` |
| `station_write_file` | Overwrite a file and hot-reload |
| `station_configure_mcp` | Save settings (secrets encrypted at rest) |
| `station_set_enabled` | Serve a module or take it offline |
| `station_delete_mcp` | Move a module to `DATA_DIR/trash` (needs `confirm: true`) |
| `station_reload` | Re-scan `mcps/` and re-import everything |

## Things to know

- **Writes overwrite.** `station_write_file` replaces the whole file; it does not patch. Read
  before you edit.
- **Secrets round-trip.** `station_get_settings` returns `••••••` for a secret that is set. Sending
  that same `••••••` back means *leave unchanged*; sending `''` clears it. Real secret values are
  never returned.
- **It won't touch itself.** `station_write_file`, `station_set_enabled(false)` and
  `station_delete_mcp` all refuse when `id` is `station` — breaking the endpoint you are talking
  through can only be undone from the admin UI.
- **Deletes are soft but not free.** The folder goes to `DATA_DIR/trash`; the registry entry and
  stored settings are dropped. Only call it when the user asked for that module to be deleted.
- **Reaching any of this needs a bearer for `/station`**, exactly like every other endpoint. Give
  the station module its own token rather than the station-wide `MCP_TOKEN` unless you mean to
  hand over everything.
