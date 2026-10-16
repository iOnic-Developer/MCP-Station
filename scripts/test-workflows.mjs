/** Isolated real-server workflow regression. No production modules/state/credentials.
 * PLAYWRIGHT_MODULE=/path/playwright/index.mjs AXE_MODULE=/path/@axe-core/playwright/dist/index.js
 * QA_SCREENSHOT_DIR=/workspace/scratch/station-workflow-qa node scripts/test-workflows.mjs
 * Optional QA_BROWSER_EXECUTABLE; otherwise Playwright's installed Chromium is used.
 * Both browser dependencies are required: a missing axe installation must not silently skip audits.
 * Nonzero exit on failed checks. Only sanitized, credential-free evidence is persisted.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const load = (name) => import(path.isAbsolute(name) ? pathToFileURL(name).href : require.resolve(name));
const { chromium } = await load(process.env.PLAYWRIGHT_MODULE || 'playwright');
const axe = await load(process.env.AXE_MODULE || '@axe-core/playwright');
const AxeBuilder = axe.default?.default || axe.default || axe.AxeBuilder;
const output = path.resolve(process.env.QA_SCREENSHOT_DIR || path.join(tmpdir(), 'station-workflow-qa'));
const password = 'public-workflow-fixture-password';
const secret = 'public-workflow-fixture-secret';
const sourceId = 'qa-workflow';
const results = [], audits = [], evidence = {}, pageErrors = [], externalRequests = [];
let temp, server, browser, context, page, base, accountA, accountB;
let interrupted = false;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await pause(60); }
  throw new Error('Condition did not settle');
}
async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exit = once(server, 'exit').catch(() => {});
  server.kill('SIGTERM');
  const timer = setTimeout(() => server.kill('SIGKILL'), 2500);
  await exit; clearTimeout(timer);
}
async function cleanup() {
  await browser?.close().catch(() => {});
  await stop();
  if (temp) await rm(temp, { recursive: true, force: true });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  interrupted = true;
  void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
});
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) {
    // Never emit Playwright/assertion messages, DOM dumps, requests, clipboard or server logs.
    results.push({ name, ok: false, errorType: error.name,
      source: error.stack?.split('\n').find((line) => /test-workflows\.mjs:\d/.test(line))?.trim() });
    console.log(`FAIL ${name} (${error.name}; sanitized report contains source location)`);
    await page?.locator('dialog[open] [data-no]').click({ timeout: 300 }).catch(() => {});
    await page?.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close())).catch(() => {});
  }
}
async function api(url, method = 'GET', data) {
  const response = await context.request.fetch(`${base}/api${url}`, { method, data, headers: { 'x-station-csrf': '1' }, timeout: 8000 });
  assert(response.ok(), `Fixture API status ${response.status()}`);
  return response.json();
}
async function go(hash, selector) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await until(() => page.evaluate((h) => location.hash === h, hash));
  await pause(120);
  if (selector) await page.locator(selector).first().waitFor();
}
const work = (tab = 'settings', id = sourceId) => `#/integrations/${sourceId}/${tab}?account=${id}`;
const card = () => page.locator(`[data-id="${sourceId}"]`);
const surface = () => page.locator('[data-workspace-surface]');
async function noDialog() { assert.equal(await page.locator('dialog[open]').count(), 0); }
async function labels() {
  const missing = await page.locator('input:not([type=hidden]),select,textarea').evaluateAll((els) => els.filter((el) =>
    el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !(el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'))
  ).map((el) => ({ tag: el.tagName, name: el.name, id: el.id })));
  assert.deepEqual(missing, []);
}
async function audit(name) {
  await pause(250); // Let the 180ms toast entrance animation settle before contrast measurement.
  const data = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const bad = data.violations.filter((v) => ['critical', 'serious'].includes(v.impact));
  // Selector and rule evidence only, never HTML or raw accessibility payloads.
  audits.push({ name, violations: bad.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target), contrast: v.nodes.flatMap((n) => n.any.filter((a) => a.id === 'color-contrast').map((a) => ({ foreground: a.data?.fgColor, background: a.data?.bgColor, ratio: a.data?.contrastRatio }))) })) });
  assert.equal(bad.length, 0);
}
async function screenshot(name) {
  // Never capture a newly generated one-time token, even on failed checks.
  assert.equal(await page.locator('[data-copy-token]').count(), 0);
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
}
async function clipboardEquals(value) {
  await until(async () => (await page.evaluate(() => window.__qaCopied)) === value);
}
async function saveSettings(account, label) {
  await go(work('settings', account), '#setForm');
  await surface().locator('[name=account]').fill(label);
  await surface().locator('[name=secret]').fill(secret);
  await surface().locator('[name=notes]').fill(`Public fixture ${label}`);
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().endsWith(`/api/mcps/${account}`));
  await surface().locator('[data-save]').click(); assert((await saved).ok());
  await until(async () => (await api('/mcps')).mcps.find((m) => m.id === sourceId).instances.find((i) => i.id === account).settings.account === label);
}
async function createAccount(name) {
  await go(`#/integrations/${sourceId}/add-account`, '[data-create-account]');
  await page.locator('#accountName').fill(name);
  const response = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/mcps/${sourceId}/instances`));
  await page.getByRole('button', { name: /Continue to settings/ }).click();
  const body = await (await response).json();
  await page.locator('#setForm').waitFor();
  await until(() => page.evaluate((id) => location.hash.includes(id), body.instance.id));
  return body.instance;
}
async function rpc(id, token, method = 'tools/call', params = { name: 'qa_echo', arguments: {} }) {
  const response = await fetch(`${base}/${id}/mcp`, { method: 'POST', headers: {
    'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {})
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8000) });
  return { status: response.status, body: await response.json() };
}

try {
  await mkdir(output, { recursive: true });
  temp = await mkdtemp(path.join(tmpdir(), 'station-workflows-'));
  const mcps = path.join(temp, 'mcps'); await mkdir(mcps);
  await writeFile(path.join(temp, 'package.json'), '{"type":"module"}');
  const code = `export function register({server,z,getSettings}) {
    server.registerTool('qa_echo',{description:'Local fixture only',inputSchema:{fail:z.boolean().default(false),text:z.string().default('public echo')}},async ({fail,text})=>({content:[{type:'text',text:getSettings().account+':'+text}],isError:fail}));
  }
  export async function test(settings) {return {ok:!!settings.secret && !!settings.account,message:'Local account '+settings.account};}\n`;
  for (let i = 0; i < 12; i++) {
    const id = i === 0 ? sourceId : `qa-card-${String(i).padStart(2, '0')}`;
    const dir = path.join(mcps, id); await mkdir(dir);
    const manifest = { id, slug: id, name: i === 0 ? 'QA workflow service' : `QA card ${i}`,
      version: '0.0.1', description: i % 2 ? 'Short fixture.' : 'Public fixture with a very long service description. '.repeat(18),
      settings: [ { key: 'account', label: 'Account identity', type: 'text', required: true },
        { key: 'secret', label: 'Fixture secret', type: 'secret', required: true },
        { key: 'notes', label: 'Account notes', type: 'textarea' },
        { key: 'mode', label: 'Connection mode', type: 'select', options: ['local', 'offline'] } ] };
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(path.join(dir, 'index.js'), code);
  }
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise((resolve) => socket.close(resolve)); base = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LD_LIBRARY_PATH'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  Object.assign(env, { PORT: String(port), PUBLIC_URL: base, APP_PASSWORD: password, DATA_DIR: path.join(temp, 'data'), MCPS_DIR: mcps, COOKIE_SECURE: '0', NODE_ENV: 'test' });
  server = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.resume(); server.stderr.resume();
  let spawnError; server.on('error', () => { spawnError = true; });
  await until(async () => {
    if (spawnError || server.exitCode !== null) throw new Error('Isolated server failed');
    try { return (await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; }
  }, 15000);
  browser = await chromium.launch({ headless: true, ...(process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {}) });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === base) return route.continue();
    externalRequests.push({ blocked: true }); return route.abort();
  });
  // Deterministic clipboard without browser permission prompts; real click handlers still run.
  await context.addInitScript(() => { window.__qaCopied = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__qaCopied = text; } } }); });
  page = await context.newPage(); page.setDefaultTimeout(4000);
  page.on('pageerror', () => pageErrors.push({ type: 'pageerror' }));
  await page.goto(`${base}/#/integrations/${sourceId}/code`);
  await check('Unauthenticated deep link shows login, not shared source', async () => {
    await page.getByLabel('Station password', { exact: true }).waitFor(); assert.equal(await page.locator('#codeArea').count(), 0); await labels();
  });
  await check('Unauthenticated API, usage, source and MCP are denied', async () => {
    for (const route of ['/api/mcps', '/api/usage', `/api/mcps/${sourceId}/file?path=index.js`]) {
      assert.equal((await context.request.get(base + route)).status(), 401);
    }
    assert.equal((await rpc(sourceId, null)).status, 401);
  });
  await check('Login accessibility: zero serious or critical axe violations', () => audit('login'));
  // Authentication is a prerequisite, not a mocked response.
  await page.getByLabel('Station password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('#codeArea').waitFor();
  const routes = { overview: 'Overview', integrations: 'Integrations', connect: 'Connections', assistant: 'Assistant', settings: 'Settings', backups: 'Backups & portability' };
  for (const [route, title] of Object.entries(routes)) {
    await check(`Route ${route}: real content, title, active navigation and labels`, async () => {
      await go(`#/${route}`); await page.getByRole('heading', { level: 1, name: title, exact: true }).waitFor();
      if (route === 'settings') await page.locator('#gProvider').waitFor();
      if (route === 'backups') await page.locator('[data-backup]').waitFor();
      assert.equal(await page.title(), `${title} · MCP Station`);
      assert.equal(await page.locator(`.sidebar [data-route=${route}]`).getAttribute('aria-current'), 'page');
      await noDialog(); await labels();
    });
    await check(`Route ${route}: axe serious/critical`, () => audit(route));
  }
  await go('#/integrations', '[data-id]');
  for (const width of [375, 768, 1440]) {
    await check(`Cards ${width}px: equal heights with long descriptions and no overflow`, async () => {
      await page.setViewportSize({ width, height: 1000 }); await pause(150);
      const heights = await page.locator('.integration-card:visible').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      evidence[`cardHeights${width}`] = heights;
      assert.equal(heights.length, 12); assert(Math.max(...heights) - Math.min(...heights) <= 1);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    });
    await check(`Cards ${width}px: Copy endpoint is upfront without details`, async () => {
      assert(await card().locator('[data-copy]').isVisible()); assert.equal(await card().locator('details').count(), 0);
      const endpoint = await card().locator('.endpoint code').innerText(); await card().locator('[data-copy]').click(); await clipboardEquals(endpoint); await noDialog();
    });
    await check(`Cards ${width}px: axe serious/critical`, () => audit(`cards-${width}`));
    await screenshot(`cards-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await check('Configure opens full-page settings with labelled controls, no dialog', async () => {
    await card().getByRole('link', { name: 'Configure', exact: true }).click(); await page.locator('#setForm').waitFor();
    assert((await page.evaluate(() => location.hash)).startsWith(work())); await noDialog(); await labels();
  });
  await check('Default settings save persists and masks secret', async () => {
    await saveSettings(sourceId, 'Default fixture');
    const source = (await api('/mcps')).mcps.find((m) => m.id === sourceId);
    assert.equal(source.instances[0].settings.secret, '••••••'); assert(source.instances[0].configured);
  });
  await check('Add account creates blank disabled independent settings', async () => {
    accountA = await createAccount('Personal fixture'); assert.equal(accountA.enabled, false); assert.equal(accountA.configured, false); assert.equal(accountA.settings.secret, '');
    assert.equal(await surface().locator('[name=secret]').inputValue(), ''); await noDialog();
  });
  assert(accountA, 'First account creation is a prerequisite');
  await check('Personal account saves and tests the selected configuration', async () => {
    await saveSettings(accountA.id, 'Personal fixture');
    const response = page.waitForResponse((r) => r.url().endsWith(`/api/mcps/${accountA.id}/test`));
    await surface().locator('[data-test]').click(); const body = await (await response).json(); assert(body.ok); assert.match(body.message, /Personal fixture/);
  });
  await check('Third account reuses one source and starts without credentials', async () => {
    accountB = await createAccount('Work fixture'); assert.equal(accountB.settings.secret, ''); assert.equal(accountB.enabled, false);
    await saveSettings(accountB.id, 'Work fixture');
  });
  assert(accountB, 'Second account creation is a prerequisite');
  await check('One source has three independent configurations and unchanged code', async () => {
    const list = (await api('/mcps')).mcps; assert.equal(list.length, 12);
    const source = list.find((m) => m.id === sourceId); assert.equal(source.instances.length, 3);
    assert.deepEqual(source.instances.map((i) => i.settings.account).sort(), ['Default fixture', 'Personal fixture', 'Work fixture']);
    assert.equal(await readFile(path.join(mcps, sourceId, 'index.js'), 'utf8'), code);
    assert.equal((await api(`/mcps/${sourceId}/file?path=index.js`)).content, code);
  });
  await check('Workspace dropdown switches endpoint, configuration and test target together', async () => {
    await go(work('settings', accountB.id), '#setForm'); assert.equal(await page.locator('[data-account] option').count(), 3);
    await page.locator('[data-account]').selectOption(accountA.id);
    await until(async () => (await surface().locator('[name=account]').inputValue()) === 'Personal fixture');
    assert.match(await page.locator('.workspace-endpoint code').innerText(), new RegExp(`/${accountA.id}/mcp$`));
    const response = page.waitForResponse((r) => r.url().endsWith(`/api/mcps/${accountA.id}/test`));
    await page.locator('[data-workspace-test]').click(); assert((await (await response).json()).ok);
    await until(async () => (await page.locator('[data-workspace-result]').innerText()).includes('Personal fixture'));
  });
  for (const [tab, selector] of [['connect','[data-connections]'], ['tools','[data-workspace-surface] .page-surface'], ['code','#codeArea'], ['activity','[data-usage-body] .stats-grid']]) {
    await check(`Workspace ${tab}: routed tab, selected account, no dialog, labelled fields`, async () => {
      await go(work(tab, accountA.id), selector); assert.equal(await page.locator('[data-account]').inputValue(), accountA.id);
      assert.equal(await page.locator('.workspace-tabs [aria-current=page]').count(), 1); await noDialog(); await labels();
      if (tab === 'tools') assert.match(await surface().innerText(), /qa_echo/);
      if (tab === 'code') { assert.match(await surface().innerText(), /Shared source for every account/i); assert.equal(await page.locator('[data-account] option').count(), 3); }
    });
    await check(`Workspace ${tab}: axe serious/critical`, () => audit(`workspace-${tab}`));
  }
  await go(work('settings', accountA.id), '#setForm');
  await check('Account settings: axe serious/critical', () => audit('account-settings'));
  await screenshot('account-settings');
  await check('Connections dropdown and Copy use selected endpoint', async () => {
    await go('#/connect', '[data-source]'); const row = page.locator(`[data-source=${sourceId}]`);
    await row.locator('[data-account]').selectOption(accountB.id);
    const endpoint = await row.locator('.endpoint code').innerText(); assert.match(endpoint, new RegExp(`/${accountB.id}/mcp$`));
    await row.locator('[data-copy]').click(); await clipboardEquals(endpoint); await noDialog();
  });
  await check('Connections Test calls selected account and shows actual result', async () => {
    const row = page.locator(`[data-source=${sourceId}]`);
    const response = page.waitForResponse((r) => r.url().endsWith(`/api/mcps/${accountB.id}/test`));
    await row.locator('[data-test]').click(); assert((await (await response).json()).ok);
    await until(async () => (await page.locator(`[data-source=${sourceId}] [data-result]`).innerText()).includes('Work fixture'));
  });
  await check('Connections Configure opens selected account full page', async () => {
    await page.locator(`[data-source=${sourceId}]`).getByRole('link', { name: 'Configure', exact: true }).click();
    await page.locator('#setForm').waitFor(); assert.equal(await surface().locator('[name=account]').inputValue(), 'Work fixture'); await noDialog();
  });
  await check('Library Back preserves search, filter and real nonzero scroll', async () => {
    await go('#/integrations', '[data-id]'); await page.locator('[data-mcp-search]').fill('QA'); await page.locator('[data-filter=setup]').click();
    await page.evaluate(() => window.scrollTo(0, 600)); await pause(100); const scroll = await page.evaluate(() => scrollY); assert(scroll > 100);
    const target = page.locator('.integration-card:visible').last(); await target.getByRole('link', { name: 'Configure', exact: true }).scrollIntoViewIfNeeded();
    const departureScroll = await page.evaluate(() => scrollY);
    await target.getByRole('link', { name: 'Configure', exact: true }).click();
    await page.locator('#setForm').waitFor(); const savedScroll = await page.evaluate(() => scrollY); assert.equal(savedScroll, 0);
    await page.goBack(); await page.locator('[data-mcp-search]').waitFor(); await pause(150);
    assert.equal(await page.locator('[data-mcp-search]').inputValue(), 'QA'); assert.equal(await page.locator('[data-filter=setup]').getAttribute('aria-pressed'), 'true');
    const restoredScroll = await page.evaluate(() => scrollY); evidence.libraryScroll = { departureScroll, restoredScroll }; assert(Math.abs(restoredScroll - departureScroll) <= 2);
  });
  await check('Dirty settings route guard Cancel preserves edits and current route', async () => {
    await go(work('settings', accountA.id), '#setForm'); await surface().locator('[name=account]').fill('Unsaved local change');
    await page.evaluate(() => { location.hash = '#/overview'; });
    await page.getByRole('dialog', { name: 'Discard unsaved settings?' }).waitFor(); await page.locator('dialog [data-no]').click();
    await until(() => page.evaluate((h) => location.hash === h, work('settings', accountA.id)));
    assert.equal(await surface().locator('[name=account]').inputValue(), 'Unsaved local change');
  });
  await check('Dirty account switch Cancel restores original dropdown selection', async () => {
    await page.locator('[data-account]').selectOption(accountB.id); await page.getByRole('dialog', { name: 'Discard unsaved settings?' }).waitFor();
    await page.locator('dialog [data-no]').click(); await until(async () => (await page.locator('[data-account]').inputValue()) === accountA.id);
    assert.equal(await surface().locator('[name=account]').inputValue(), 'Unsaved local change');
    assert.equal(await page.evaluate(() => location.hash), work('settings', accountA.id));
  });
  await check('Dirty settings route guard Accept discards without saving', async () => {
    await page.evaluate(() => { location.hash = '#/overview'; }); await page.locator('dialog [data-yes]').click();
    await page.getByRole('heading', { level: 1, name: 'Overview', exact: true }).waitFor();
    assert.equal((await api('/mcps')).mcps.find((s) => s.id === sourceId).instances.find((i) => i.id === accountA.id).settings.account, 'Personal fixture');
  });
  await check('Dirty editor route guard Cancel retains buffer', async () => {
    await go(work('code', accountA.id), '#codeArea'); await until(async () => (await page.locator('#codeArea').inputValue()).includes('export function register'));
    await page.locator('#codeArea').fill(`${code}\n// unsaved fixture edit`); await page.evaluate(() => { location.hash = '#/overview'; });
    await page.getByRole('dialog', { name: 'Discard unsaved edits?' }).waitFor(); await page.locator('dialog [data-no]').click();
    await until(() => page.evaluate((h) => location.hash === h, work('code', accountA.id))); assert.match(await page.locator('#codeArea').inputValue(), /unsaved fixture edit/);
  });
  await check('Dirty editor route guard Accept leaves source unchanged', async () => {
    await page.evaluate(() => { location.hash = '#/overview'; }); await page.locator('dialog [data-yes]').click();
    await page.getByRole('heading', { level: 1, name: 'Overview', exact: true }).waitFor(); assert.equal((await api(`/mcps/${sourceId}/file?path=index.js`)).content, code);
  });
  for (const [hash, text] of [
    [`#/integrations/${sourceId}/settings?account=does-not-exist`, 'This account no longer exists'],
    ['#/integrations/does-not-exist/settings', 'Integration not found'],
    [`#/integrations/${sourceId}/bogus`, 'Unknown workspace tab'],
    ['#/bad-route', 'Page not found'], ['#/integrations/%ZZ/settings', 'Page not found'],
    [`#/integrations/${sourceId}/settings?account=a&account=b`, 'Page not found']
  ]) await check(`Invalid route recovery: ${text} (${hash.includes('%ZZ') ? 'malformed encoding' : hash.split('?')[0]})`, async () => {
    await go(hash); await page.getByText(text, { exact: false }).first().waitFor(); await noDialog();
    const link = page.locator('#routeRoot a').first(); await link.click(); await until(() => page.evaluate((h) => location.hash !== h, hash));
    await page.locator('#routeRoot h1').waitFor();
  });
  await check('Setup tests and rejected MCP requests do not count as tool usage', async () => { assert.equal((await api('/usage')).totals.calls, 0); });
  // Generate only local ephemeral tokens. No screenshots or raw error payloads below this point.
  let privateToken;
  await check('Private token generation is scoped and one-time output can be copied', async () => {
    await go(work('connect', accountA.id), '[data-connections]'); await page.locator('.provider-settings summary').click();
    const response = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/mcps/${accountA.id}/token`));
    await page.locator('[data-gen]').click(); privateToken = (await (await response).json()).token; assert(typeof privateToken === 'string' && privateToken.length > 20);
    await page.locator('[data-copy-token]').waitFor(); await page.locator('[data-copy-token]').click(); await clipboardEquals(privateToken);
  });
  await check('Uncopied one-time token has a route-leave guard with Cancel and Accept', async () => {
    // Reopen to clear the first reveal; rotate, then deliberately leave the fresh value uncopied.
    await go('#/overview'); await go(work('connect', accountA.id), '[data-connections]'); await page.locator('.provider-settings summary').click();
    await page.locator('[data-gen]').click(); await page.locator('dialog [data-yes]').click();
    await page.locator('[data-copy-token]').waitFor();
    await page.evaluate(() => { location.hash = '#/overview'; }); await pause(250);
    evidence.uncopiedTokenGuard = { route: await page.evaluate(() => location.hash), openDialogs: await page.locator('dialog[open]').count(), revealStillPresent: await page.locator('[data-copy-token]').count() > 0 };
    await page.locator('dialog[open]').waitFor();
    await page.locator('dialog [data-no]').click(); await until(() => page.evaluate((h) => location.hash === h, work('connect', accountA.id)));
    assert(await page.locator('[data-copy-token]').isVisible());
    await page.evaluate(() => { location.hash = '#/overview'; }); await page.locator('dialog [data-yes]').click();
    await page.getByRole('heading', { level: 1, name: 'Overview', exact: true }).waitFor();
  });
  await go('#/overview');
  await check('Account private token cannot access another account or admin API', async () => {
    privateToken = (await api(`/mcps/${accountA.id}/token`, 'POST', {})).token;
    await api(`/mcps/${accountA.id}`, 'PATCH', { enabled: true }); await api(`/mcps/${accountB.id}`, 'PATCH', { enabled: true });
    assert.equal((await rpc(accountA.id, privateToken, 'tools/list', {})).status, 200);
    const denial = (await rpc(accountB.id, privateToken, 'tools/list', {})).status; evidence.crossAccountDenialStatus = denial; assert([401, 403].includes(denial));
    const response = await fetch(`${base}/api/usage`, { headers: { authorization: `Bearer ${privateToken}` } }); assert.equal(response.status, 401);
  });
  await check('Actual tools/call responses record two successes and one error', async () => {
    const otherToken = (await api(`/mcps/${accountB.id}/token`, 'POST', {})).token;
    const first = await rpc(accountA.id, privateToken); assert.equal(first.status, 200); assert.equal(first.body.result.content[0].text, 'Personal fixture:public echo');
    const second = await rpc(accountA.id, privateToken, 'tools/call', { name: 'qa_echo', arguments: { fail: true } }); assert.equal(second.status, 200); assert.equal(second.body.result.isError, true);
    const third = await rpc(accountB.id, otherToken); assert.equal(third.status, 200); assert.equal(third.body.result.content[0].text, 'Work fixture:public echo');
    const usage = await api('/usage'); evidence.usageTotals = usage.totals;
    assert.equal(usage.totals.calls, 3); assert.equal(usage.totals.errors, 1); assert.equal(usage.totals.successRate, 2 / 3); assert(usage.totals.averageLatencyMs >= 0);
    assert.equal(usage.daily.reduce((n, d) => n + d.calls, 0), 3);
    assert.equal(usage.integrations.find((i) => i.id === accountA.id).calls, 2);
    assert(!JSON.stringify(usage).includes(privateToken)); assert(!JSON.stringify(usage).includes(secret));
  });
  await check('Overview graph, accessible daily table and response metrics match real totals', async () => {
    await go('#/integrations'); await go('#/overview', '[data-usage-body] .stats-grid');
    const stats = page.locator('[data-overview-usage] .stat strong'); assert.deepEqual((await stats.allTextContents()).slice(0, 3), ['3', '1', '66.7%']);
    assert.match(await stats.nth(3).innerText(), /^\d+ ms$/); assert(await page.getByRole('img', { name: /Daily tool calls and errors/ }).isVisible());
    await page.locator('.usage-data summary').click(); assert.deepEqual(await page.locator('.usage-data tbody td').allTextContents(), ['3', '1']);
  });
  await check('Account Activity graph/table are scoped to selected account', async () => {
    await go(work('activity', accountA.id), '[data-usage-body] .stats-grid');
    assert.deepEqual((await page.locator('[data-usage-body] .stat strong').allTextContents()).slice(0, 3), ['2', '1', '50.0%']);
    await page.locator('.usage-data summary').click(); assert.deepEqual(await page.locator('.usage-data tbody td').allTextContents(), ['2', '1']);
    assert.equal(await page.locator('[data-usage-body] table').last().locator('tbody tr').count(), 2);
    await screenshot('account-activity');
    await page.locator('[data-days]').selectOption('30'); await until(async () => (await page.locator('[data-usage-body] .stat strong').first().innerText()) === '2');
  });
  await check('Usage with actual records: axe serious/critical', () => audit('usage-populated'));
  await check('Dark and reduced-motion layouts: all six routes at 375/768/1440px', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const route of ['overview', 'integrations', 'connect', 'assistant', 'settings', 'backups']) {
        await go('#/' + route);
        if (route === 'settings') await page.locator('#gProvider').waitFor();
        if (route === 'backups') await page.locator('[data-backup]').waitFor();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
    }
  });
  for (const route of ['overview', 'integrations', 'connect']) {
    await check('Dark accessibility: ' + route, async () => {
      await go('#/' + route);
      if (route === 'overview') await page.locator('[data-overview-usage] .stats-grid').waitFor();
      await audit('dark-' + route);
      await screenshot('dark-' + route);
    });
  }
  await check('Runtime: no uncaught browser errors or external requests', async () => { assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []); });
} catch (error) {
  results.push({ name: 'Fixture prerequisite or suite execution', ok: false, errorType: error.name,
    source: error.stack?.split('\n').find((line) => /test-workflows\.mjs:\d/.test(line))?.trim() });
  console.log(`FAIL fixture/suite prerequisite (${error.name}; raw details suppressed)`);
} finally {
  await cleanup();
  if (!interrupted) {
    const passed = results.filter((r) => r.ok).length, failed = results.length - passed;
    const report = { generatedAt: new Date().toISOString(), passed, failed, total: results.length, axeAudits: audits.length,
      results, audits, evidence, pageErrors, blockedExternalRequests: externalRequests.length,
      cleanup: { browserClosed: !browser?.isConnected(), serverExited: !server || server.exitCode !== null || server.signalCode !== null, temporaryStateRemoved: true } };
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`RESULT ${passed}/${results.length} checks passed; ${failed} failed; ${audits.length} axe audits. Isolated browser/server/temp data cleaned.`);
    process.exitCode = failed ? 1 : 0;
  }
}
