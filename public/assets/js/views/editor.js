import { api } from '../api.js';
import { esc, toast, drawer } from '../ui.js';

export async function openEditor(m, ctx) {
  let files = [];
  try {
    files = (await api(`/mcps/${m.id}/files`)).files;
  } catch (ex) {
    return toast(ex.message, 'err');
  }

  const d = drawer({
    title: `‹/› ${m.manifest?.name || m.id} — code`,
    body: `
      <div class="files" id="fileTabs"></div>
      <textarea class="code" id="codeArea" spellcheck="false" placeholder="Pick a file…"></textarea>
      <div class="help" style="margin-top:8px">Tip: ask the Claude popup (✦) for a module — it returns complete manifest.json + index.js ready to paste here. Save, then Reload modules.</div>`,
    foot: `<button class="btn" data-cancel>Close</button>
           <div class="spacer"></div>
           <button class="btn" data-reload>⟳ Save &amp; reload modules</button>
           <button class="btn primary" data-save>Save</button>`
  });

  const tabs = d.el.querySelector('#fileTabs');
  const area = d.el.querySelector('#codeArea');
  let current = null;
  let dirty = false;
  area.oninput = () => { dirty = true; };

  function renderTabs() {
    tabs.innerHTML = files.map((f) =>
      `<button class="btn sm ${f.path === current ? 'active' : ''}" data-f="${esc(f.path)}">${esc(f.path)}</button>`).join('');
    tabs.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => open(b.dataset.f); });
  }

  async function open(p) {
    if (dirty && !confirm('Discard unsaved changes in the current file?')) return;
    try {
      const r = await api(`/mcps/${m.id}/file?path=${encodeURIComponent(p)}`);
      current = p;
      area.value = r.content;
      dirty = false;
      renderTabs();
    } catch (ex) { toast(ex.message, 'err'); }
  }

  async function saveCurrent() {
    if (!current) throw new Error('No file open');
    await api(`/mcps/${m.id}/file`, { method: 'PUT', body: { path: current, content: area.value } });
    dirty = false;
  }

  d.el.querySelector('[data-cancel]').onclick = d.close;
  d.el.querySelector('[data-save]').onclick = async () => {
    try { await saveCurrent(); toast(`Saved ${current} — reload modules to apply`); }
    catch (ex) { toast(ex.message, 'err'); }
  };
  d.el.querySelector('[data-reload]').onclick = async () => {
    try {
      await saveCurrent();
      await api('/reload', { method: 'POST' });
      toast('Saved and reloaded ✓');
      ctx.refresh();
    } catch (ex) { toast(ex.message, 'err'); }
  };

  renderTabs();
  const first = files.find((f) => f.path === 'index.js') || files[0];
  if (first) open(first.path);
}
