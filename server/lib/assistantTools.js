/**
 * Real tools for the ✦ assistant — it CREATES modules, EDITS their files in place and reloads
 * the station instead of pasting code into chat. Tool schemas are Anthropic-shaped;
 * assistant.js translates them for Gemini. Results are plain JSON objects the model can read
 * back, plus two hints the UI acts on: `modulesChanged` (refresh the cards) and `fileChanged`
 * (refresh that file's tab in the open code editor).
 *
 * Why an edit tool and not just "write the whole file": a bundled module's index.js runs to
 * 70 KB (~18k tokens). Reproducing it to change three lines is slow, expensive, and — past the
 * model's output cap — silently truncated. A find/replace edit is the size of the change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './env.js';
import {
  ManifestSchema, RESERVED_SLUGS, loadModules, getModules, getModuleById, readModuleFile, writeModuleFile
} from './mcpHost.js';
import { log } from './log.js';

const READ_MAX_LINES = 1500;

const FILE_ARGS = {
  id: { type: 'string', description: "Module id (its folder name). Inside a module's own chat this defaults to that module — omit it there." },
  path: { type: 'string', description: "File path inside the module folder: 'index.js', 'manifest.json', 'about.md', 'instructions.md'" }
};

export const ASSISTANT_TOOLS = [
  {
    name: 'create_module',
    description:
      'Create a NEW MCP module ON THIS STATION and hot-reload it, making it live immediately. ' +
      'Writes mcps/<id>/manifest.json, index.js and about.md (and instructions.md if given). Use this instead of ' +
      'pasting code into the chat whenever the user asks you to build a module. If the result reports ' +
      'a load error, fix the code and call again with the SAME id. Files must be COMPLETE contents. ' +
      'For a module that already exists use edit_module_file / write_module_file — never re-send an existing module through this tool.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Folder name, lowercase [a-z0-9_-], usually equal to the manifest slug (e.g. "gmail")' },
        manifest_json: { type: 'string', description: 'Complete manifest.json: { id, slug, name, description, icon, version, settings[] }' },
        index_js: { type: 'string', description: 'Complete index.js: export function register({ server, z, getSettings, log, fetchJson })' },
        about_md: { type: 'string', description: 'Complete about.md — human docs for this module: what it is, what it is for, each tool and how to use it, settings to fill, gotchas. Always write this; it is the source for the downloadable Claude skill.' },
        instructions_md: { type: 'string', description: 'Optional instructions.md served to MCP clients at initialize' }
      },
      required: ['id', 'manifest_json', 'index_js', 'about_md']
    }
  },
  {
    name: 'read_module_file',
    description:
      'Read one file (or a line range of it) from a module folder ON THIS STATION. Use it when the source in your ' +
      'context is marked truncated, to re-check a region after an edit, or to see a file you were not given. ' +
      `Returns the text plus the total line count; at most ${READ_MAX_LINES} lines per call.`,
    input_schema: {
      type: 'object',
      properties: {
        ...FILE_ARGS,
        start_line: { type: 'integer', minimum: 1, description: 'First line to return (1-based, default 1)' },
        end_line: { type: 'integer', minimum: 1, description: 'Last line to return, inclusive (default: end of file)' }
      },
      required: ['path']
    }
  },
  {
    name: 'edit_module_file',
    description:
      'Make a targeted change to ONE file of an existing module ON THIS STATION: replaces `find` with `replace`, ' +
      'writes the file and hot-reloads the module. `find` must match the CURRENT file text exactly (whitespace included) ' +
      'and exactly once — include enough surrounding lines to make it unique, or set all:true to replace every occurrence. ' +
      'Prefer this over rewriting whole files: it works on any size of file and cannot be cut off by the output limit. ' +
      'The result says whether the module still loads; if it reports a load error, fix it with another edit.',
    input_schema: {
      type: 'object',
      properties: {
        ...FILE_ARGS,
        find: { type: 'string', description: 'Exact text to replace — must occur in the current file' },
        replace: { type: 'string', description: 'Replacement text (an empty string deletes the match)' },
        all: { type: 'boolean', description: 'Replace every occurrence instead of requiring a unique match (default false)' }
      },
      required: ['path', 'find', 'replace']
    }
  },
  {
    name: 'write_module_file',
    description:
      'Write the COMPLETE contents of one file in an existing module ON THIS STATION (creating the file if needed) and ' +
      'hot-reload the module. Use it for new files (about.md, instructions.md), small files, or a genuine whole-file ' +
      'rewrite. For a change inside a large file use edit_module_file instead. manifest.json is validated before it is written.',
    input_schema: {
      type: 'object',
      properties: {
        ...FILE_ARGS,
        content: { type: 'string', description: 'The full new file contents' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'reload_modules',
    description: 'Re-scan the mcps/ folder and hot-reload every module. Returns each module id, slug and load status. Use after any module change, or when the user asks to reload.',
    input_schema: { type: 'object', properties: {} }
  }
];

const modulesSummary = () =>
  [...getModules().values()].map((m) => ({
    id: m.id,
    slug: m.manifest?.slug || m.id,
    status: m.error ? `LOAD ERROR: ${m.error}` : 'ok'
  }));

/** Which module a file tool acts on. Inside a module's chat the tool is pinned to that module. */
function resolveId(args, scopeId) {
  const id = String(args.id || scopeId || '').trim();
  if (!id) throw new Error('id is required — say which module (its folder name)');
  if (scopeId && id !== scopeId) {
    throw new Error(`This chat is scoped to module '${scopeId}' and cannot touch '${id}' — use the ✦ station popup for other modules`);
  }
  if (!getModuleById(id)) throw new Error(`Unknown module '${id}'`);
  return id;
}

/** Normalise a module-relative path. Station-managed dot-files are never editable. */
function relPath(raw) {
  const rel = String(raw || '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  if (!rel) throw new Error('path is required');
  if (rel.split('/').some((seg) => seg.startsWith('.')) || rel.includes('node_modules')) {
    throw new Error('Dot-files (.config.json, .chat.json) are station-managed and not editable');
  }
  return rel;
}

/** Hot-reload after a write and say whether the module came back. */
async function reloadStatus(id) {
  await loadModules();
  const mod = getModuleById(id);
  return mod?.error
    ? { ok: false, load_error: mod.error, hint: 'The module failed to load with this change — fix it (another edit) until it loads.' }
    : { ok: true, loaded: true };
}

const lineCount = (s) => s.split('\n').length;

export async function execAssistantTool(name, args = {}, { scopeId = '' } = {}) {
  try {
    if (name === 'reload_modules') {
      await loadModules();
      return { ok: true, modulesChanged: true, modules: modulesSummary() };
    }

    if (name === 'read_module_file') {
      const id = resolveId(args, scopeId);
      const rel = relPath(args.path);
      const content = readModuleFile(id, rel);
      const lines = content.split('\n');
      const start = Math.min(Math.max(1, Number(args.start_line) || 1), lines.length);
      const end = Math.min(lines.length, Number(args.end_line) || lines.length, start + READ_MAX_LINES - 1);
      return {
        ok: true,
        path: rel,
        total_lines: lines.length,
        start_line: start,
        end_line: end,
        content: lines.slice(start - 1, end).join('\n'),
        ...(end < lines.length ? { note: `Lines ${end + 1}-${lines.length} not shown — call again with start_line: ${end + 1}` } : {})
      };
    }

    if (name === 'edit_module_file') {
      const id = resolveId(args, scopeId);
      const rel = relPath(args.path);
      const find = String(args.find ?? '');
      const replace = String(args.replace ?? '');
      if (!find) return { error: 'find must not be empty' };
      if (find === replace) return { error: 'find and replace are identical — nothing to do' };
      const current = readModuleFile(id, rel);
      const count = current.split(find).length - 1;
      if (!count) {
        return { error: `find text not found in ${rel}. It must match the CURRENT file exactly, whitespace included — call read_module_file to see the region as it is now.` };
      }
      if (count > 1 && !args.all) {
        return { error: `find matches ${count} places in ${rel} — include more surrounding lines so it matches exactly once, or pass all: true.` };
      }
      const line = lineCount(current.slice(0, current.indexOf(find)));
      // Function replacer: a string replacement would interpret `$&`/`$1` in the model's code.
      const next = args.all ? current.split(find).join(replace) : current.replace(find, () => replace);
      writeModuleFile(id, rel, next);
      const status = await reloadStatus(id);
      log('assistant', `Edited ${id}/${rel} at line ${line} via assistant tool (${count} replacement${count > 1 ? 's' : ''}) — ${status.load_error ? 'LOAD ERROR: ' + status.load_error : 'loaded OK'}`);
      return { ...status, path: rel, replaced: count, line, total_lines: lineCount(next), modulesChanged: true, fileChanged: { id, path: rel } };
    }

    if (name === 'write_module_file') {
      const id = resolveId(args, scopeId);
      const rel = relPath(args.path);
      const content = String(args.content ?? '');
      const existed = fs.existsSync(path.join(getModuleById(id).dir, rel));
      writeModuleFile(id, rel, content);
      const status = await reloadStatus(id);
      log('assistant', `${existed ? 'Rewrote' : 'Created'} ${id}/${rel} via assistant tool — ${status.load_error ? 'LOAD ERROR: ' + status.load_error : 'loaded OK'}`);
      return { ...status, path: rel, created: !existed, total_lines: lineCount(content), modulesChanged: true, fileChanged: { id, path: rel } };
    }

    if (name === 'create_module') {
      const id = String(args.id || '').trim().toLowerCase();
      if (!/^[a-z0-9_\-]+$/.test(id)) return { error: 'id must be lowercase [a-z0-9_-]' };
      if (id.startsWith('_') || id.startsWith('.')) return { error: 'id must not start with _ or .' };
      if (scopeId && id !== scopeId) return { error: `This chat is scoped to module '${scopeId}' — create new modules from the ✦ station popup` };

      let manifest;
      try { manifest = ManifestSchema.parse(JSON.parse(String(args.manifest_json))); }
      catch (e) { return { error: `manifest.json invalid: ${e.message}` }; }
      if (RESERVED_SLUGS.has(manifest.slug)) return { error: `slug '${manifest.slug}' is a reserved path — pick another` };
      const clash = [...getModules().values()].find((m) => m.manifest?.slug === manifest.slug && m.id !== id);
      if (clash) return { error: `slug '${manifest.slug}' is already used by module '${clash.id}'` };
      if (!String(args.index_js || '').includes('register')) return { error: 'index_js must export a register() function' };

      const dir = path.join(cfg.mcpsDir, id);
      const existed = fs.existsSync(dir);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
      fs.writeFileSync(path.join(dir, 'index.js'), String(args.index_js));
      if (args.about_md != null) fs.writeFileSync(path.join(dir, 'about.md'), String(args.about_md));
      if (args.instructions_md != null) fs.writeFileSync(path.join(dir, 'instructions.md'), String(args.instructions_md));

      await loadModules();
      const mod = getModuleById(manifest.id) || getModuleById(id);
      const base = cfg.publicUrl || 'http://localhost:' + cfg.port;
      log('assistant', `${existed ? 'Updated' : 'Created'} module '${id}' via assistant tool — ${mod?.error ? 'LOAD ERROR: ' + mod.error : 'loaded OK'}`);
      return mod?.error
        ? { ok: false, existed, modulesChanged: true, load_error: mod.error, hint: 'Fix the file and call create_module again with the same id.' }
        : {
            ok: true,
            existed,
            modulesChanged: true,
            id: mod.id,
            slug: mod.manifest.slug,
            url: `${base}/${mod.manifest.slug}/mcp`,
            settings_needed: mod.manifest.settings.filter((s) => s.required).map((s) => s.key),
            note: 'Module is live. Tell the user the connector URL and which settings to fill in the UI.'
          };
    }

    return { error: `Unknown tool '${name}'` };
  } catch (e) {
    return { error: e.message };
  }
}
