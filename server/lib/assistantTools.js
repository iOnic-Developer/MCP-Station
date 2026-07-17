/**
 * Real tools for the ✦ assistant — it CREATES modules and reloads the station instead of
 * pasting code into chat. Tool schemas are Anthropic-shaped; assistant.js translates them
 * for Gemini. Results are plain JSON objects the model can read back.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './env.js';
import { ManifestSchema, RESERVED_SLUGS, loadModules, getModules, getModuleById } from './mcpHost.js';
import { log } from './log.js';

export const ASSISTANT_TOOLS = [
  {
    name: 'create_module',
    description:
      'Create or update an MCP module ON THIS STATION and hot-reload it, making it live immediately. ' +
      'Writes mcps/<id>/manifest.json, index.js and about.md (and instructions.md if given). Use this instead of ' +
      'pasting code into the chat whenever the user asks you to build/fix a module. If the result reports ' +
      'a load error, fix the code and call again with the SAME id. Files must be COMPLETE contents.',
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

export async function execAssistantTool(name, args = {}) {
  try {
    if (name === 'reload_modules') {
      await loadModules();
      return { ok: true, modulesChanged: true, modules: modulesSummary() };
    }

    if (name === 'create_module') {
      const id = String(args.id || '').trim().toLowerCase();
      if (!/^[a-z0-9_\-]+$/.test(id)) return { error: 'id must be lowercase [a-z0-9_-]' };
      if (id.startsWith('_') || id.startsWith('.')) return { error: 'id must not start with _ or .' };

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
