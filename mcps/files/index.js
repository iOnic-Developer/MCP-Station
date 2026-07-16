/**
 * Files MCP — jailed file storage so Claude can save and retrieve things.
 * Every path is relative to ONE root folder (setting `root_dir`, default /files);
 * absolute paths, drive letters, `..` escapes and symlink escapes are refused.
 * Map a host folder to the root in Docker to choose where files actually live.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_READ_CHARS = 200_000;    // read_file returns at most this much text
const MAX_WRITE_BYTES = 3_000_000; // keep writes under the station's request body limit
const MAX_LIST = 500;              // entries per listing

function root(settings) {
  return path.resolve(settings.root_dir || '/files');
}

/** Resolve a user-supplied relative path inside the jail, or throw. */
function jail(rootAbs, p) {
  const rel = String(p ?? '').trim();
  if (/^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith('/') || rel.startsWith('\\')) {
    throw new Error('Use a path RELATIVE to the root folder (e.g. "notes/todo.md"), not an absolute path.');
  }
  const abs = path.resolve(rootAbs, rel);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
    throw new Error('Path escapes the root folder — stay inside it.');
  }
  return abs;
}

/** Symlinks inside the root could point outside it — re-check the REAL location too. */
async function realJail(rootAbs, abs) {
  let probe = abs;
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      const realRoot = await fs.realpath(rootAbs).catch(() => rootAbs);
      const tail = path.relative(probe, abs); // '' when probe === abs
      const realAbs = tail ? path.join(real, tail) : real;
      if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) {
        throw new Error('Path resolves outside the root folder (symlink escape refused).');
      }
      return abs;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const parent = path.dirname(probe);
      if (parent === probe) return abs; // filesystem root — nothing real to check
      probe = parent; // walk up to the nearest existing ancestor
    }
  }
}

const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const ok = (text) => ({ content: [{ type: 'text', text }] });
const fail = (e) => ({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });

export function register({ server, z, getSettings }) {
  const resolve = async (p) => {
    const r = root(getSettings());
    return { rootAbs: r, abs: await realJail(r, jail(r, p)) };
  };

  server.registerTool(
    'list_files',
    {
      title: 'List files',
      description: 'List files and folders inside the root folder. Args: path (optional subfolder, default the root), recursive (optional, default false). Returns name, type, size and modified time per entry.',
      inputSchema: {
        path: z.string().default('').describe('Subfolder to list, relative to the root ("" = root)'),
        recursive: z.boolean().default(false).describe('Walk subfolders too (depth-limited)')
      },
      annotations: { readOnlyHint: true }
    },
    async ({ path: p, recursive }) => {
      try {
        const { rootAbs, abs } = await resolve(p);
        const rows = [];
        async function walk(dir, depth) {
          if (rows.length >= MAX_LIST || depth > 4) return;
          let entries;
          try { entries = await fs.readdir(dir, { withFileTypes: true }); }
          catch (e) {
            if (e.code === 'ENOENT' && dir === rootAbs) throw new Error(`Root folder ${rootAbs} does not exist yet — map a host folder to it in Docker (it is created automatically on first write).`);
            throw e;
          }
          for (const d of entries) {
            if (rows.length >= MAX_LIST) return;
            const full = path.join(dir, d.name);
            const st = await fs.stat(full).catch(() => null);
            rows.push({
              path: path.relative(rootAbs, full).replaceAll('\\', '/'),
              type: d.isDirectory() ? 'dir' : 'file',
              size: d.isDirectory() ? '' : fmtSize(st?.size ?? 0),
              modified: st ? st.mtime.toISOString().slice(0, 16).replace('T', ' ') : ''
            });
            if (recursive && d.isDirectory()) await walk(full, depth + 1);
          }
        }
        await walk(abs, 0);
        if (!rows.length) return ok('(empty)');
        const lines = rows.map((r) => `${r.type === 'dir' ? '📁' : '📄'} ${r.path}${r.size ? `  (${r.size}, ${r.modified})` : ''}`);
        return ok(lines.join('\n') + (rows.length >= MAX_LIST ? `\n… truncated at ${MAX_LIST} entries` : ''));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    'read_file',
    {
      title: 'Read file',
      description: `Read a text file from the root folder. Returns up to ${MAX_READ_CHARS.toLocaleString()} characters (truncated with a note beyond that). Binary files are reported, not dumped.`,
      inputSchema: { path: z.string().min(1).describe('File path relative to the root') },
      annotations: { readOnlyHint: true }
    },
    async ({ path: p }) => {
      try {
        const { abs } = await resolve(p);
        const buf = await fs.readFile(abs);
        if (buf.includes(0)) return ok(`(binary file, ${fmtSize(buf.length)} — not shown)`);
        const text = buf.toString('utf8');
        return ok(text.length > MAX_READ_CHARS ? text.slice(0, MAX_READ_CHARS) + `\n\n… truncated (${fmtSize(buf.length)} total)` : text);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    'write_file',
    {
      title: 'Write file',
      description: 'Write a text file inside the root folder (parent folders are created automatically). Overwrites by default; pass append=true to add to the end instead. This is how you SAVE things for the user.',
      inputSchema: {
        path: z.string().min(1).describe('File path relative to the root, e.g. "notes/2026-07-16 meeting.md"'),
        content: z.string().describe('The full text content to write'),
        append: z.boolean().default(false).describe('Append instead of overwrite')
      },
      annotations: { destructiveHint: true }
    },
    async ({ path: p, content, append }) => {
      try {
        if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) throw new Error(`Content too large (max ${fmtSize(MAX_WRITE_BYTES)}) — split it into parts with append=true.`);
        const { rootAbs, abs } = await resolve(p);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        if (append) await fs.appendFile(abs, content, 'utf8');
        else await fs.writeFile(abs, content, 'utf8');
        const st = await fs.stat(abs);
        return ok(`${append ? 'Appended to' : 'Saved'} ${path.relative(rootAbs, abs).replaceAll('\\', '/')} (${fmtSize(st.size)}).`);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    'move_file',
    {
      title: 'Move / rename',
      description: 'Move or rename a file or folder inside the root folder (destination parents are created automatically).',
      inputSchema: {
        from: z.string().min(1).describe('Current path relative to the root'),
        to: z.string().min(1).describe('New path relative to the root')
      },
      annotations: { destructiveHint: true }
    },
    async ({ from, to }) => {
      try {
        const a = await resolve(from);
        const b = await resolve(to);
        await fs.mkdir(path.dirname(b.abs), { recursive: true });
        await fs.rename(a.abs, b.abs);
        return ok(`Moved ${from} → ${to}`);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    'make_dir',
    {
      title: 'Create folder',
      description: 'Create a folder (and any missing parents) inside the root folder.',
      inputSchema: { path: z.string().min(1).describe('Folder path relative to the root') },
      annotations: {}
    },
    async ({ path: p }) => {
      try {
        const { abs } = await resolve(p);
        await fs.mkdir(abs, { recursive: true });
        return ok(`Created folder ${p}`);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    'delete_file',
    {
      title: 'Delete',
      description: 'Delete a file or an EMPTY folder inside the root folder. Refuses non-empty folders on purpose — move or empty them first.',
      inputSchema: { path: z.string().min(1).describe('Path relative to the root') },
      annotations: { destructiveHint: true, idempotentHint: false }
    },
    async ({ path: p }) => {
      try {
        const { abs } = await resolve(p);
        const st = await fs.stat(abs);
        if (st.isDirectory()) await fs.rmdir(abs); // throws ENOTEMPTY on non-empty — by design
        else await fs.unlink(abs);
        return ok(`Deleted ${p}`);
      } catch (e) {
        if (e.code === 'ENOTEMPTY') return fail(new Error('Folder is not empty — delete or move its contents first.'));
        return fail(e);
      }
    }
  );
}

export async function test(settings) {
  const r = root(settings);
  try {
    await fs.mkdir(r, { recursive: true });
    const probe = path.join(r, '.station-write-test');
    await fs.writeFile(probe, 'ok');
    await fs.unlink(probe);
    return { ok: true, message: `Root ${r} exists and is writable.` };
  } catch (e) {
    return { ok: false, message: `Root ${r} is not writable: ${e.message} — map a host folder to it in Docker.` };
  }
}
