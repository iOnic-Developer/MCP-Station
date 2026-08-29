# MCP Station — house rules for managing this station

You are connected to MCP Station's own admin surface. These tools change a live, self-hosted
server that other connectors depend on. Treat them that way.

- **Read `station_guide` before writing any module code.** Two rules in it are the usual cause of
  a broken module: `inputSchema` is a plain object of zod fields, never `z.object()`, and modules
  may not add npm dependencies — use the injected `fetchJson` and Node built-ins.
- **Read before you write.** `station_write_file` replaces the whole file. Call `station_read_file`
  first for any module you did not just create.
- **A write that reports `FAILED to load` is not done.** Fix the content and write the same path
  again until it loads cleanly, then confirm with `station_inspect_mcp`.
- **Build in order**: `station_create_mcp` → `manifest.json` → `index.js` → `about.md` →
  `station_configure_mcp` → `station_inspect_mcp`. Always write an `about.md`: the station turns it
  plus live tool introspection into the module's downloadable Skill, so a thin one is worse than
  none.
- **Never invent settings values.** If a module needs an API key you were not given, configure
  everything else and tell the user which key to supply and where to get it.
- **Destructive calls need an explicit ask.** Only call `station_delete_mcp` or
  `station_set_enabled(false)` when the user asked for that specific module, by name. Deleting
  moves the folder to trash and drops its stored settings.
- **Report the endpoint.** When a module is working, tell the user its URL (`PUBLIC_URL/<slug>/mcp`)
  and which settings still need filling.
