import { api } from '../api.js';
import { esc } from '../ui.js';

export function renderLogin(root, { me, onAuthed }) {
  root.innerHTML = `
    <div class="login-wrap">
      <form class="login" id="loginForm">
        <div class="logo" style="margin-bottom:14px">⛽ MCP <span>Station</span></div>
        <h1>Sign in</h1>
        <p>Your self-hosted MCP hub${me.publicUrl ? ` · <span class="mono">${esc(me.publicUrl)}</span>` : ''}</p>
        ${me.passwordSet ? '' : `<div class="banner">APP_PASSWORD is not set on the server — set it in the container environment and restart before you can sign in.</div>`}
        <div class="field">
          <label for="pw">Station password</label>
          <input class="input" id="pw" type="password" autocomplete="current-password" autofocus ${me.passwordSet ? '' : 'disabled'}>
        </div>
        <div class="error-text" id="loginErr"></div>
        <button class="btn primary" style="width:100%;justify-content:center;padding:10px" ${me.passwordSet ? '' : 'disabled'}>Sign in</button>
      </form>
    </div>`;

  root.querySelector('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const err = root.querySelector('#loginErr');
    err.textContent = '';
    try {
      await api('/login', { method: 'POST', body: { password: root.querySelector('#pw').value } });
      onAuthed();
    } catch (ex) {
      err.textContent = ex.message;
    }
  };
}
