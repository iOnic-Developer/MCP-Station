import { confirmAction as confirmModal } from './access.js';
import { api } from '../api.js';
import { esc, toast, modal } from '../ui.js';
import { icon } from '../product.js';

/** Station settings: assistant provider/key/model, retained instructions, env status, logs. */
export async function openStation(ctx) {
  let g = {
    provider: 'openai',
    openaiModel: 'gpt-6-astra', openaiApiKey: '', openaiEnvKeySet: false,
    anthropicModel: '', anthropicApiKey: '', envKeySet: false,
    geminiModel: '', geminiApiKey: '', geminiEnvKeySet: false
  };
  let instructions = '';
  try {
    [g, { instructions }] = await Promise.all([api('/global'), api('/instructions')]);
  } catch (e) { return toast(e.message, 'err'); }

  const me = ctx.me;
  const dlg = modal({
    title: 'Station settings',
    body: `
      <h3 style="margin:0 0 8px">Status</h3>
      <div class="list-rows" style="margin-bottom:18px">
        <div class="list-row"><span class="grow">Public URL</span><span class="dim mono">${esc(me.publicUrl || 'not set — OAuth off')}</span></div>
        <div class="list-row"><span class="grow">OAuth for claude.ai</span><span class="dim">${me.oauth ? 'Enabled' : 'Disabled (set PUBLIC_URL)'}</span></div>
        <div class="list-row"><span class="grow">Static MCP_TOKEN bearer</span><span class="dim">${me.mcpTokenSet ? 'Configured' : '— not set'}</span></div>
        <div class="list-row"><span class="grow">Version</span><span class="dim">v${esc(me.version)}</span></div>
      </div>

      <h3 style="margin:0 0 8px">Assistant</h3>
      <div class="field"><label>Provider</label>
        <select class="input" id="gProvider">
          <option value="openai"${g.provider === 'openai' ? ' selected' : ''}>OpenAI — GPT-6 Astra</option>
          <option value="anthropic"${g.provider === 'anthropic' ? ' selected' : ''}>Claude (Anthropic)</option>
          <option value="gemini"${g.provider === 'gemini' ? ' selected' : ''}>Gemini (Google)</option>
        </select>
        <div class="help">OpenAI/Astra is the 2.0 default. All provider keys can be saved — only the selected provider is used.</div>
      </div>

      <div class="field"><label>OpenAI API key ${g.openaiEnvKeySet ? '(env var is set and takes priority)' : ''}</label>
        <input class="input" type="password" id="gOpenAIKey" placeholder="${g.openaiApiKey ? '•••••• (saved — leave blank to keep)' : 'sk-proj-…'}" autocomplete="new-password">
      </div>
      <div class="field"><label>OpenAI model</label>
        <input class="input mono" id="gOpenAIModel" value="${esc(g.openaiModel || 'gpt-6-astra')}">
        <div class="help">Default: gpt-6-astra. Tool calls use OpenAI's Responses API.</div>
      </div>

      <div class="field"><label>Anthropic API key ${g.envKeySet ? '(env var is set and takes priority)' : ''}</label>
        <input class="input" type="password" id="gKey" placeholder="${g.anthropicApiKey ? '•••••• (saved — leave blank to keep)' : 'sk-ant-…'}" autocomplete="new-password">
      </div>
      <div class="field"><label>Anthropic model</label>
        <input class="input mono" id="gModel" value="${esc(g.anthropicModel)}">
        <div class="help">e.g. claude-sonnet-4-6 or another Anthropic Messages model.</div>
      </div>

      <div class="field"><label>Gemini API key ${g.geminiEnvKeySet ? '(env var is set and takes priority)' : ''}</label>
        <input class="input" type="password" id="gGemKey" placeholder="${g.geminiApiKey ? '•••••• (saved — leave blank to keep)' : 'AIza… from aistudio.google.com/apikey'}" autocomplete="new-password">
      </div>
      <div class="field"><label>Gemini model</label>
        <input class="input mono" id="gGemModel" value="${esc(g.geminiModel)}">
        <div class="help">e.g. gemini-2.5-flash or gemini-2.5-pro.</div>
      </div>

      <div class="field"><label>Retained instructions (the popup's standing brief — what this site is, how to build modules)</label>
        <textarea class="input mono" id="gInstr" rows="12" spellcheck="false">${esc(instructions)}</textarea>
        <div class="help">Edit freely — e.g. add house rules for your APIs. The popup also receives a live list of installed modules automatically.
          <button class="btn sm" data-reset-instr title="Replace the brief with this version's default (your edits are lost)" style="margin-left:8px">${icon('reload')}Reset to defaults</button></div>
      </div>

      <h3 style="margin:14px 0 8px">Logs</h3>
      <pre class="logbox" id="logBox">Loading…</pre><p class="error-text" data-error role="alert"></p>`,
    foot: `<button class="btn" data-logs>${icon('reload')}Refresh logs</button>
           <div class="spacer"></div>
           <button class="btn" data-cancel>Cancel</button>
           <button class="btn primary" data-save>Save</button>`
  });

  const error = dlg.querySelector('[data-error]');
  let pending = false;
  async function run(task) {
    if (pending) return;
    pending = true; error.textContent = ''; dlg.setAttribute('aria-busy', 'true');
    dlg.querySelectorAll('button,input,select,textarea').forEach((el) => { el.disabled = true; });
    try { await task(); } catch (e) { error.textContent = e.message; }
    finally { pending = false; dlg.setAttribute('aria-busy', 'false'); dlg.querySelectorAll('button,input,select,textarea').forEach((el) => { el.disabled = false; }); }
  }
  // Labels follow existing field IDs; no change to provider or settings contracts.
  dlg.querySelectorAll('.field').forEach((field) => {
    const input = field.querySelector('input,textarea,select'); const label = field.querySelector('label');
    if (input && label) label.htmlFor = input.id;
  });
  const clearedKeys = new Set();
  for (const [id, key, saved] of [['gOpenAIKey','openaiApiKey',g.openaiApiKey], ['gKey','anthropicApiKey',g.anthropicApiKey], ['gGemKey','geminiApiKey',g.geminiApiKey]]) {
    const input = dlg.querySelector(`#${id}`);
    if (!saved) continue;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm danger'; b.textContent = 'Clear saved key'; b.setAttribute('aria-label', `Clear saved ${key}`);
    input.after(b);
    b.onclick = () => { input.value = ''; clearedKeys.add(key); input.placeholder = 'Will be cleared on save'; b.textContent = 'Marked for removal'; input.focus(); };
    input.oninput = () => { if (input.value) { clearedKeys.delete(key); b.textContent = 'Clear saved key'; } };
  }
  async function loadLogs() {
    try {
      const { logs } = await api('/logs');
      const box = dlg.querySelector('#logBox');
      box.textContent = logs.slice(-200).map((l) => `${l.t.slice(11, 19)} [${l.scope}] ${l.msg}`).join('\n') || 'No log lines yet.';
      box.scrollTop = box.scrollHeight;
    } catch (e) { error.textContent = `Could not load logs: ${e.message}`; }
  }
  loadLogs();

  dlg.querySelector('[data-logs]').onclick = () => run(loadLogs);
  dlg.querySelector('[data-reset-instr]').onclick = () => run(async () => {
    if (!await confirmModal('Reset retained instructions?', 'This immediately replaces the saved instructions with the defaults and discards your instruction edits.', { confirmLabel: 'Reset instructions', danger: true })) return;
    const { instructions: fresh } = await api('/instructions/reset', { method: 'POST' });
    dlg.querySelector('#gInstr').value = fresh;
    toast('Default instructions restored');
  });
  dlg.querySelector('[data-cancel]').onclick = () => { if (!pending) dlg.close(); };
  dlg.addEventListener('cancel', (e) => { if (pending) e.preventDefault(); });
  dlg.querySelector('[data-save]').onclick = () => run(async () => {
    let globalSaved = false;
    try {
      const openaiKey = dlg.querySelector('#gOpenAIKey').value;
      const key = dlg.querySelector('#gKey').value;
      const gemKey = dlg.querySelector('#gGemKey').value;
      await api('/global', {
        method: 'PUT',
        body: {
          provider: dlg.querySelector('#gProvider').value,
          openaiModel: dlg.querySelector('#gOpenAIModel').value.trim(),
          anthropicModel: dlg.querySelector('#gModel').value.trim(),
          geminiModel: dlg.querySelector('#gGemModel').value.trim(),
          openaiApiKey: openaiKey || (clearedKeys.has('openaiApiKey') ? '' : g.openaiApiKey ? '••••••' : ''),
          anthropicApiKey: key || (clearedKeys.has('anthropicApiKey') ? '' : g.anthropicApiKey ? '••••••' : ''),
          geminiApiKey: gemKey || (clearedKeys.has('geminiApiKey') ? '' : g.geminiApiKey ? '••••••' : '')
        }
      });
      globalSaved = true;
      for (const [id, key] of [['gOpenAIKey','openaiApiKey'], ['gKey','anthropicApiKey'], ['gGemKey','geminiApiKey']]) {
        const input = dlg.querySelector(`#${id}`);
        g[key] = input.value ? '••••••' : (clearedKeys.has(key) ? '' : g[key]);
        input.value = ''; input.placeholder = g[key] ? 'Saved — leave blank to keep' : 'Not set';
      }
      clearedKeys.clear();
      await api('/instructions', { method: 'PUT', body: { instructions: dlg.querySelector('#gInstr').value } });
      toast('Station settings saved');
      dlg.close();
      await ctx.refresh();
    } catch (e) { error.textContent = `${globalSaved ? 'Provider settings saved, but instructions were not saved: ' : 'Settings were not saved: '}${e.message}`; }
  });
}
