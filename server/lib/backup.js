/**
 * Import / export / backup.
 *  - Export: portable JSON of instructions + module registry (+ optional secrets).
 *  - Import: apply an export (settings matched by module id; masked '••••••' skipped).
 *  - Backup: tar.gz of DATA_DIR (minus backups/) + the whole mcps/ folder,
 *    kept server-side in DATA_DIR/backups and downloadable. Restore accepts an
 *    uploaded archive, extracts to staging, then swaps in and reloads.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { cfg } from './env.js';
import { getState, save, loadState } from './state.js';
import { encrypt, decrypt } from './crypto.js';
import { getModules, loadModules } from './mcpHost.js';
import { log } from './log.js';

const backupsDir = () => path.join(cfg.dataDir, 'backups');
const KEEP = 20;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(0, 400)}`))));
    p.on('error', reject);
  });
}

/* ── Config export / import ──────────────────────────────────────────── */
export function exportConfig(includeSecrets = false) {
  const st = getState();
  const mods = [...getModules().values()].filter((m) => m.manifest);
  return {
    kind: 'mcp-station-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    station: cfg.version,
    instructions: st.instructions,
    global: {
      anthropicModel: st.global.anthropicModel || '',
      ...(includeSecrets && st.global.anthropicApiKey ? { anthropicApiKey: decrypt(st.global.anthropicApiKey) } : {})
    },
    mcps: mods.map((m) => {
      const reg = st.mcps[m.id] || {};
      const settings = {};
      for (const s of m.manifest.settings) {
        const raw = reg.settings?.[s.key];
        if (raw == null || raw === '') continue;
        settings[s.key] = s.type === 'secret' && !includeSecrets ? '••••••' : decrypt(raw);
      }
      return { id: m.id, slug: m.manifest.slug, name: m.manifest.name, enabled: Boolean(reg.enabled), settings };
    })
  };
}

export function importConfig(data) {
  if (!data || data.kind !== 'mcp-station-export') {
    throw new Error("Not an MCP Station export (expected kind: 'mcp-station-export')");
  }
  const st = getState();
  const report = { applied: [], skipped: [] };

  if (typeof data.instructions === 'string' && data.instructions.trim()) {
    st.instructions = data.instructions;
    report.applied.push('assistant instructions');
  }
  if (data.global?.anthropicModel) st.global.anthropicModel = String(data.global.anthropicModel);
  if (data.global?.anthropicApiKey) {
    st.global.anthropicApiKey = encrypt(String(data.global.anthropicApiKey));
    report.applied.push('anthropic api key');
  }

  for (const entry of Array.isArray(data.mcps) ? data.mcps : []) {
    const mod = [...getModules().values()].find((m) => m.id === entry.id);
    if (!mod?.manifest) {
      report.skipped.push(`${entry.id} — module not installed (restore a backup to bring its code across)`);
      continue;
    }
    st.mcps[entry.id] = st.mcps[entry.id] || { id: entry.id, enabled: false, settings: {}, createdAt: new Date().toISOString() };
    st.mcps[entry.id].enabled = Boolean(entry.enabled);
    for (const s of mod.manifest.settings) {
      const v = entry.settings?.[s.key];
      if (v == null || v === '••••••') continue;
      st.mcps[entry.id].settings[s.key] = s.type === 'secret' ? encrypt(String(v)) : String(v);
    }
    st.mcps[entry.id].updatedAt = new Date().toISOString();
    report.applied.push(entry.id);
  }
  save();
  log('backup', `Import applied: ${report.applied.join(', ') || 'nothing'}`);
  return report;
}

/* ── Full backup / restore (tar.gz) ──────────────────────────────────── */
export async function createBackup() {
  fs.mkdirSync(backupsDir(), { recursive: true });
  const name = `mcp-station-backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.tar.gz`;
  const file = path.join(backupsDir(), name);
  await run('tar', [
    '-czf', file,
    '--exclude=./backups',
    '-C', cfg.dataDir, '.',
    '-C', path.dirname(cfg.mcpsDir), path.basename(cfg.mcpsDir)
  ]);
  // prune old backups
  const all = listBackups();
  for (const b of all.slice(KEEP)) fs.rmSync(path.join(backupsDir(), b.name), { force: true });
  log('backup', `Created ${name} (${fs.statSync(file).size} bytes)`);
  return { name, size: fs.statSync(file).size };
}

export function listBackups() {
  fs.mkdirSync(backupsDir(), { recursive: true });
  return fs.readdirSync(backupsDir())
    .filter((f) => f.endsWith('.tar.gz'))
    .map((f) => {
      const s = fs.statSync(path.join(backupsDir(), f));
      return { name: f, size: s.size, createdAt: s.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function backupPath(name) {
  if (!/^[a-zA-Z0-9._\-]+\.tar\.gz$/.test(name)) throw new Error('Bad backup name');
  const p = path.join(backupsDir(), name);
  if (!fs.existsSync(p)) throw new Error('Backup not found');
  return p;
}

/** Restore from a tar.gz buffer (uploaded) or a server-side backup name. */
export async function restoreBackup({ buffer = null, name = null }) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'station-restore-'));
  const archive = buffer ? path.join(staging, 'upload.tar.gz') : backupPath(name);
  if (buffer) fs.writeFileSync(archive, buffer);

  const extract = path.join(staging, 'x');
  fs.mkdirSync(extract);
  await run('tar', ['-xzf', archive, '-C', extract]);

  if (!fs.existsSync(path.join(extract, 'station.json'))) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error('Archive does not look like an MCP Station backup (missing station.json)');
  }

  // 1) mcps/ → MCPS_DIR (replace module folders present in the archive)
  const mcpsSrc = path.join(extract, path.basename(cfg.mcpsDir));
  if (fs.existsSync(mcpsSrc)) {
    for (const entry of fs.readdirSync(mcpsSrc)) {
      const dest = path.join(cfg.mcpsDir, entry);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(path.join(mcpsSrc, entry), dest, { recursive: true });
    }
    fs.rmSync(mcpsSrc, { recursive: true, force: true });
  }
  // 2) everything else → DATA_DIR (station.json, secret.key, …)
  fs.cpSync(extract, cfg.dataDir, { recursive: true });
  fs.rmSync(staging, { recursive: true, force: true });

  loadState();
  await loadModules();
  log('backup', `Restored ${buffer ? 'uploaded archive' : name}`);
  return { ok: true };
}
