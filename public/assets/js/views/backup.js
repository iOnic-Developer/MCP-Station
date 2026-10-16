import { confirmAction as confirmModal } from './access.js';
import { api, download } from '../api.js';
import { esc, toast, modal } from '../ui.js';
import { icon } from '../product.js';

export async function openBackup(ctx) {
  const dlg = modal({
    title: 'Import, export & backup',
    body: `<section class="backup-section"><h3>Portable configuration</h3><p>Export instructions and module settings as JSON. Secrets are excluded unless explicitly selected.</p><div class="field"><label for="incSecrets"><input type="checkbox" id="incSecrets"> Include secrets in plaintext (sensitive)</label></div><div class="actions"><button class="btn" data-export>${icon('backup')}Export JSON</button><button class="btn" data-import>${icon('plus')}Import JSON</button></div><label class="sr-only" for="importFile">Configuration JSON file</label><input type="file" id="importFile" accept="application/json" hidden></section><section class="backup-section"><h3>Full station backup</h3><p>Archives contain state, encryption key and module code. Store downloaded copies securely. The server retains the last 20 archives.</p><div class="actions"><button class="btn primary" data-backup>${icon('backup')}Back up now</button><button class="btn danger" data-restore-up>Restore from file</button></div><label class="sr-only" for="restoreFile">Backup archive to restore</label><input type="file" id="restoreFile" accept=".gz,.tgz,application/gzip" hidden><div class="list-rows" id="bkList" aria-live="polite">Loading backups…</div></section><p class="error-text" data-error role="alert"></p><p class="help" data-result role="status"></p>`,
    foot: '<button class="btn" data-close>Close</button>'
  });
  let pending = false;
  const error = dlg.querySelector('[data-error]'); const result = dlg.querySelector('[data-result]');
  const setBusy = (busy) => { pending = busy; dlg.setAttribute('aria-busy', String(busy)); dlg.querySelectorAll('button,input').forEach((el) => { el.disabled = busy; }); };
  async function run(task) {
    if (pending) return;
    setBusy(true); error.textContent = ''; result.textContent = '';
    try { await task(); }
    catch (e) {
      error.textContent = e.message;
      const box = dlg.querySelector('#bkList');
      if (box.textContent === 'Loading backups…') {
        box.innerHTML = '<p>Backups could not be loaded.</p><button class="btn" data-retry-list>Retry loading backups</button>';
        box.querySelector('[data-retry-list]').onclick = () => run(refreshList);
      }
    }
    finally { setBusy(false); }
  }
  dlg.querySelector('[data-close]').onclick = () => { if (!pending) dlg.close(); };
  dlg.addEventListener('cancel', (e) => { if (pending) e.preventDefault(); });
  async function refreshList() {
    const box = dlg.querySelector('#bkList');
    const { backups } = await api('/backups');
    box.innerHTML = backups.length ? backups.map((b) => `<div class="list-row"><span class="grow mono">${esc(b.name)}</span><span class="dim">${(b.size / 1024 / 1024).toFixed(2)} MB</span><button class="btn sm" data-dl="${esc(b.name)}" aria-label="Download ${esc(b.name)}">${icon('backup')}Download</button><button class="btn sm danger" data-rs="${esc(b.name)}" aria-label="Restore ${esc(b.name)}">Restore</button></div>`).join('') : '<p>No backups yet. Create your first archive before making major changes.</p>';
    box.querySelectorAll('[data-dl]').forEach((b) => { b.onclick = () => run(() => download(`/backups/${encodeURIComponent(b.dataset.dl)}`, b.dataset.dl)); });
    box.querySelectorAll('[data-rs]').forEach((b) => { b.onclick = () => run(async () => {
      if (!await confirmModal('Overwrite station from backup?', `Restore ${b.dataset.rs}? Current settings and module code will be overwritten.`, { confirmLabel: 'Restore backup', danger: true })) return;
      await api(`/restore/${encodeURIComponent(b.dataset.rs)}`, { method: 'POST' }); result.textContent = 'Backup restored; modules reloaded.'; await ctx.refresh();
    }); });
    if (pending) box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  }
  dlg.querySelector('[data-export]').onclick = () => run(async () => {
    const secrets = dlg.querySelector('#incSecrets').checked;
    if (secrets && !await confirmModal('Export plaintext secrets?', 'The downloaded JSON will contain readable secrets. Anyone with the file can read them.', { confirmLabel: 'Export with secrets', danger: true })) return;
    await download(`/export${secrets ? '?secrets=1' : ''}`, `mcp-station-export-${new Date().toISOString().slice(0, 10)}.json`);
  });
  const imp = dlg.querySelector('#importFile'); const restore = dlg.querySelector('#restoreFile');
  dlg.querySelector('[data-import]').onclick = () => { if (!pending) imp.click(); };
  imp.onchange = () => run(async () => {
    try {
      if (!imp.files?.length) return;
      const json = JSON.parse(await imp.files[0].text());
      if (!await confirmModal('Import configuration?', 'Matching settings and retained instructions may be overwritten.', { confirmLabel: 'Import configuration', danger: true })) return;
      const r = await api('/import', { method: 'POST', body: json }); result.textContent = `Imported: ${r.applied.join(', ') || 'nothing'}${r.skipped.length ? ` · skipped ${r.skipped.length}` : ''}`; await ctx.refresh();
    } finally { imp.value = ''; }
  });
  dlg.querySelector('[data-backup]').onclick = () => run(async () => {
    const r = await api('/backup', { method: 'POST' }); result.textContent = `Backup created: ${r.name}`; toast('Backup created'); await refreshList();
  });
  dlg.querySelector('[data-restore-up]').onclick = () => { if (!pending) restore.click(); };
  restore.onchange = () => run(async () => {
    try {
      if (!restore.files?.length) return;
      if (!await confirmModal('Overwrite station from archive?', 'Current settings and module code will be overwritten by this archive.', { confirmLabel: 'Restore archive', danger: true })) return;
      const buf = await restore.files[0].arrayBuffer();
      await api('/restore', { method: 'POST', raw: true, headers: { 'Content-Type': 'application/gzip' }, body: buf });
      result.textContent = 'Archive restored; modules reloaded.'; await ctx.refresh();
    } finally { restore.value = ''; }
  });
  await run(refreshList);
}
