import { api } from '../api.js';
import { esc, toast, modal } from '../ui.js';

/** Station settings: assistant key/model, retained instructions, env status, logs. */
export async function openStation(ctx) {
  let g = { provider: 'anthropic', anthropicModel: '', anthropicApiKey: '', envKeySet: false, geminiModel: '', geminiApiKey: '', geminiEnvKeySet: false };
  let instructions = '';
  try {
    [g, { instructions }] = await Promise.all([api('/global'), api('/instructions')]);
  } catch (e) { return toast(e.message, 'err'); }

  const me = ctx.me;
  const dlg = modal({
    title: '⚙ Station settings',
    body: `
      <h4 style="margin:0 0 8px">Status</h4>
      <div class="list-rows" style="margin-bottom:18px">
        <div class="list-row"><span class="grow">Public URL</span><span class="dim mono">${esc(me.publicUrl || 'not set — OAuth off')}</span></div>
        <div class="list-row"><span class="grow">OAuth for claude.ai</span><span class="dim">${me.oauth ? '✅ on' : '❌ off (set PUBLIC_URL)'}</span></div>
        <div class="list-row"><span class="grow">Static MCP_TOKEN bearer</span><span class="dim">${me.mcpTokenSet ? '✅ set' : '— not set'}</span></div>
        <div class="list-row"><span class="grow">Version</span><span class="dim">v${esc(me.version)}</span></div>
      </div>

      <h4 style="margin:0 0 8px">Assistant (✦ popup)</h4>
      <div class="field"><label>Provider</label>
        <select class="input" id="gProvider">
          <option value="anthropic"${g.provider === 'anthropic' ? ' selected' : ''}>Claude (Anthropic)</option>
          <option value="gemini"${g.provider === 'gemini' ? ' selected' : ''}>Gemini (Google)</option>
        </select>
        <div class="help">Which API the popup talks to. Both keys can be saved — only the selected one is used.</div>
      </div>
      <div class="field"><label>Anthropic API key ${g.envKeySet ? '(env var is set and takes priority)' : ''}</label>
        <input class="input" type="password" id="gKey" placeholder="${g.anthropicApiKey ? '•••••• (saved — leave blank to keep)' : 'sk-ant-…'}" autocomplete="new-password">
      </div>
      <div class="field"><label>Anthropic model</label>
        <input class="input mono" id="gModel" value="${esc(g.anthropicModel)}">
        <div class="help">e.g. claude-sonnet-4-6 (fast) or claude-opus-4-8 (heavier reasoning).</div>
      </div>
      <div class="field"><label>Gemini API key ${g.geminiEnvKeySet ? '(env var is set and takes priority)' : ''}</label>
        <input class="input" type="password" id="gGemKey" placeholder="${g.geminiApiKey ? '•••••• (saved — leave blank to keep)' : 'AIza… from aistudio.google.com/apikey'}" autocomplete="new-password">
      </div>
      <div class="field"><label>Gemini model</label>
        <input class="input mono" id="gGemModel" value="${esc(g.geminiModel)}">
        <div class="help">e.g. gemini-2.5-flash (fast) or gemini-2.5-pro.</div>
      </div>
      <div class="field"><label>Retained instructions (the popup's standing brief — what this site is, how to build modules)</label>
        <textarea class="input mono" id="gInstr" rows="12" spellcheck="false">${esc(instructions)}</textarea>
        <div class="help">Edit freely — e.g. add house rules for your APIs. The popup also receives a live list of installed modules automatically.</div>
      </div>

      <h4 style="margin:14px 0 8px">Logs</h4>
      <pre class="logbox" id="logBox">Loading…</pre>`,
    foot: `<button class="btn" data-logs>⟳ Refresh logs</button>
           <div class="spacer"></div>
           <button class="btn" data-cancel>Cancel</button>
           <button class="btn primary" data-save>Save</button>`
  });

  async function loadLogs() {
    try {
      const { logs } = await api('/logs');
      const box = dlg.querySelector('#logBox');
      box.textContent = logs.slice(-200).map((l) => `${l.t.slice(11, 19)} [${l.scope}] ${l.msg}`).join('\n') || 'No log lines yet.';
      box.scrollTop = box.scrollHeight;
    } catch { /* modal may be closed */ }
  }
  loadLogs();

  dlg.querySelector('[data-logs]').onclick = loadLogs;
  dlg.querySelector('[data-cancel]').onclick = () => dlg.close();
  dlg.querySelector('[data-save]').onclick = async () => {
    try {
      const key = dlg.querySelector('#gKey').value;
      const gemKey = dlg.querySelector('#gGemKey').value;
      await api('/global', {
        method: 'PUT',
        body: {
          provider: dlg.querySelector('#gProvider').value,
          anthropicModel: dlg.querySelector('#gModel').value.trim(),
          geminiModel: dlg.querySelector('#gGemModel').value.trim(),
          ...(key !== '' ? { anthropicApiKey: key } : {}),
          ...(gemKey !== '' ? { geminiApiKey: gemKey } : {})
        }
      });
      await api('/instructions', { method: 'PUT', body: { instructions: dlg.querySelector('#gInstr').value } });
      toast('Station settings saved');
      dlg.close();
      ctx.refresh();
    } catch (e) { toast(e.message, 'err'); }
  };
}
