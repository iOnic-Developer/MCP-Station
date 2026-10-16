import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { password, pause, root } from '../server-fixture.mjs';
export const routes = ['overview', 'modules', 'connections', 'settings', 'help'];
export const artifacts = `${root}test-artifacts`;
export function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
export async function until(predicate, message, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await predicate()) return; await pause(25); }
  assert.fail(message);
}
export async function launchBrowser() {
  return chromium.launch({ headless: true, args: ['--no-sandbox'] });
}
export async function fixture(browser, server, options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width || 1440, height: 1000 }, colorScheme: options.theme || 'dark', serviceWorkers: options.worker ? 'allow' : 'block' });
  context.setDefaultTimeout(5000);
  const state = { calls: [], unexpected: [], errors: [], handlers: new Map(), inventory: 'ok',
    files: { 'index.js': 'export function register() { /* fixture */ }\n', 'manifest.json': '{"slug":"sample"}\n', 'notes.txt': 'fixture notes\n' },
    history: [], modules: [
      { id: 'sample', manifest: { name: 'Example service', slug: 'sample', description: 'Synthetic fixture only', settings: [{ key: 'url', label: 'Service URL', type: 'text', required: true }, { key: 'apiKey', label: 'Service API key', type: 'secret', required: true }] }, enabled: true, configured: true, clients: 1, tokenSet: true, settings: { url: 'https://fixture.invalid', apiKey: '••••••' }, url: `${server.base}/sample/mcp`, lastTest: null },
      { id: 'setup', manifest: { name: 'Needs setup service', slug: 'setup', description: 'Unconfigured fixture' }, enabled: true, configured: false, settings: {}, url: `${server.base}/setup/mcp` },
      { id: 'disabled', manifest: { name: 'Disabled service', slug: 'disabled' }, enabled: false, configured: true, settings: {}, url: `${server.base}/disabled/mcp`, lastTest: { ok: false, message: 'Fixture prior failure', at: '2026-01-01T00:00:00Z' } },
      { id: 'broken', manifest: null, error: 'Fixture syntax error', enabled: false, configured: false, settings: {}, url: `${server.base}/broken/mcp` }
    ] };
  await context.route('**/*', async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== server.base) { state.unexpected.push(`Blocked external ${url.origin}${url.pathname}`); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const record = { path: url.pathname, query: url.searchParams.toString(), method: request.method(), body: request.postDataJSON?.(), headers: request.headers() };
    state.calls.push(record);
    const key = `${record.method} ${record.path}`;
    if (state.handlers.has(key)) return state.handlers.get(key)(route, record, url);
    if (['/api/login', '/api/me', '/api/logout'].includes(url.pathname)) return route.continue();
    if (record.method !== 'GET' && record.headers['x-station-csrf'] !== '1') state.unexpected.push(`Missing CSRF: ${key}`);
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (key === 'GET /api/mcps') {
      if (state.inventory === 'error') return json({ error: 'Fixture inventory unavailable' }, 503);
      if (state.inventory === 'expired') return json({ error: 'Not signed in' }, 401);
      return json({ mcps: state.modules });
    }
    if (key === 'POST /api/reload') return json({ ok: true });
    if (key === 'GET /api/mcps/sample/capabilities') return json({ name: 'Fixture capabilities', tools: [{ name: 'fixture_echo', description: 'Echo synthetic input', inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Synthetic input' } }, required: ['text'] }, annotations: { readOnlyHint: true } }], prompts: [], instructions: '' });
    if (key === 'PUT /api/global' || key === 'PUT /api/instructions') return json({ ok: true });
    if (key === 'GET /api/mcps/sample/connections') return json({ connections: [{ handle: 'fixture-client', clientName: 'Fixture desktop', allMcps: false, lastUsedAt: null, expiresAt: null }] });
    if (key === 'GET /api/mcps/sample/files') return json({ files: Object.keys(state.files).map((path) => ({ path })) });
    if (key === 'GET /api/mcps/sample/file') return json({ content: state.files[url.searchParams.get('path')] });
    if (key === 'PUT /api/mcps/sample/file') { state.files[record.body.path] = record.body.content; return json({ ok: true }); }
    if (key === 'GET /api/mcps/sample/chat') return json({ messages: state.history });
    if (key === 'PUT /api/mcps/sample/chat') { state.history = record.body.messages; return json({ ok: true }); }
    if (key === 'POST /api/mcps/sample/test') { const result = { ok: false, message: 'Fixture service unreachable' }; state.modules[0].lastTest = { ...result, at: new Date().toISOString() }; return json(result); }
    if (key === 'PATCH /api/mcps/sample') { Object.assign(state.modules[0], record.body); return json({ ok: true }); }
    if (key === 'GET /api/global') return json({ provider: 'openai', openaiModel: 'fixture-model', anthropicModel: 'fixture-model', geminiModel: 'fixture-model', openaiApiKey: '••••••', anthropicApiKey: '', geminiApiKey: '', openaiEnvKeySet: false, envKeySet: false, geminiEnvKeySet: false });
    if (key === 'GET /api/instructions') return json({ instructions: 'Synthetic test instructions' });
    if (key === 'GET /api/logs') return json({ logs: [] });
    if (key === 'GET /api/backups') return json({ backups: [{ name: 'fixture-backup.tgz', size: 1024 }] });
    if (key === 'POST /api/mcps/sample/skill/share') return json({ url: `${server.base}/share/fixture-public-link` });
    if (key === 'POST /api/assistant') return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"text":"Fixture assistant response"}\n\ndata: {"done":true}\n\n' });
    state.unexpected.push(key); return json({ error: `Unmocked fixture operation: ${key}` }, 501);
  });
  const page = await context.newPage(); page.on('pageerror', (error) => state.errors.push(error.message));
  return { context, page, state,
    async login(hash = '#/overview') {
      await page.goto(server.base + '/' + hash); await page.locator('#pw').fill(password);
      await page.locator('#loginForm button[type=submit]').click();
      await page.locator('.station-shell').waitFor();
      await until(async () => !/Loading|Refreshing/.test(await page.locator('#shell-status').innerText()), 'Inventory did not settle');
      // Prefer the actual app theme control when CSS does not follow OS preference.
      if (options.theme === 'light') {
        await page.emulateMedia({ colorScheme: 'dark' });
        const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        await page.emulateMedia({ colorScheme: 'light' });
        if (await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === dark) {
          const toggle = page.getByRole('button', { name: /theme|light mode|dark mode/i });
          if (await toggle.count()) await toggle.first().click();
        }
      }
    },
    async navigate(route) {
      await page.locator(`.station-nav [data-route="${route}"]`).click();
      await page.locator(`#page-${route}`).waitFor({ state: 'visible' });
      await until(async () => (await page.locator(`.station-nav [data-route="${route}"]`).getAttribute('aria-current')) === 'page', 'Route state not current');
    },
    async library() { await this.navigate('modules'); },
    row: () => page.locator('.module-card[data-id="sample"]'),
    async more(action) { const row = this.row(); if (!await row.locator('details').getAttribute('open').then((value) => value !== null)) await row.locator('summary').click(); await row.locator(`[data-${action}]`).click(); },
    async editor() { await this.library(); await this.more('code'); await page.locator('#codeArea').waitFor(); await until(async () => (await page.locator('#codeArea').inputValue()).includes('export function'), 'Editor initial load'); },
    async close(name) {
      await mkdir(artifacts, { recursive: true });
      await page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true }).catch(() => {});
      await context.close();
      assert.deepEqual(state.unexpected, [], 'Unexpected/unmocked network operations');
      assert.deepEqual(state.errors, [], 'Browser page errors');
    }
  };
}
export async function audit(page, name) {
  const result = await new AxeBuilder({ page }).analyze();
  await mkdir(artifacts, { recursive: true });
  await writeFile(`${artifacts}/${name}.axe.json`, JSON.stringify(result.violations, null, 2));
  return result.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) }));
}
export async function assertDialogFocus(page) {
  const dialog = page.locator('dialog[open], .drawer').last(); await dialog.waitFor();
  assert(await dialog.evaluate((el) => el.matches('dialog') || el.getAttribute('role') === 'dialog'), 'Drawer must expose dialog semantics');
  assert(await dialog.evaluate((el) => !!(el.getAttribute('aria-label') || document.getElementById(el.getAttribute('aria-labelledby'))?.textContent?.trim())), 'Dialog needs an accessible name');
  assert(await dialog.evaluate((el) => el.contains(document.activeElement)), 'Focus enters actual dialog content');
  const count = await dialog.locator('button:visible:not(:disabled), input:visible:not(:disabled), select:visible:not(:disabled), textarea:visible:not(:disabled), a[href]:visible').count();
  for (let i = 0; i < count + 2; i++) { await page.keyboard.press('Tab'); assert(await dialog.evaluate((el) => el.contains(document.activeElement)), 'Forward focus escapes dialog'); }
  for (let i = 0; i < count + 2; i++) { await page.keyboard.press('Shift+Tab'); assert(await dialog.evaluate((el) => el.contains(document.activeElement)), 'Reverse focus escapes dialog'); }
}
