import { api } from './api.js';
import { esc, toast } from './ui.js';
import { renderLogin } from './views/login.js';
import { renderList } from './views/list.js';
import { openAddNew } from './views/addNew.js';
import { openBackup } from './views/backup.js';
import { openStation } from './views/station.js';
import { mountAssistant } from './views/assistant.js';

const root = document.getElementById('app');
const ctx = {
  me: null,
  mcps: [],
  refresh: () => boot(true)
};

window.addEventListener('station:unauthed', () => boot(false));

async function boot(authedHint) {
  try {
    ctx.me = await api('/me');
  } catch {
    root.innerHTML = '<div class="login-wrap"><div class="login"><h1>Server unreachable</h1><p>MCP Station backend is not responding.</p></div></div>';
    return;
  }

  if (!ctx.me.authed) {
    document.querySelector('.fab')?.remove();
    document.querySelector('.assistant')?.remove();
    renderLogin(root, { me: ctx.me, onAuthed: () => boot(true) });
    return;
  }

  try {
    ctx.mcps = (await api('/mcps')).mcps;
  } catch (e) {
    toast(e.message, 'err');
    ctx.mcps = [];
  }
  renderDashboard();
}

function renderDashboard() {
  root.innerHTML = `
    <div class="topbar">
      <div class="logo">⛽ MCP <span>Station</span><small>${esc(ctx.me.publicUrl || `v${ctx.me.version}`)}</small></div>
      <button class="btn primary" id="bAdd">➕ Add MCP</button>
      <button class="btn" id="bReload" title="Re-scan the mcps/ folder and remount endpoints">⟳ Reload modules</button>
      <button class="btn" id="bBackup">🗄 Backup</button>
      <button class="btn" id="bStation">⚙ Station</button>
      <button class="btn" id="bLogout">Logout</button>
    </div>
    <div class="main">
      ${ctx.me.hasAnthropicKey ? '' : `<div class="banner">The ✦ Claude popup needs an Anthropic API key — add one under ⚙ Station.</div>`}
      ${ctx.me.oauth ? '' : `<div class="banner">PUBLIC_URL is not set — OAuth is off, so claude.ai connectors won't work yet (static MCP_TOKEN access still fine).</div>`}
      <div id="listRoot"></div>
    </div>`;

  renderList(document.getElementById('listRoot'), ctx);
  mountAssistant(ctx);

  document.getElementById('bAdd').onclick = () => openAddNew(ctx);
  document.getElementById('bBackup').onclick = () => openBackup(ctx);
  document.getElementById('bStation').onclick = () => openStation(ctx);
  document.getElementById('bReload').onclick = async (e) => {
    e.target.disabled = true;
    try {
      await api('/reload', { method: 'POST' });
      toast('Modules reloaded');
      await boot(true);
    } catch (ex) { toast(ex.message, 'err'); }
  };
  document.getElementById('bLogout').onclick = async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    boot(false);
  };
}

boot();
