import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, password, pause } from '../server-fixture.mjs';
import { fixture, launchBrowser, until, deferred, routes, artifacts, audit, assertDialogFocus } from './fixture.mjs';
let server, browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); await server?.stop(); });
function check(name, fn, options = {}) {
  test(name, { timeout: 60000 }, async () => {
    const f = await fixture(browser, server, options);
    try { await fn(f); } finally { await f.close(name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()); }
  });
}
check('real login rejects invalid input inline and accepts valid session', async ({ page, login }) => {
  await page.goto(server.base); await page.locator('#pw').fill('incorrect');
  await page.locator('button[type=submit]').click();
  await until(async () => (await page.locator('#loginErr').innerText()).includes('Password not accepted'), 'Invalid login error missing');
  assert.equal(await page.locator('#pw').getAttribute('aria-invalid'), 'true');
  assert.equal(await page.locator('#loginErr').getAttribute('role'), 'alert');
  assert.equal(await page.locator('#pw').getAttribute('autocomplete'), 'current-password');
  assert.equal(await page.locator('#pw').evaluate((el) => el === document.activeElement), true);
  await login(); assert.equal((await page.context().request.get(server.base + '/api/me').then((r) => r.json())).authed, true);
});
check('real login pending prevents duplicate submit', async ({ page, state }) => {
  const gate = deferred();
  state.handlers.set('POST /api/login', async (route) => { await gate.promise; await route.continue(); });
  await page.goto(server.base); await page.locator('#pw').fill(password);
  await page.evaluate(() => { const form = document.querySelector('#loginForm'); for (let i = 0; i < 3; i++) form.dispatchEvent(new Event('submit', { cancelable: true })); });
  try {
    await until(() => state.calls.filter((c) => c.path === '/api/login').length === 1, 'Login request missing');
    assert.equal(await page.locator('#loginForm').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('button[type=submit]').isDisabled(), true);
    assert.equal(state.calls.filter((c) => c.path === '/api/login').length, 1);
  } finally { gate.resolve(); }
  await page.locator('.station-shell').waitFor();
});
for (const theme of ['dark', 'light']) for (const width of [375, 768, 1440]) {
  check(`five routes responsive axe ${theme} ${width}`, async (f) => {
    await f.login(); const findings = [];
    for (const route of routes) {
      await f.navigate(route);
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${route}: horizontal overflow`);
      assert.equal(await f.page.locator(`#page-${route} h1`).count(), 1);
      findings.push(...(await audit(f.page, `${theme}-${width}-${route}`)).map((v) => ({ route, ...v })));
      await f.page.screenshot({ path: `${artifacts}/${theme}-${width}-${route}.png`, fullPage: true });
    }
    assert.deepEqual(findings, [], 'axe violations (all five routes scanned; no rule exclusions)');
  }, { width, theme });
}
check('theme contract changes real rendered colours rather than preference only', async (f) => {
  await f.login(); await f.page.emulateMedia({ colorScheme: 'dark' });
  const dark = await f.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await f.page.emulateMedia({ colorScheme: 'light' });
  const light = await f.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const toggle = f.page.getByRole('button', { name: /theme|light mode|dark mode/i });
  if (dark === light && await toggle.count()) await toggle.first().click();
  await until(async () => (await f.page.evaluate(() => getComputedStyle(document.body).backgroundColor)) !== dark, 'No functioning light theme: colour preference alone is not a theme');
});
check('login page axe includes invalid state', async (f) => {
  await f.page.goto(server.base); await f.page.locator('#pw').fill('incorrect'); await f.page.locator('button[type=submit]').click();
  await until(async () => (await f.page.locator('#loginErr').innerText()).length > 0, 'Login error missing');
  assert.deepEqual(await audit(f.page, 'login-invalid'), []);
});
check('library states distinguish configuration and saved tests from live health', async (f) => {
  await f.login(); await f.library();
  assert.equal(await f.page.locator('.module-card').count(), 4);
  assert.match(await f.row().innerText(), /Ready[\s\S]*Not tested yet/i);
  assert.match(await f.page.locator('[data-id="disabled"]').innerText(), /Disabled[\s\S]*Last test failed/i);
  assert.match(await f.page.locator('[data-id="setup"]').innerText(), /Needs configuration/i);
  assert.match(await f.page.locator('[data-id="broken"]').innerText(), /Load error/i);
  assert.doesNotMatch(await f.row().innerText(), /\b(live|healthy|connected)\b/i);
  assert.match(await f.page.locator('.library-note').innerText(), /not continuous service health/i);
  f.state.modules[0].lastTest = { ok: true, message: 'Fixture saved success', at: '2026-01-01T00:00:00Z' };
  await f.page.evaluate(() => window.dispatchEvent(new Event('station:mcps-changed')));
  await until(async () => (await f.row().innerText()).includes('Last test passed'), 'Saved successful test observation missing');
  await f.row().locator('[data-test]').click();
  await until(async () => (await f.row().innerText()).includes('Fixture service unreachable'), 'Failed test observation not retained');
  assert.match(await f.row().innerText(), /Last test failed/);
});
check('search filters and caret survive refresh without shell or assistant replacement', async (f) => {
  await f.login(); await f.library();
  await f.page.locator('.fab').click(); await f.page.locator('.assistant textarea').fill('Keep this draft');
  await f.page.locator('.assistant [data-close]').click();
  await f.page.locator('[data-filter="ready"]').click(); await f.page.locator('#module-search').fill('Example');
  await f.page.locator('#module-search').evaluate((el) => { el.focus(); el.setSelectionRange(2, 5); window.__shell = document.querySelector('.station-shell'); window.__assistant = document.querySelector('.assistant'); window.__refreshDone = false; window.addEventListener('station:data-refreshed', () => { window.__refreshDone = true; }, { once: true }); window.dispatchEvent(new Event('station:mcps-changed')); });
  await f.page.waitForFunction(() => window.__refreshDone);
  assert.equal(await f.page.locator('#module-search').inputValue(), 'Example');
  assert.equal(await f.page.locator('#module-search').evaluate((el) => el === document.activeElement && el.selectionStart === 2 && el.selectionEnd === 5), true);
  assert.equal(await f.page.locator('[data-filter="ready"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await f.page.locator('.module-card:visible').count(), 1);
  assert.equal(await f.page.evaluate(() => window.__shell === document.querySelector('.station-shell') && window.__assistant === document.querySelector('.assistant')), true);
  assert.equal(await f.page.locator('.assistant textarea').inputValue(), 'Keep this draft');
  await f.page.locator('#module-search').press('Escape'); assert.equal(await f.page.locator('#module-search').inputValue(), '');
});
check('public sharing requires explicit confirmation and defaults to cancel', async (f) => {
  await f.login(); await f.library(); await f.more('skill-link');
  const dlg = f.page.locator('dialog[open]'); await dlg.waitFor();
  assert.match(await dlg.innerText(), /Anyone with this link[\s\S]*7 days/);
  assert.equal(await dlg.locator('[data-no]').evaluate((el) => el === document.activeElement), true);
  assert.equal(f.state.calls.filter((c) => c.path.endsWith('/skill/share')).length, 0);
  await dlg.locator('[data-no]').click();
  assert.equal(f.state.calls.filter((c) => c.path.endsWith('/skill/share')).length, 0);
  await f.more('skill-link'); await f.page.locator('dialog[open] [data-yes]').click();
  await until(() => f.state.calls.filter((c) => c.path.endsWith('/skill/share')).length === 1, 'Explicit share request missing');
});
const surfaces = {
  libraryTools: async (f) => { await f.library(); await f.row().locator('[data-caps]').click(); await f.page.locator('#capFilter').waitFor(); },
  add: async (f) => { await f.library(); await f.page.locator('#bAdd').click(); },
  configuration: async (f) => { await f.library(); await f.row().locator('[data-settings]').click(); },
  access: async (f) => { await f.library(); await f.more('access'); await f.page.locator('#tokBox').waitFor(); },
  backup: async (f) => { await f.navigate('settings'); await f.page.locator('#page-settings [data-action="backup"]').click(); await until(async () => (await f.page.locator('#bkList').innerText()).includes('fixture-backup'), 'Backup list missing'); },
  station: async (f) => { await f.navigate('settings'); await f.page.locator('#page-settings [data-action="station"]').click(); await f.page.locator('#gProvider').waitFor(); await until(async () => (await f.page.locator('#logBox').innerText()) !== 'Loading…', 'Station logs still loading'); },
  editor: async (f) => { await f.editor(); }
};
for (const [name, open] of Object.entries(surfaces)) {
  check(`${name} dialog axe and meaningful trapped focus`, async (f) => {
    await f.login(); await open(f);
    const violations = await audit(f.page, `dialog-${name}`);
    await assertDialogFocus(f.page);
    assert.deepEqual(violations, [], `${name} axe violations`);
  });
}
for (const mode of ['keep', 'clear', 'replace']) {
  check(`secret settings ${mode} are masked and serialized deliberately`, async (f) => {
    await f.login(); await surfaces.configuration(f);
    const secret = f.page.locator('.drawer input[name="apiKey"]');
    assert.equal(await secret.inputValue(), ''); assert.equal(await secret.getAttribute('type'), 'password');
    assert.match(await secret.getAttribute('placeholder'), /Saved/);
    if (mode !== 'keep') await f.page.locator('.drawer [data-clear]').click();
    if (mode === 'replace') await secret.fill('fixture-replacement');
    await f.page.locator('.drawer [data-save]').click();
    await until(() => f.state.calls.some((c) => c.method === 'PATCH'), 'Settings patch missing');
    const patch = f.state.calls.find((c) => c.method === 'PATCH');
    assert.equal(patch.body.settings.apiKey, { keep: '••••••', clear: '', replace: 'fixture-replacement' }[mode]);
    await f.page.locator('.drawer').waitFor({ state: 'detached' });
  });
}
check('editor unsaved close cancel retains edits and allows explicit discard', async (f) => {
  await f.login(); await f.editor(); await f.page.locator('#codeArea').fill('unsaved source');
  await f.page.locator('.drawer [data-cancel]').click(); await f.page.locator('dialog.modal[open]').waitFor();
  await f.page.locator('dialog [data-no]').click(); assert.equal(await f.page.locator('#codeArea').inputValue(), 'unsaved source');
  await f.page.locator('.drawer [data-cancel]').click(); await f.page.locator('dialog [data-yes]').click();
  await f.page.locator('.drawer').waitFor({ state: 'detached' });
  assert.equal(f.state.calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/file')).length, 0);
});
check('editor saves click-time snapshot and preserves newer typing', async (f) => {
  await f.login(); await f.editor(); const gate = deferred();
  f.state.handlers.set('PUT /api/mcps/sample/file', async (route) => { await gate.promise; await route.fulfill({ json: { ok: true } }); });
  await f.page.locator('#codeArea').fill('snapshot A'); await f.page.locator('.drawer [data-save]').click();
  try {
    await until(() => f.state.calls.some((c) => c.method === 'PUT' && c.path.endsWith('/file')), 'Save request missing');
    await f.page.locator('#codeArea').fill('new typing B');
    assert.equal(f.state.calls.find((c) => c.method === 'PUT' && c.path.endsWith('/file')).body.content, 'snapshot A');
  } finally { gate.resolve(); }
  await until(async () => (await f.page.locator('.drawer [data-status]').innerText()).includes('Newer edits'), 'New typing not reported unsaved');
  assert.equal(await f.page.locator('#codeArea').inputValue(), 'new typing B');
  await f.page.locator('.drawer [data-cancel]').click(); await f.page.locator('dialog.modal[open]').waitFor();
});
check('editor overlapping file fetch ignores older completion', async (f) => {
  await f.login(); await f.editor(); const slow = deferred();
  f.state.handlers.set('GET /api/mcps/sample/file', async (route, record, url) => {
    if (url.searchParams.get('path') === 'manifest.json') { await slow.promise; return route.fulfill({ json: { content: 'STALE MANIFEST' } }); }
    return route.fulfill({ json: { content: 'LATEST NOTES' } });
  });
  try {
    await f.page.locator('[data-f="manifest.json"]').click();
    await until(() => f.state.calls.some((c) => c.query === 'path=manifest.json'), 'Slow fetch missing');
    await f.page.locator('[data-f="notes.txt"]').click();
    await until(async () => (await f.page.locator('#codeArea').inputValue()) === 'LATEST NOTES', 'Latest file not shown');
  } finally { slow.resolve(); }
  await until(async () => f.page.locator('[data-f="notes.txt"]').getAttribute('aria-selected').then((v) => v === 'true'), 'Latest tab not selected');
  await pause(100); assert.equal(await f.page.locator('#codeArea').inputValue(), 'LATEST NOTES');
});
check('editor refresh cannot overwrite typing made during fetch', async (f) => {
  await f.login(); await f.editor(); const gate = deferred();
  f.state.handlers.set('GET /api/mcps/sample/file', async (route) => { await gate.promise; await route.fulfill({ json: { content: 'STALE REFRESH' } }); });
  await f.page.locator('[data-f="manifest.json"]').click();
  await until(() => f.state.calls.some((c) => c.query === 'path=manifest.json'), 'Refresh fetch missing');
  await f.page.locator('#codeArea').fill('typing during fetch'); gate.resolve();
  await until(async () => (await f.page.locator('.drawer [data-save]').isDisabled()) === false, 'Loading state stuck');
  assert.equal(await f.page.locator('#codeArea').inputValue(), 'typing during fetch');
});
check('editor assistant Clear cancels response and persists empty history', async (f) => {
  await f.login(); await f.editor(); const gate = deferred();
  f.state.handlers.set('POST /api/assistant', async (route) => { await gate.promise; await route.fulfill({ contentType: 'text/event-stream', body: 'data: {"text":"LATE SECRET"}\n\ndata: {"done":true}\n\n' }).catch(() => {}); });
  await f.page.locator('.drawer [data-chat]').click(); await f.page.locator('#mcpChat textarea').fill('fixture question'); await f.page.locator('#mcpChat [data-send]').click();
  await until(() => f.state.calls.some((c) => c.path === '/api/assistant'), 'Assistant request missing');
  await f.page.locator('#mcpChat [data-clear]').click(); gate.resolve();
  await until(() => f.state.calls.some((c) => c.path.endsWith('/chat') && c.method === 'PUT' && c.body.messages.length === 0), 'Clear did not persist empty history');
  assert.equal(await f.page.locator('#mcpChat textarea').inputValue(), '');
  await pause(100); assert.doesNotMatch(await f.page.locator('#mcpChat').innerText(), /LATE SECRET|fixture question/);
});
check('editor disposal detaches assistant and late file-change listeners', async (f) => {
  await f.login(); await f.editor();
  await f.page.locator('.drawer [data-chat]').click(); await f.page.locator('#mcpChat textarea').fill('fixture question'); await f.page.locator('#mcpChat [data-send]').click();
  await until(async () => (await f.page.locator('#mcpChat').innerText()).includes('Fixture assistant response'), 'Assistant response missing');
  await until(async () => await f.page.locator('#mcpChat [data-stop]').isHidden(), 'Assistant did not finish');
  await f.page.locator('.drawer [data-cancel]').click(); await f.page.locator('.drawer').waitFor({ state: 'detached' });
  const count = f.state.calls.length;
  await f.page.evaluate(() => window.dispatchEvent(new CustomEvent('station:module-file-changed', { detail: { id: 'sample', path: 'index.js' } })));
  await pause(150); assert.equal(f.state.calls.length, count, 'Disposed editor still fetching files');
  await f.more('code'); await f.page.locator('#codeArea').waitFor();
  assert.equal(await f.page.locator('.drawer').count(), 1);
});
check('inventory initial failure has unknown counts and recovers', async (f) => {
  f.state.inventory = 'error'; await f.login();
  assert.equal(await f.page.locator('.metric strong').first().innerText(), '—');
  assert.match(await f.page.locator('#page-overview').innerText(), /No inventory counts are available/);
  f.state.inventory = 'ok'; await f.page.locator('#page-overview [data-action="inventory-retry"]').click();
  await until(async () => (await f.page.locator('.metric strong').first().innerText()) === '4', 'Inventory retry did not recover');
});
check('inventory stale failure preserves last data and recovers', async (f) => {
  await f.login(); f.state.inventory = 'error'; await f.page.evaluate(() => window.dispatchEvent(new Event('station:mcps-changed')));
  await until(async () => (await f.page.locator('#shell-status').innerText()).includes('Refresh failed'), 'Stale inventory error missing');
  assert.equal(await f.page.locator('.metric strong').first().innerText(), '4');
  assert.match(await f.page.locator('#page-overview').innerText(), /may be stale/);
  f.state.inventory = 'ok'; await f.page.locator('#page-overview [data-action="inventory-retry"]').click();
  await until(async () => (await f.page.locator('#shell-status').innerText()) === 'Data refreshed', 'Stale recovery failed');
});
check('navigation focus back and module deep link', async (f) => {
  await f.login('#/connections'); assert.equal(await f.page.locator('[data-route="connections"]').getAttribute('aria-current'), 'page');
  await f.navigate('help'); assert.equal(await f.page.locator('#page-help h1').evaluate((el) => el === document.activeElement), true);
  await f.page.goBack(); await f.page.locator('#page-connections').waitFor({ state: 'visible' });
  await f.page.locator('.connection-row').first().getByRole('link', { name: 'Find module' }).click();
  await f.page.locator('#page-modules').waitFor({ state: 'visible' });
  assert.equal(await f.row().evaluate((el) => el === document.activeElement || el.contains(document.activeElement)), true, 'Deep linked module not focused');
});
check('logout pending hides secret DOM before real server confirmation', async (f) => {
  await f.login(); await f.page.locator('.fab').click(); await f.page.locator('.assistant textarea').fill('fixture-sensitive-source');
  await f.page.locator('.assistant [data-close]').click();
  const gate = deferred(); f.state.handlers.set('POST /api/logout', async (route) => { await gate.promise; await route.continue(); });
  f.page.on('dialog', (dialog) => dialog.accept()); await f.page.locator('#bLogout').click();
  try {
    await f.page.locator('#logout-status').waitFor();
    assert.equal(await f.page.locator('.drawer,dialog,.assistant,.fab,.station-shell,#pw').count(), 0);
    assert.doesNotMatch(await f.page.locator('body').innerText(), /fixture-sensitive-source/);
    assert.equal(await f.page.locator('#logoutRetry').isDisabled(), true);
  } finally { gate.resolve(); }
  await f.page.locator('#pw').waitFor();
  assert.equal((await f.context.request.get(server.base + '/api/me').then((r) => r.json())).authed, false);
});
check('protected 401 expiry clears secret DOM and ignores late editor fetch', async (f) => {
  await f.login(); await f.page.locator('.fab').click(); await f.page.locator('.assistant textarea').fill('fixture-sensitive-expired');
  await f.page.locator('.assistant [data-close]').click(); await f.library(); const gate = deferred();
  f.state.handlers.set('GET /api/mcps/sample/files', async (route) => { await gate.promise; await route.fulfill({ json: { files: [{ path: 'index.js' }] } }); });
  await f.more('code'); await until(() => f.state.calls.some((c) => c.path.endsWith('/files')), 'Editor pending request missing');
  f.state.inventory = 'expired'; await f.page.evaluate(() => window.dispatchEvent(new Event('station:mcps-changed')));
  await f.page.locator('#pw').waitFor(); gate.resolve(); await pause(150);
  assert.equal(await f.page.locator('.drawer,dialog,.assistant,.fab,.station-shell').count(), 0);
  assert.doesNotMatch(await f.page.locator('body').innerText(), /Synthetic test instructions|fixture-sensitive/);
});
check('real service worker caches only public assets and serves generic offline navigation', async (f) => {
  // No mocked API responses may enter the worker cache. Exercise auth + module files first.
  await f.login(); await f.editor();
  await f.page.evaluate(() => navigator.serviceWorker.ready);
  await until(async () => f.page.evaluate(() => !!navigator.serviceWorker.controller), 'Worker did not control page');
  await until(async () => f.page.evaluate(async () => (await caches.keys()).length > 0), 'Worker cache missing');
  const inventory = await f.page.evaluate(async () => {
    const result = [];
    for (const name of await caches.keys()) { const cache = await caches.open(name); for (const request of await cache.keys()) { const response = await cache.match(request); result.push({ path: new URL(request.url).pathname, mime: response.headers.get('content-type') }); } }
    return result;
  });
  assert(inventory.length >= 5, 'Worker did not populate public assets');
  for (const entry of inventory) {
    assert.match(entry.path, /^\/assets\/(css\/[^/]+\.css|fonts\/[^/]+\.(ttf|woff2)|brand\/[^/]+\.(png|svg)|manifest\.webmanifest)$/);
    assert.doesNotMatch(entry.path, /^\/(?:api|authorize|token|register|modules?)(?:\/|$)|\.html$|\.js$/); assert.doesNotMatch(entry.mime, /html|javascript|application\/json/);
  }
  await f.context.setOffline(true);
  const response = await f.page.goto(server.base, { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 503); assert.equal(response.headers()['cache-control'], 'no-store');
  assert.match(await f.page.locator('h1').innerText(), /offline/i);
  assert.equal(await f.page.locator('#loginForm,.station-shell,.drawer').count(), 0);
  assert.doesNotMatch(await f.page.locator('body').innerText(), /Example service|Synthetic test instructions|fixture-model/);
  await f.context.setOffline(false);
}, { worker: true });
check('logout failure stays locked and Retry confirms real sign-out', async (f) => {
  await f.login(); let attempts = 0;
  f.state.handlers.set('POST /api/logout', async (route) => { if (++attempts === 1) return route.fulfill({ status: 503, json: { error: 'Fixture unavailable' } }); return route.continue(); });
  await f.page.locator('#bLogout').click();
  await until(async () => await f.page.locator('#logoutRetry').isEnabled(), 'Failed logout retry not offered');
  assert.match(await f.page.locator('#logout-status').innerText(), /not confirmed/);
  assert.equal(await f.page.locator('.station-shell,.assistant,.fab,#pw').count(), 0);
  assert.equal((await f.context.request.get(server.base + '/api/me').then((r) => r.json())).authed, true, 'First logout must really have failed');
  await f.page.locator('#logoutRetry').click(); await f.page.locator('#pw').waitFor();
  assert.equal(attempts, 2);
  assert.equal((await f.context.request.get(server.base + '/api/me').then((r) => r.json())).authed, false);
});
check('dialog dismissal restores opener focus', async (f) => {
  await f.login(); await f.library(); await f.page.locator('#bAdd').click();
  await f.page.locator('dialog[open] [data-cancel]').click();
  assert.equal(await f.page.locator('#bAdd').evaluate((el) => el === document.activeElement), true, 'Dismissal did not restore opener focus');
});
check('assistant draft survives navigation and Clear erases it', async (f) => {
  await f.login(); await f.page.locator('.fab').click(); await f.page.locator('.assistant textarea').fill('unsent assistant draft');
  await f.page.locator('.assistant [data-close]').click(); await f.navigate('connections');
  await f.page.locator('.fab').click(); assert.equal(await f.page.locator('.assistant textarea').inputValue(), 'unsent assistant draft');
  await f.page.locator('.assistant [data-clear]').click(); assert.equal(await f.page.locator('.assistant textarea').inputValue(), '');
  assert.doesNotMatch(await f.page.locator('.assistant').innerText(), /unsent assistant draft/);
  await f.page.locator('.assistant textarea').press('Escape');
  assert.equal(await f.page.locator('.fab').evaluate((el) => el === document.activeElement), true);
});
for (const mode of ['keep', 'clear', 'replace']) {
  check(`Station provider secret ${mode} preserves mask semantics`, async (f) => {
    await f.login(); await surfaces.station(f);
    const key = f.page.locator('#gOpenAIKey');
    assert.equal(await key.inputValue(), ''); assert.equal(await key.getAttribute('type'), 'password');
    if (mode !== 'keep') await f.page.getByRole('button', { name: 'Clear saved openaiApiKey', exact: true }).click();
    if (mode === 'replace') await key.fill('fixture-provider-replacement');
    await f.page.locator('dialog[open] [data-save]').click();
    await until(() => f.state.calls.some((c) => c.method === 'PUT' && c.path === '/api/instructions'), 'Station settings transaction did not complete');
    const save = f.state.calls.find((c) => c.method === 'PUT' && c.path === '/api/global');
    assert.equal(save.body.openaiApiKey, { keep: '••••••', clear: '', replace: 'fixture-provider-replacement' }[mode]);
    assert.equal(f.state.calls.find((c) => c.method === 'PUT' && c.path === '/api/instructions').body.instructions, 'Synthetic test instructions');
    await f.page.locator('dialog[open]').waitFor({ state: 'detached' });
  });
}

check('tool-only assistant completion is not restored as a retryable draft', async (f) => {
  await f.login(); await f.editor();
  f.state.handlers.set('POST /api/assistant', route => route.fulfill({contentType:'text/event-stream', body:'data: {"tool":{"name":"fixture_action","status":"running"}}\n\ndata: {"tool":{"name":"fixture_action","status":"done","ok":true}}\n\ndata: {"done":true}\n\n'}));
  await f.page.locator('.drawer [data-chat]').click();
  await f.page.locator('#mcpChat textarea').fill('Do the fixture action');
  await f.page.locator('#mcpChat [data-send]').click();
  await until(async () => await f.page.locator('#mcpChat [data-stop]').isHidden(), 'Tool-only response did not finish');
  assert.equal(await f.page.locator('#mcpChat textarea').inputValue(), '');
  await until(() => f.state.calls.some(c => c.path.endsWith('/chat') && c.method==='PUT' && c.body.messages.some(m=>m.content==='Do the fixture action')), 'Executed user turn not retained');
});
check('closing editor protects an unsent assistant draft even when source is clean', async (f) => {
  await f.login(); await f.editor(); await f.page.locator('.drawer [data-chat]').click();
  await f.page.locator('#mcpChat textarea').fill('Keep my unsent question');
  await f.page.locator('.drawer [data-cancel]').click();
  const confirmation = f.page.locator('dialog.modal[open]'); await confirmation.waitFor();
  assert.match(await confirmation.innerText(), /unsent assistant draft/i);
  await confirmation.locator('[data-no]').click();
  assert.equal(await f.page.locator('#mcpChat textarea').inputValue(), 'Keep my unsent question');
});
