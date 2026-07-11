import { api, download } from '../api.js';
import { esc, toast, modal, confirmModal } from '../ui.js';

export async function openBackup(ctx) {
  const dlg = modal({
    title: '🗄 Import · Export · Backup',
    body: `
      <h4 style="margin:0 0 8px">Config export (JSON)</h4>
      <p class="desc" style="margin:0 0 10px">Instructions + module settings. Portable between stations.</p>
      <div class="row" style="margin-bottom:6px">
        <button class="btn" data-export>⬇ Export</button>
        <label class="row" style="gap:6px;font-size:12.5px;color:var(--muted)">
          <input type="checkbox" id="incSecrets"> include secrets (plaintext!)
        </label>
      </div>
      <div class="row" style="margin-bottom:18px">
        <button class="btn" data-import>⬆ Import JSON…</button>
        <input type="file" id="importFile" accept="application/json" hidden>
      </div>

      <h4 style="margin:0 0 8px">Full backup (tar.gz)</h4>
      <p class="desc" style="margin:0 0 10px">Everything: state, encryption key, module code. Kept on the server (last 20) and downloadable.</p>
      <div class="row" style="margin-bottom:10px">
        <button class="btn primary" data-backup>⛃ Back up now</button>
        <button class="btn" data-restore-up>⬆ Restore from file…</button>
        <input type="file" id="restoreFile" accept=".gz,.tgz,application/gzip" hidden>
      </div>
      <div class="list-rows" id="bkList"><div class="dim">Loading…</div></div>`,
    foot: `<button class="btn" data-close>Close</button>`
  });

  dlg.querySelector('[data-close]').onclick = () => dlg.close();

  async function refreshList() {
    const box = dlg.querySelector('#bkList');
    try {
      const { backups } = await api('/backups');
      box.innerHTML = backups.length ? backups.map((b) => `
        <div class="list-row">
          <span class="grow mono">${esc(b.name)}</span>
          <span class="dim">${(b.size / 1024 / 1024).toFixed(2)} MB</span>
          <button class="btn sm" data-dl="${esc(b.name)}">⬇</button>
          <button class="btn sm danger" data-rs="${esc(b.name)}">restore</button>
        </div>`).join('') : '<div class="dim">No server-side backups yet.</div>';
      box.querySelectorAll('[data-dl]').forEach((x) => { x.onclick = () => download(`/backups/${x.dataset.dl}`, x.dataset.dl).catch((e) => toast(e.message, 'err')); });
      box.querySelectorAll('[data-rs]').forEach((x) => {
        x.onclick = async () => {
          if (!await confirmModal('Restore backup?', `Restore ${x.dataset.rs}? Current settings and module code get overwritten by the archive contents.`)) return;
          try {
            await api(`/restore/${x.dataset.rs}`, { method: 'POST' });
            toast('Restored ✓ — modules reloaded');
            ctx.refresh();
          } catch (e) { toast(e.message, 'err'); }
        };
      });
    } catch (e) { box.innerHTML = `<div class="dim">${esc(e.message)}</div>`; }
  }

  dlg.querySelector('[data-export]').onclick = () => {
    const inc = dlg.querySelector('#incSecrets').checked;
    download(`/export${inc ? '?secrets=1' : ''}`, `mcp-station-export-${new Date().toISOString().slice(0, 10)}.json`)
      .catch((e) => toast(e.message, 'err'));
  };

  const impFile = dlg.querySelector('#importFile');
  dlg.querySelector('[data-import]').onclick = () => impFile.click();
  impFile.onchange = async () => {
    try {
      const json = JSON.parse(await impFile.files[0].text());
      const r = await api('/import', { method: 'POST', body: json });
      toast(`Imported: ${r.applied.join(', ') || 'nothing'}${r.skipped.length ? ` · skipped: ${r.skipped.length}` : ''}`, 'ok', 6000);
      ctx.refresh();
    } catch (e) { toast(e.message, 'err'); }
    impFile.value = '';
  };

  dlg.querySelector('[data-backup]').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const r = await api('/backup', { method: 'POST' });
      toast(`Backup created: ${r.name}`);
      refreshList();
    } catch (ex) { toast(ex.message, 'err'); }
    e.target.disabled = false;
  };

  const rsFile = dlg.querySelector('#restoreFile');
  dlg.querySelector('[data-restore-up]').onclick = () => rsFile.click();
  rsFile.onchange = async () => {
    if (!await confirmModal('Restore from file?', 'Current settings and module code get overwritten by the archive contents.')) { rsFile.value = ''; return; }
    try {
      const buf = await rsFile.files[0].arrayBuffer();
      const r = await fetch('/api/restore', {
        method: 'POST',
        headers: { 'x-station-csrf': '1', 'Content-Type': 'application/gzip' },
        body: buf
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      toast('Restored ✓ — modules reloaded');
      ctx.refresh();
    } catch (e) { toast(e.message, 'err'); }
    rsFile.value = '';
  };

  refreshList();
}
