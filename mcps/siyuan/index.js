/**
 * SiYuan MCP — 19 tools over the SiYuan kernel HTTP API.
 * Ported from the SiYuan Companion (lib/tools.mjs); the house style it used to serve
 * as MCP `instructions` now lives in instructions.md next door, which the station
 * hands to every client at initialize().
 *
 * Settings: siyuan_url (required), siyuan_token (required).
 */
const CHARACTER_LIMIT = 25000;

// A browser User-Agent avoids Cloudflare bot-fight (error 1010) blocking Node's default
// signature. Remove it and every call dies behind Cloudflare — this is not cargo cult.
const SY_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// SiYuan answers HTTP 200 with a non-zero code for app errors; some are transient (kernel
// reindexing/syncing/db locked) and worth retrying. Anything else throws on the first attempt.
const TRANSIENT = /query notebook failed|busy|locked|reindex|syncing|database is locked|timeout/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sqlEsc = (s) => String(s).replace(/'/g, "''");

async function siyuan(cfg, endpoint, body = {}, attempt = 0) {
  if (!cfg.url || !cfg.token) {
    throw new Error('SiYuan is not configured — open MCP Station → SiYuan → Settings and set the URL and API token.');
  }
  const r = await fetch(`${cfg.url}/api/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${cfg.token}`,
      'Content-Type': 'application/json',
      'User-Agent': SY_UA
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });

  if ((r.status === 403 || r.status === 429 || r.status >= 500) && attempt < 3) {
    await sleep(500 * (attempt + 1));
    return siyuan(cfg, endpoint, body, attempt + 1);
  }

  let j;
  try { j = await r.json(); }
  catch { throw new Error(`SiYuan ${endpoint}: non-JSON response (HTTP ${r.status})`); }

  if (j.code !== 0) {
    if (attempt < 3 && TRANSIENT.test(j.msg || '')) {
      await sleep(700 * (attempt + 1));
      return siyuan(cfg, endpoint, body, attempt + 1);
    }
    throw new Error(`SiYuan ${endpoint}: ${j.msg || 'code ' + j.code}`);
  }
  return j.data;
}

async function exec(cfg, name, a = {}) {
  switch (name) {
    case 'set_block_attrs':
      return siyuan(cfg, 'attr/setBlockAttrs', { id: a.id, attrs: a.attrs || {} });

    case 'list_notebooks': {
      const d = await siyuan(cfg, 'notebook/lsNotebooks');
      return (d.notebooks || []).map((n) => ({ id: n.id, name: n.name }));
    }

    case 'sql':
      return siyuan(cfg, 'query/sql', { stmt: a.stmt });

    case 'search_text':
      return siyuan(cfg, 'query/sql', {
        stmt: `SELECT id, type, content, hpath, box FROM blocks WHERE content LIKE '%${sqlEsc(a.query || '')}%' ORDER BY updated DESC LIMIT 30`
      });

    case 'read_doc': {
      const d = await siyuan(cfg, 'export/exportMdContent', { id: a.id });
      return { hpath: d.hPath, content: d.content };
    }

    case 'create_doc': {
      const id = await siyuan(cfg, 'filetree/createDocWithMd', { notebook: a.notebook, path: a.path, markdown: a.markdown });
      return { id, notebook: a.notebook, hpath: a.path };
    }

    case 'create_notebook': {
      const d = await siyuan(cfg, 'notebook/createNotebook', { name: a.name });
      return d.notebook;
    }

    case 'append_blocks':
      return siyuan(cfg, 'block/appendBlock', { dataType: 'markdown', data: a.markdown, parentID: a.parent_id });

    case 'prepend_blocks':
      return siyuan(cfg, 'block/prependBlock', { dataType: 'markdown', data: a.markdown, parentID: a.parent_id });

    case 'update_block':
      return siyuan(cfg, 'block/updateBlock', { dataType: 'markdown', data: a.markdown, id: a.id });

    case 'insert_blocks': {
      const body = { dataType: 'markdown', data: a.markdown };
      if (a.previous_id) body.previousID = a.previous_id;
      if (a.next_id) body.nextID = a.next_id;
      if (a.parent_id) body.parentID = a.parent_id;
      return siyuan(cfg, 'block/insertBlock', body);
    }

    case 'delete_block':
      return siyuan(cfg, 'block/deleteBlock', { id: a.id });

    case 'rename_doc':
      return siyuan(cfg, 'filetree/renameDoc', { notebook: a.notebook, path: a.path, title: a.title });

    case 'move_docs':
      return siyuan(cfg, 'filetree/moveDocs', { fromPaths: a.from_paths, toNotebook: a.to_notebook, toPath: a.to_path });

    case 'remove_doc':
      return siyuan(cfg, 'filetree/removeDoc', { notebook: a.notebook, path: a.path });

    case 'replace_doc': {
      // ponytail: delete top-level children then append — SiYuan's own history/sync is the safety net
      // if the append half fails. Keeps the doc id so ((id "…")) references keep resolving.
      let id = a.id;
      if (!id && a.hpath) {
        const rows = await siyuan(cfg, 'query/sql', { stmt: `SELECT id FROM blocks WHERE type='d' AND hpath='${sqlEsc(a.hpath)}' LIMIT 1` });
        id = rows && rows[0] && rows[0].id;
      }
      if (!id) throw new Error('replace_doc: provide id, or an hpath that resolves to a doc');
      const children = await siyuan(cfg, 'block/getChildBlocks', { id });
      for (const c of children || []) await siyuan(cfg, 'block/deleteBlock', { id: c.id });
      if (a.markdown && String(a.markdown).trim()) {
        await siyuan(cfg, 'block/appendBlock', { dataType: 'markdown', data: a.markdown, parentID: id });
      }
      return { id, replacedBlocks: (children || []).length };
    }

    case 'update_blocks': {
      const blocks = Array.isArray(a.blocks) ? a.blocks : [];
      const updated = [];
      for (const b of blocks) {
        await siyuan(cfg, 'block/updateBlock', { dataType: 'markdown', data: b.markdown, id: b.id });
        updated.push(b.id);
      }
      return { updated };
    }

    case 'tree': {
      const where = a.notebook ? `AND box='${sqlEsc(a.notebook)}'` : '';
      return siyuan(cfg, 'query/sql', { stmt: `SELECT id, box, hpath FROM blocks WHERE type='d' ${where} ORDER BY hpath LIMIT 500` });
    }

    case 'find_orphans':
      return siyuan(cfg, 'query/sql', {
        stmt: `SELECT id, box, hpath FROM blocks WHERE type='d' AND id NOT IN (SELECT root_id FROM refs) AND id NOT IN (SELECT def_block_root_id FROM refs) ORDER BY hpath LIMIT 200`
      });

    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

export function register({ server, z, getSettings, log }) {
  const conf = () => {
    const s = getSettings();
    return { url: String(s.siyuan_url || '').replace(/\/+$/, ''), token: s.siyuan_token || '' };
  };

  // inputSchema is a PLAIN OBJECT of zod fields — never z.object() (the SDK wraps the raw shape).
  const TOOLS = [
    ['set_block_attrs',
      "Set attributes on a block/doc by id. Use 'alias' (comma-separated alternative names — strongly boosts search, e.g. 'DannyNAS, TrueNAS box, primary NAS'), 'memo' (hover note), 'name' (block name), 'bookmark'. Aliases are how 'search nas' surfaces the right device. Pass attrs as an object.",
      { id: z.string(), attrs: z.record(z.string()).describe('e.g. {"alias":"DannyNAS, primary NAS","memo":"Main TrueNAS box"}') }],

    ['list_notebooks',
      'List all SiYuan notebooks with their id and name. Call this first to resolve a notebook name to its id.',
      {}],

    ['sql',
      "Run a read-only SQL query against the SiYuan block database and return rows. Use to locate docs, audit structure, or fetch the storage 'path' and 'box' needed by rename/move/remove. Documents are rows in 'blocks' where type='d'. Useful columns: id, box (notebook id), path (storage .sy path), hpath (human path), content (title), updated.",
      { stmt: z.string().describe("A SELECT statement, e.g. SELECT id, box, path, hpath, content FROM blocks WHERE type='d' AND hpath='/Devices/NAS/Title'") }],

    ['search_text',
      'Full-text-ish search: returns up to 30 blocks whose content contains the query string, most recently updated first.',
      { query: z.string() }],

    ['read_doc',
      'Return the full markdown content and hpath of a document, given its block id.',
      { id: z.string() }],

    ['create_doc',
      'Create a document from markdown. Missing parent docs in the hpath are created automatically (e.g. path \'/Devices/NAS/Title\' creates Devices and NAS as parents). Avoid \'/\' inside a title segment. Returns the new doc id. After creating, follow the house style in the server instructions: set tags/alias/memo and wire a real ((id "Title")) reference so the page is not an orphan.',
      {
        notebook: z.string().describe('Notebook id (from list_notebooks)'),
        path: z.string().describe('Human path including the new doc title, e.g. /Devices/NAS/My Title'),
        markdown: z.string().describe('Full markdown body of the document')
      }],

    ['create_notebook',
      'Create a new notebook by name. Returns its id and name.',
      { name: z.string() }],

    ['append_blocks',
      'Append markdown blocks to the END of a document or block, given the parent block/doc id.',
      { parent_id: z.string(), markdown: z.string() }],

    ['prepend_blocks',
      'Insert markdown blocks at the START of a document or block, given the parent block/doc id.',
      { parent_id: z.string(), markdown: z.string() }],

    ['update_block',
      'Replace the markdown content of a single block, given its id.',
      { id: z.string(), markdown: z.string() }],

    ['insert_blocks',
      'Insert markdown blocks relative to a sibling (previous_id / next_id) or inside a parent (parent_id).',
      {
        markdown: z.string(),
        previous_id: z.string().optional(),
        next_id: z.string().optional(),
        parent_id: z.string().optional()
      }],

    ['delete_block',
      'Delete a block (or whole document) by its id. Irreversible.',
      { id: z.string() }],

    ['rename_doc',
      'Rename a document\'s title. Needs the notebook id and the storage .sy path (get both via sql).',
      { notebook: z.string(), path: z.string(), title: z.string() }],

    ['move_docs',
      "Move documents to another location. from_paths are storage .sy paths; to_notebook is the destination notebook id; to_path is the destination parent storage path ('/' for notebook root).",
      { from_paths: z.array(z.string()), to_notebook: z.string(), to_path: z.string() }],

    ['remove_doc',
      'Delete a document by notebook id + storage .sy path. Irreversible.',
      { notebook: z.string(), path: z.string() }],

    ['replace_doc',
      'Replace a whole document\'s body in ONE call, preserving its id so block references survive. Give either id or hpath, plus the full new markdown. Strongly prefer this over many update_block calls when rewriting a page.',
      {
        id: z.string().optional(),
        hpath: z.string().optional().describe('human path, used to resolve the doc if id is omitted'),
        markdown: z.string()
      }],

    ['update_blocks',
      'Apply several block edits in one call. Pass blocks = array of {id, markdown}. Cheaper than many update_block calls.',
      { blocks: z.array(z.object({ id: z.string(), markdown: z.string() })) }],

    ['tree',
      'Return a compact outline (id, notebook box, hpath) of all documents, optionally scoped to one notebook. Use to decide where a topic belongs without many probing queries.',
      { notebook: z.string().optional().describe('optional notebook id to scope to') }],

    ['find_orphans',
      'List documents with no block references in either direction (no incoming and no outgoing). Use in the verify step to wire orphans into the graph.',
      {}]
  ];

  for (const [name, description, inputSchema] of TOOLS) {
    server.registerTool(name, { description, inputSchema }, async (args) => {
      try {
        const data = await exec(conf(), name, args || {});
        let text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        if (text.length > CHARACTER_LIMIT) {
          text = text.slice(0, CHARACTER_LIMIT) + `\n\n[Truncated at ${CHARACTER_LIMIT} chars — narrow the query (LIMIT, scope to a notebook) for the rest]`;
        }
        return { content: [{ type: 'text', text }] };
      } catch (e) {
        // Returned, not thrown: the model sees the failure and can adapt instead of the transport dying.
        log(`${name} failed: ${e.message}`);
        return { content: [{ type: 'text', text: `ERROR: ${e.message}` }], isError: true };
      }
    });
  }

  server.registerPrompt(
    'add-to-siyuan',
    {
      title: 'Add to SiYuan',
      description: 'Ingest content into the knowledge base to the house style: survey → one home → standard page anatomy → real block refs → tags/alias/memo → verify.',
      argsSchema: { section: z.string().optional().describe('Optional area/notebook hint, e.g. "personal", "homelab"') }
    },
    ({ section }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            'Add the content we just discussed to SiYuan, following the KB house style in your server instructions exactly.',
            section ? `It belongs in the "${section}" area — map that to the right notebook.` : '',
            'Steps: survey with list_notebooks + tree; give it exactly ONE home; write the page with the standard anatomy;',
            'wire real ((id "Title")) refs both ways so it is not an orphan; set tags + alias + memo via set_block_attrs;',
            'then verify with sql (no orphans, no untagged docs, no dead refs) and report what you created.'
          ].filter(Boolean).join('\n')
        }
      }]
    })
  );

  server.registerPrompt(
    'audit-siyuan',
    {
      title: 'Audit SiYuan',
      description: 'Read-only health check of the knowledge base: orphans, untagged docs, dead refs, duplicates, unformatted code → prioritised fix list. Changes nothing.',
      argsSchema: {}
    },
    () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            'Audit my SiYuan knowledge base against the house style. READ ONLY — do not change anything.',
            'Run find_orphans, then use sql to find: docs with no tags, dead/dangling refs, duplicate content, and unformatted code.',
            'Report a prioritised fix list (worst first) with the doc ids, and say what you would run to fix each. Do not run it.'
          ].join('\n')
        }
      }]
    })
  );
}

/** Connectivity check for the Test button on the station card. */
export async function test(settings) {
  const cfg = { url: String(settings.siyuan_url || '').replace(/\/+$/, ''), token: settings.siyuan_token || '' };
  if (!cfg.url || !cfg.token) return { ok: false, message: 'Set the SiYuan URL and API token first.' };
  const notebooks = await exec(cfg, 'list_notebooks');
  return { ok: true, message: `✓ Reached ${cfg.url} — ${notebooks.length} notebook(s): ${notebooks.map((n) => n.name).join(', ').slice(0, 120)}` };
}
