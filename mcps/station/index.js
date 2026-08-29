/**
 * MCP Station — the station managing itself.
 *
 * Every tool here drives the same mcpHost functions the admin UI drives, handed in as the
 * injected `stationStore`. That means an AI can run the whole loop over MCP: read the module
 * contract, see what is already hosted, scaffold a new module, write its real code, configure
 * its settings, reload and verify — without a browser and without a session cookie.
 *
 * Guard rail: this module refuses to edit, disable or delete ITSELF. Bricking the endpoint you
 * are talking through can only be undone from the admin UI, so those calls are refused with an
 * explanation rather than attempted.
 */

const SELF = 'station';
const MAX_TEXT = 25_000; // house rule: truncate big payloads with a note, never dump

function ok(text, structured) {
  const t = String(text ?? '');
  const body = t.length > MAX_TEXT
    ? `${t.slice(0, MAX_TEXT)}\n\n… truncated at ${MAX_TEXT} chars. Read one file at a time with station_read_file, or narrow the request.`
    : t;
  return structured === undefined
    ? { content: [{ type: 'text', text: body }] }
    : { content: [{ type: 'text', text: body }], structuredContent: structured };
}

const err = (msg) => ({ content: [{ type: 'text', text: `Error: ${msg}` }], isError: true });

/** Refuse anything that would modify the module serving this very request. */
function guardSelf(id, action) {
  if (String(id) === SELF) {
    throw new Error(
      `refusing to ${action} the '${SELF}' module — it is the endpoint you are talking through, and ` +
      'breaking it can only be undone from the admin UI. Do it in MCP Station → ⛽ MCP Station if you really mean to.'
    );
  }
}

/** Reload every module and report whether the one we just touched came back clean. */
async function reloadAndReport(stationStore, id) {
  await stationStore.reload();
  const mod = stationStore.list().find((m) => m.id === id);
  if (!mod) return `Reloaded, but '${id}' is no longer listed — check the folder still has manifest.json + index.js.`;
  if (mod.error) return `Reloaded, but '${id}' FAILED to load: ${mod.error}\nFix the file and write it again.`;
  return `Reloaded — '${id}' loaded cleanly and is live at /${mod.slug}/mcp.`;
}

export function register({ server, z, log, stationStore }) {
  /* ── Learn ──────────────────────────────────────────────────────────── */

  server.registerTool(
    'station_guide',
    {
      title: 'How to build an MCP here',
      description:
        'Return the MCP Station module contract: the two-file folder layout (manifest.json + index.js), the manifest schema and setting types, the registerTool shape, and the house rules for naming, descriptions, schemas, annotations and errors.\n\nArgs: none.\nReturns: markdown.\nCall this FIRST, before station_create_mcp or station_write_file — the contract has rules that are easy to get wrong, notably that inputSchema is a plain object of zod fields (never z.object()) and that modules may not add npm dependencies.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => {
      try { return ok(stationStore.guide()); } catch (e) { return err(e.message); }
    }
  );

  server.registerTool(
    'station_list_mcps',
    {
      title: 'List hosted MCPs',
      description:
        'Every module this station hosts: id, slug, name, icon, version, whether it is enabled, whether its required settings are filled, and any load error.\n\nArgs: none.\nReturns: a markdown table plus the same data as structured JSON.\nThe `id` from here is what every other station_* tool takes. A non-null error means the module failed to import — read its index.js and fix it.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => {
      try {
        const list = stationStore.list();
        if (!list.length) return ok('No modules are installed.', { mcps: [] });
        const rows = list.map((m) =>
          `| ${m.icon} ${m.name} | \`${m.id}\` | /${m.slug} | ${m.enabled ? '✅' : '—'} | ${m.configured ? '✅' : '—'} | ${m.error ? `⚠️ ${m.error}` : ''} |`);
        return ok(
          `| MCP | id | path | enabled | configured | error |\n|---|---|---|---|---|---|\n${rows.join('\n')}`,
          { mcps: list }
        );
      } catch (e) { return err(e.message); }
    }
  );

  server.registerTool(
    'station_inspect_mcp',
    {
      title: 'Inspect an MCP',
      description:
        "What a module can actually do — found by RUNNING it over an in-memory transport and asking it, not by parsing its source, so the answer is the truth.\n\nArgs: id (string, from station_list_mcps).\nReturns: the module's tools with descriptions and input schemas.\nErrors: \"Error: Unknown MCP 'x'\" for a bad id, or \"Error: Module failed to load: …\" when its code throws at import.",
      inputSchema: {
        id: z.string().min(1).describe("Module id, e.g. 'siyuan' (from station_list_mcps)")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ id }) => {
      try {
        const info = await stationStore.inspect(id);
        return ok(jsonBlock(info), info);
      } catch (e) { return err(e.message); }
    }
  );

  /* ── Read ───────────────────────────────────────────────────────────── */

  server.registerTool(
    'station_list_files',
    {
      title: "List a module's files",
      description:
        "Every file in a module's folder, with sizes.\n\nArgs: id (string).\nReturns: paths relative to the module folder — manifest.json, index.js, about.md, instructions.md and so on.\nUse it before station_read_file when you don't know what a module contains.",
      inputSchema: {
        id: z.string().min(1).describe('Module id')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ id }) => {
      try {
        const files = stationStore.files(id);
        return ok(files.map((f) => `- ${f.path} (${f.size} B)`).join('\n') || '(empty)', { files });
      } catch (e) { return err(e.message); }
    }
  );

  server.registerTool(
    'station_read_file',
    {
      title: "Read a module's file",
      description:
        "Read one file out of a module folder.\n\nArgs: id (string), path (string, relative to the module folder, e.g. 'index.js' or 'about.md').\nReturns: the file's text.\nOnly .js / .json / .md / .txt can be read, files over 512 KB are refused, and paths cannot escape the module folder.\nRead index.js before editing it — station_write_file replaces the whole file.",
      inputSchema: {
        id: z.string().min(1).describe('Module id'),
        path: z.string().min(1).default('index.js').describe("File path inside the module folder, e.g. 'index.js'")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ id, path: rel }) => {
      try { return ok(stationStore.read(id, rel)); } catch (e) { return err(e.message); }
    }
  );

  server.registerTool(
    'station_get_settings',
    {
      title: "Read a module's settings",
      description:
        "A module's declared settings — key, label, type, whether it is required, help text, and the current value. Secret values come back as '••••••' when set and '' when not; the real value is never returned.\n\nArgs: id (string).\nReturns: the settings schema with current values, plus whether every required setting is filled.\nCall this before station_configure_mcp so you know which keys exist.",
      inputSchema: {
        id: z.string().min(1).describe('Module id')
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ id }) => {
      try {
        const s = stationStore.settings(id);
        return ok(jsonBlock(s), s);
      } catch (e) { return err(e.message); }
    }
  );

  /* ── Build ──────────────────────────────────────────────────────────── */

  server.registerTool(
    'station_create_mcp',
    {
      title: 'Create a new MCP',
      description:
        "Scaffold a new module folder from the station's _template and load it. This only creates the skeleton — follow it with station_write_file to put the real manifest.json and index.js in place.\n\nArgs: slug (string, becomes both the folder/id and the URL path), name (string), description (string, optional), icon (single emoji, optional).\nReturns: the new id and its endpoint URL path.\nErrors: reserved or already-used slug, or an existing mcps/<slug> folder.\nCall station_guide first — the scaffold is a stub, and the contract tells you what to replace it with.",
      inputSchema: {
        slug: z.string().min(1).regex(/^[a-z0-9_\-]+$/, 'lowercase letters, digits, _ or - only')
          .describe("URL path and folder name, e.g. 'weather_mcp'"),
        name: z.string().min(1).describe("Human name shown on the card, e.g. 'Weather'"),
        description: z.string().default('').describe('One line on what the MCP does'),
        icon: z.string().default('🔌').describe('A single emoji for the card')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ slug, name, description, icon }) => {
      try {
        const { id } = stationStore.create({ name, slug, description, icon });
        const note = await reloadAndReport(stationStore, id);
        log(`created module '${id}'`);
        return ok(
          `Created '${id}' from the template.\n${note}\n\nIt is a STUB. Now write the real files:\n` +
          `1. station_write_file(id: "${id}", path: "manifest.json", …) — real settings\n` +
          `2. station_write_file(id: "${id}", path: "index.js", …) — real tools\n` +
          `3. station_write_file(id: "${id}", path: "about.md", …) — docs, which become the downloadable Skill`,
          { id, slug }
        );
      } catch (e) { return err(e.message); }
    }
  );

  server.registerTool(
    'station_write_file',
    {
      title: "Write a module's file",
      description:
        "Replace a file in a module folder with new content, then hot-reload every module so the change is live immediately — no restart.\n\nArgs: id (string), path (string, e.g. 'index.js'), content (string, the COMPLETE new file — this overwrites, it does not patch).\nReturns: confirmation, and the module's load error if the new code fails to import.\nOnly .js / .json / .md / .txt can be written. If the reply says FAILED to load, fix the content and call again with the same id and path.\nThis module refuses to write to itself.",
      inputSchema: {
        id: z.string().min(1).describe('Module id'),
        path: z.string().min(1).describe("File path inside the module folder, e.g. 'index.js'"),
        content: z.string().describe('The complete new file contents (overwrites, never patches)')
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
    },
    async ({ id, path: rel, content }) => {
      try {
        guardSelf(id, 'write to');
        stationStore.write(id, rel, content);
        log(`wrote ${id}/${rel} (${content.length} B)`);
        return ok(`Wrote ${rel} to '${id}' (${content.length} bytes).\n${await reloadAndReport(stationStore, id)}`);
      } catch (e) { return err(e.message); }
    }
  );

  /* ── Configure ──────────────────────────────────────────────────────── */

  server.registerTool(
    'station_configure_mcp',
    {
      title: 'Configure an MCP',
      description:
        "Set a module's settings — API keys, base URLs, defaults. Secrets are encrypted at rest.\n\nArgs: id (string), values (object of setting key → string value).\nOnly keys declared in the module's manifest are stored; anything else is ignored. Sending '••••••' for a secret leaves it unchanged; sending '' clears it.\nReturns: the settings after the write, secrets masked, and whether the module is now fully configured.\nCall station_get_settings first to learn the keys.",
      inputSchema: {
        id: z.string().min(1).describe('Module id'),
        values: z.record(z.string()).describe("Setting key → value, e.g. { \"api_key\": \"sk-…\", \"base_url\": \"https://…\" }")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
    },
    async ({ id, values }) => {
      try {
        stationStore.configure(id, values);
        const s = stationStore.settings(id);
        log(`configured '${id}' (${Object.keys(values).join(', ') || 'no keys'})`);
        return ok(
          `Saved settings for '${id}'. ${s.configured ? 'All required settings are filled.' : 'Some required settings are still empty.'}\n\n${jsonBlock(s)}`,
          s
        );
      } catch (e) { return err(e.message); }
    }
  );

  server.registerTool(
    'station_set_enabled',
    {
      title: 'Enable or disable an MCP',
      description:
        "Turn a module's endpoint on or off. A disabled module keeps its folder and settings but stops serving at its path.\n\nArgs: id (string), enabled (boolean).\nReturns: confirmation.\nThis module refuses to disable itself.",
      inputSchema: {
        id: z.string().min(1).describe('Module id'),
        enabled: z.boolean().describe('true to serve it, false to take it offline')
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
    },
    async ({ id, enabled }) => {
      try {
        if (!enabled) guardSelf(id, 'disable');
        stationStore.setEnabled(id, enabled);
        log(`${enabled ? 'enabled' : 'disabled'} '${id}'`);
        return ok(`'${id}' is now ${enabled ? 'ENABLED' : 'DISABLED'}.`);
      } catch (e) { return err(e.message); }
    }
  );

  server.registerTool(
    'station_delete_mcp',
    {
      title: 'Delete an MCP',
      description:
        "Remove a module. The folder is moved to DATA_DIR/trash rather than erased, so it can be restored by hand on the server, but its registry entry and stored settings are dropped.\n\nArgs: id (string), confirm (boolean, must be true).\nReturns: confirmation.\nDo not call this unless the user explicitly asked for that module to be deleted. This module refuses to delete itself.",
      inputSchema: {
        id: z.string().min(1).describe('Module id'),
        confirm: z.boolean().default(false).describe('Must be true — proves the deletion was actually asked for')
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async ({ id, confirm }) => {
      try {
        guardSelf(id, 'delete');
        if (!confirm) return err(`refusing to delete '${id}' without confirm: true. Ask the user first, then call again.`);
        stationStore.remove(id);
        await stationStore.reload();
        log(`deleted '${id}'`);
        return ok(`Deleted '${id}'. A copy is in DATA_DIR/trash on the server.`);
      } catch (e) { return err(e.message); }
    }
  );

  server.registerTool(
    'station_reload',
    {
      title: 'Reload all MCPs',
      description:
        'Re-scan the mcps/ folder and re-import every module, picking up code changes without restarting the container.\n\nArgs: none.\nReturns: the module list after reloading, so any load error shows immediately.\nstation_write_file already reloads; call this after editing files on the server by other means.',
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => {
      try {
        await stationStore.reload();
        const list = stationStore.list();
        const broken = list.filter((m) => m.error);
        return ok(
          `Reloaded ${list.length} module${list.length === 1 ? '' : 's'}.` +
          (broken.length ? `\n\n⚠️ Failed to load:\n${broken.map((m) => `- ${m.id}: ${m.error}`).join('\n')}` : '\nAll loaded cleanly.'),
          { mcps: list }
        );
      } catch (e) { return err(e.message); }
    }
  );
}

function jsonBlock(o) {
  return '```json\n' + JSON.stringify(o, null, 2) + '\n```';
}
