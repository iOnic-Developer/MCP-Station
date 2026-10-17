/** Isolated real-server workflow regression. No production modules/state/credentials.
 * PLAYWRIGHT_MODULE=/path/playwright/index.mjs AXE_MODULE=/path/@axe-core/playwright/dist/index.js
 * QA_SCREENSHOT_DIR=/workspace/scratch/station-workflow-qa node scripts/test-workflows.mjs
 * PRODUCT_SCREENSHOT_DIR=/explicit/product/output enables labelled sample captures after all main checks.
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
const playwright = await load(process.env.PLAYWRIGHT_MODULE || 'playwright');
// require.resolve may select the CommonJS entry; its named exports vary by version.
const chromium = playwright.chromium || playwright.default?.chromium;
assert(chromium?.launch, 'Playwright Chromium launcher is unavailable');
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
  await until(() => page.evaluate((h) => location.hash === (h === '#/connect' ? '#/integrations' : h), hash));
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
  await check('Tool count scheduler: cap, reuse, cache TTL, failures, stale render and auth cleanup', async () => {
    const { renderToolCounts } = await import('../public/assets/js/views/toolCounts.js');
    const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
    const events = new EventTarget(), pending = [];
    let active = 0, peak = 0;
    globalThis.window = events;
    globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
      active++; peak = Math.max(peak, active);
      let settled = false;
      const settle = (fn, value) => { if (!settled) { settled = true; active--; fn(value); } };
      options.signal.addEventListener('abort', () => settle(reject, new Error('aborted')), { once: true });
      pending.push({ url, options, reply: (tools, ok = true, status = 200) => settle(resolve, { ok, status, json: async () => ({ tools }) }) });
    });
    const makeRoot = (ids) => {
      const links = new Map(ids.map(id => [id, { text: '—', attrs: {}, querySelector() { return { set textContent(value) { links.get(id).text = value; } }; }, setAttribute(k,v) { this.attrs[k] = v; } }]));
      return { isConnected: true, links, querySelectorAll: () => [...links].map(([id,link]) => ({ dataset: { id }, querySelector: () => link })) };
    };
    const rows = ['a','b','c'].map(id => ({ m: { id, manifest: {} } }));
    const ctx = { me: { authed: true } }, root = makeRoot(['a','b','c']);
    const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
    try {
      renderToolCounts(root, ctx, rows); assert.equal(pending.length, 2);
      ctx.me = { authed: true }; renderToolCounts(root, ctx, rows);
      assert.equal(pending.length, 2); // Refresh must reuse the two active requests.
      pending[0].reply([{}, {}]); await flush(); assert.equal(pending.length, 3);
      pending[1].reply([], false, 500); pending[2].reply([]); await flush();
      assert.equal(peak, 2); assert.equal(root.links.get('a').text, '2');
      assert.equal(root.links.get('b').text, '—'); assert.equal(root.links.get('c').text, '0');
      renderToolCounts(root, ctx, rows); assert.equal(pending.length, 4); // Only failed b retries.
      pending[3].reply([{}]); await flush();
      renderToolCounts(root, ctx, rows); assert.equal(pending.length, 4);
      ctx.toolCounts.cache.get('a').at -= 60001;
      renderToolCounts(root, ctx, rows); assert.equal(pending.length, 5);
      // A reused, still-connected root belongs to a new render; old account results cannot apply.
      root.links.delete('a'); renderToolCounts(root, ctx, [{ m: { id: 'b', manifest: {} } }]);
      pending[4].reply([{}, {}, {}]); await flush(); assert.equal(root.links.get('b').text, '1');
      const broken = makeRoot(['broken']);
      renderToolCounts(broken, ctx, [{ m: { id: 'broken', manifest: {}, error: 'broken' } }]);
      assert.equal(pending.length, 5); assert.equal(broken.links.get('broken').text, '—');
      const next = makeRoot(['a']); renderToolCounts(next, ctx, [rows[0]]);
      assert.equal(pending.length, 6);
      events.dispatchEvent(new Event('station:unauthed')); await flush();
      assert.equal(ctx.toolCounts.cache.size, 0); assert.equal(ctx.toolCounts.jobs.size, 0);
      assert.equal(ctx.toolCounts.current, null); assert.equal(active, 0);
      assert(pending[5].options.signal.aborted);
      renderToolCounts(next, ctx, [rows[0]]); assert.equal(pending.length, 7);
      pending[6].reply([{}]); await flush(); assert.equal(next.links.get('a').text, '1');
      assert(pending.every(p => p.options.cache === 'no-store' && p.options.credentials === 'same-origin' && p.url.endsWith('/capabilities')));
    } finally {
      events.dispatchEvent(new Event('station:unauthed')); await flush();
      globalThis.fetch = originalFetch;
      if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    }
  });
  temp = await mkdtemp(path.join(tmpdir(), 'station-workflows-'));
  const mcps = path.join(temp, 'mcps'); await mkdir(mcps);
  await writeFile(path.join(temp, 'package.json'), '{"type":"module"}');
  const code = `export function register({server,z,getSettings}) {
    server.registerTool('qa_echo',{description:'Local fixture only',inputSchema:{fail:z.boolean().default(false),text:z.string().default('public echo')}},async ({fail,text})=>({content:[{type:'text',text:getSettings().account+':'+text}],isError:fail}));
    if (getSettings().account === 'Work fixture') server.registerTool('qa_work_only',{description:'Account-dependent registration fixture',inputSchema:{}},async ()=>({content:[{type:'text',text:'Work fixture'}]}));
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
  const routes = { overview: 'Overview', integrations: 'Integrations', create: 'Create integration', settings: 'Settings', backups: 'Backups & portability' };
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
    await check(`Cards ${width}px: independent account rows with no overflow`, async () => {
      await page.setViewportSize({ width, height: 1000 }); await pause(150);
      const heights = await page.locator('.integration-card:visible').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      evidence[`cardHeights${width}`] = heights;
      assert.equal(heights.length, 12); assert(heights.every((height) => height >= 44), 'Each account row has usable touch height');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    });
    await check(`Cards ${width}px: Copy endpoint is upfront without details`, async () => {
      assert(await card().locator('[data-copy]').isVisible()); assert.equal(await card().locator('details').count(), 0);
      const endpoint = await card().locator('.endpoint code').innerText(); await card().locator('[data-copy]').click(); await clipboardEquals(endpoint); await noDialog();
    });
    await check(`Cards ${width}px: icon controls, one-line tests and unified vertical switch`, async () => {
      const row = card();
      const sizes = await row.locator('.row-icon-action,.client-count-box,.tool-count-box,.vertical-enable').evaluateAll(els => els.map(el => ({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height})));
      assert.equal(sizes.length,6); assert(sizes.every(r=>r.w===44 && r.h===44));
      assert.equal(await row.getByRole('link',{name:/^Access/}).count(),0);
      assert.equal(await row.locator('.status-pill').filter({hasText:/^Enabled$|^Disabled$/}).count(),0);
      assert.equal(await row.getByRole('link',{name:'Repair, tweak or add to MCP',exact:true}).count(),1);
      for(const control of await row.locator('.row-icon-action').all()) {
        assert.equal((await control.innerText()).trim(),''); assert(await control.getAttribute('aria-label'));
      }
      for (const name of ['Configure', 'Test connection']) {
        const svg = row.getByRole(name === 'Configure' ? 'link' : 'button', { name, exact: true }).locator('svg');
        assert(await svg.evaluate(el => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility === 'visible' && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0));
      }
      await until(async () => (await row.locator('[data-tool-count] span').innerText()) === '1');
      assert.equal(await row.getByRole('link', { name: '1 registered tools — view tools', exact: true }).count(), 1);
      const summary = row.locator('[data-result]');
      await summary.evaluate(el=>{el.textContent='Long test result with extra details '.repeat(30);el.title=el.textContent;});
      assert(await summary.evaluate(el=>getComputedStyle(el).whiteSpace==='nowrap' && el.getBoundingClientRect().height<=parseFloat(getComputedStyle(el).lineHeight)+1));
      assert.match(await row.locator('.client-count-box').getAttribute('aria-label'),/authorized clients/);
      const positions = await row.locator('.vertical-enable').evaluate(el=>{const face=el.querySelector('.vertical-switch-face').getBoundingClientRect(), thumb=el.querySelector('.vertical-switch-thumb').getBoundingClientRect();return {up:thumb.top-face.top,checked:el.querySelector('input').checked}});
      assert(positions.checked ? positions.up<10 : positions.up>20);
    });
    await check(`Cards ${width}px: axe serious/critical`, () => audit(`cards-${width}`));
    await screenshot(`cards-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await check('Client and tool count links open the selected account workspace tabs', async () => {
    await card().getByRole('link', { name: /authorized clients — view activity/ }).click();
    await page.locator('[data-usage-body] .stats-grid').waitFor();
    assert.equal(await page.evaluate(() => location.hash), work('activity'));
    assert.equal(await page.locator('.workspace-tabs [aria-current=page]').innerText(), 'Activity');
    await go('#/integrations', '[data-id]');
    await until(async () => (await card().locator('[data-tool-count] span').innerText()) === '1');
    await card().getByRole('link', { name: '1 registered tools — view tools', exact: true }).click();
    await until(async () => /qa_echo/.test(await surface().innerText()));
    assert.equal(await page.evaluate(() => location.hash), work('tools'));
    assert.equal(await page.locator('.workspace-tabs [aria-current=page]').innerText(), 'Tools');
    await go('#/integrations', '[data-id]');
  });
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
  await check('Account row counts reflect real account-dependent capabilities and link to that account', async () => {
    await go('#/integrations', '[data-id]');
    for (const [account, expected] of [[accountA, 1], [accountB, 2]]) {
      const row = page.locator(`[data-id="${account.id}"]`);
      const capabilities = await api(`/mcps/${account.id}/capabilities`);
      assert.equal(capabilities.tools.length, expected);
      await until(async () => (await row.locator('[data-tool-count] span').innerText()) === String(expected));
      const source = (await api('/mcps')).mcps.find(m => m.id === sourceId);
      const records = Number(source.instances.find(m => m.id === account.id).clients || 0);
      assert.match(await row.locator('.client-count-box').getAttribute('aria-label'), new RegExp(`^${records} authorized clients`));
      await row.locator('.client-count-box').click();
      await page.locator('[data-usage-body] .stats-grid').waitFor();
      assert.equal(await page.evaluate(() => location.hash), work('activity', account.id));
      assert.equal(await page.locator('[data-account]').inputValue(), account.id);
      await go('#/integrations', '[data-id]');
      await row.locator('[data-tool-count]').click();
      await page.locator('#toolList').waitFor();
      assert.equal(await page.evaluate(() => location.hash), work('tools', account.id));
      assert.equal(await page.locator('[data-account]').inputValue(), account.id);
      assert.equal(await page.locator('#toolList .tool').count(), expected);
      await go('#/integrations', '[data-id]');
    }
  });
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
  for (const [tab, selector] of [['connect','[data-connections]'], ['tools','[data-workspace-surface] .page-surface'], ['code','#codeArea'], ['activity','[data-usage-body] .stats-grid'], ['assistant','[data-module-assistant] textarea']]) {
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
    await go('#/integrations', '[data-source]'); const row = page.locator(`[data-id="${accountB.id}"]`);
    const endpoint = await row.locator('.endpoint code').innerText(); assert.match(endpoint, new RegExp(`/${accountB.id}/mcp$`));
    await row.locator('[data-copy]').click(); await clipboardEquals(endpoint); await noDialog();
  });
  await check('Connections Test calls selected account and shows actual result', async () => {
    const row = page.locator(`[data-id="${accountB.id}"]`);
    const response = page.waitForResponse((r) => r.url().endsWith(`/api/mcps/${accountB.id}/test`));
    await row.locator('[data-test]').click(); assert((await (await response).json()).ok);
    await until(async () => (await page.locator(`[data-id="${accountB.id}"] [data-result]`).innerText()).includes('Work fixture'));
  });
  await check('Connections Configure opens selected account full page', async () => {
    await page.locator(`[data-id="${accountB.id}"]`).getByRole('link', { name: 'Configure', exact: true }).click();
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
  // Generate only local ephemeral tokens. Never capture a revealed token or emit raw error payloads.
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
  await check('Refinement: library assistant is one click and source-scoped', async () => {
    await go('#/integrations', '[data-id]');
    await page.locator('[data-filter=all]').click();
    await page.locator('[data-search-clear]').click();
    const link = card().getByRole('link', {name: 'Repair, tweak or add to MCP', exact:true});
    assert(await link.isVisible());
    await link.click(); await page.locator('[data-module-assistant] textarea').waitFor();
    assert.match(await page.evaluate(() => location.hash), /\/assistant/);
    assert.match(await page.locator('[data-module-assistant]').innerText(), /all accounts/);
    const response = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith(`/api/mcps/${sourceId}/chat`));
    await page.locator('[data-module-assistant] [data-clear]').click();
    await page.locator('dialog [data-yes]').click();
    assert((await response).ok());
  });
  for (const width of [375,768,1440]) {
    await check('Refinement: compact header and six uniform tabs at '+width+'px', async () => {
      await page.setViewportSize({width,height:900});
      await go(work('settings', accountA.id),'#setForm');
      assert.equal(await page.locator('.account-progress').count(),0);
      const tabs = await page.locator('.workspace-tabs a').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {w:r.width,h:r.height,y:r.y};}));
      assert.equal(tabs.length,6);
      assert(Math.max(...tabs.map(t=>t.w))-Math.min(...tabs.map(t=>t.w))<2);
      assert(tabs.every(t=>t.h>=44));
      const rows = new Map(); for(const t of tabs){const y=Math.round(t.y);rows.set(y,(rows.get(y)||0)+1);}
      assert([...rows.values()].every(n=>n===3||n===6),'No orphan tab row');
      const header = await page.locator('.workspace-endpoint').boundingBox();
      assert(header.height < (width<1000 ? 260:180),'Action bar remains compact');
      await audit('refined-workspace-'+width);
      await screenshot('refined-workspace-'+width);
    });
    for (const height of [520,900]) {
      await check('Refinement: assistant viewport and composer '+width+'x'+height,async()=>{
        await page.setViewportSize({width,height}); await go('#/assistant','.assistant-page textarea');
        await pause(120);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        const geometry=await page.locator('.assistant-page').evaluate(el=>{const r=el.getBoundingClientRect(),c=el.querySelector('.a-input').getBoundingClientRect(),n=document.querySelector('.bottom-nav'),nr=n?.getBoundingClientRect();return {height:r.height,bottom:c.bottom,limit:n&&getComputedStyle(n).display!=='none'?nr.top:innerHeight,doc:document.documentElement.scrollHeight,viewport:innerHeight};});
        evidence['assistantGeometry'+width+'x'+height]=geometry;
        assert(geometry.height>height*.5,'Chat owns most available workspace');
        assert(geometry.bottom<=geometry.limit+1,'Composer not covered by navigation');
        assert(geometry.doc<=geometry.viewport+1,'No nested page-sized document scroll');
        await page.getByLabel('Message to the assistant').fill('Local unsent draft');
        await page.evaluate(()=>window.dispatchEvent(new Event('station:mcps-changed')));await pause(180);
        assert.equal(await page.getByLabel('Message to the assistant').inputValue(),'Local unsent draft');
      });
    }
  }
  await check('Refinement: numbered setup strip removed from new account page',async()=>{
    await go('#/integrations/new','#accountName');assert.equal(await page.locator('.account-progress').count(),0);
  });
  // Real served-app navigation regressions. No intercepted API responses or injected PWA state.
  const navigationRoutes = [...Object.keys(routes).map((r) => '#/' + r), work('settings', accountA.id)];
  async function keyboardReach(target) {
    const limit = await page.locator('a[href],button,input,select,textarea,[tabindex]').count() + 3;
    for (let i = 0; i < limit; i++) {
      if (await target.evaluate((el) => el === document.activeElement)) return;
      await page.keyboard.press('Tab');
    }
    assert.fail('Control is not reachable with Tab');
  }
  async function railState(collapsed) {
    const toggle = page.locator('[data-sidebar-toggle]');
    if (await page.evaluate(() => localStorage.getItem('station.sidebar.collapsed') === null)) { await toggle.click(); await toggle.click(); }
    if ((await toggle.getAttribute('aria-expanded')) !== String(!collapsed)) await toggle.click();
    await pause(100);
    assert.equal(await toggle.getAttribute('aria-expanded'), String(!collapsed));
    assert.equal(await toggle.getAttribute('aria-label'), collapsed ? 'Expand navigation' : 'Collapse navigation');
    assert.equal(await toggle.getAttribute('aria-controls'), 'station-sidebar');
    const box = await toggle.boundingBox(); assert(box.width >= 44 && box.height >= 44);
    assert.equal(Math.round((await page.locator('.sidebar').boundingBox()).width), collapsed ? 72 : 216);
    assert.equal(await page.evaluate(() => localStorage.getItem('station.sidebar.collapsed')), collapsed ? '1' : '0');
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; localStorage.setItem('station.theme', 'light'); });
  for (const collapsed of [false, true]) {
    for (const hash of navigationRoutes) {
      await check(`Navigation ${collapsed ? 'collapsed' : 'expanded'} ${hash}: Not now geometry, hit target, keyboard and real dismissal`, async () => {
        // Dismissal is session-scoped; a genuine reload remounts the real PWA module.
        await page.evaluate(() => sessionStorage.removeItem('mcp-station-pwa-install-dismissed'));
        await page.goto(base + '/' + hash); await page.reload();
        await page.locator('#routeRoot h1').first().waitFor(); await railState(collapsed);
        const dismiss = page.locator('.station-pwa [data-dismiss]'); await dismiss.waitFor();
        await dismiss.scrollIntoViewIfNeeded(); await pause(100);
        const rail = await page.locator('.sidebar').boundingBox(), button = await dismiss.boundingBox();
        assert(button && button.x >= rail.x + rail.width, 'Not now must be right of the actual sidebar');
        assert(await dismiss.evaluate((el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit === el || el.contains(hit); }));
        await keyboardReach(dismiss); assert.equal(await dismiss.getAttribute('aria-label'), 'Dismiss installation suggestion');
        // Exercise pointer activation after keyboard reachability, not a DOM .click().
        await dismiss.click(); assert(await dismiss.evaluate((el) => el.hidden));
        assert.equal(await page.evaluate(() => sessionStorage.getItem('mcp-station-pwa-install-dismissed')), '1');
        await page.reload(); await page.locator('#routeRoot h1').first().waitFor();
        assert(await page.locator('.station-pwa [data-dismiss]').evaluate((el) => el.hidden));
        assert.equal(await page.locator('[data-sidebar-toggle]').getAttribute('aria-expanded'), String(!collapsed));
        assert.equal(Math.round((await page.locator('.sidebar').boundingBox()).width), collapsed ? 72 : 216);
        evidence[`navigation:${collapsed}:${hash}`] = { sidebarWidth: rail.width, dismissLeft: button.x, centerHit: true, keyboardReachable: true, hiddenAfterClickAndReload: true };
      });
    }
  }
  await check('Navigation: keyboard toggle, remembered states, unclipped focus tooltip and Escape', async () => {
    await railState(false); const toggle = page.locator('[data-sidebar-toggle]');
    await keyboardReach(toggle); await page.keyboard.press('Enter'); await railState(true);
    const link = page.locator('.sidebar [data-route=overview]');
    await keyboardReach(link); const tip = link.locator('.nav-tooltip'); await tip.waitFor({ state: 'visible' });
    assert.equal(await link.getAttribute('aria-label'), 'Overview'); assert.equal(await tip.innerText(), 'Overview');
    assert(await tip.evaluate((el) => { const r = el.getBoundingClientRect(), rail = document.querySelector('.sidebar').getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return r.left >= rail.right && r.right <= innerWidth && (hit === el || el.contains(hit)); }));
    await page.keyboard.press('Escape'); assert(!(await tip.isVisible()));
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab'); assert(await tip.isVisible());
    await page.keyboard.press('Escape'); await keyboardReach(toggle); await page.keyboard.press('Space'); await railState(false);
    await page.reload(); await page.locator('[data-sidebar-toggle]').waitFor(); await railState(false);
    await railState(true);
  });
  for (const width of [375, 720]) {
    await check(`Navigation mobile ${width}px: saved collapse reflows all routes and full menu works`, async () => {
      await page.setViewportSize({ width, height: 900 });
      for (const hash of navigationRoutes) {
        await go(hash); await page.locator('#routeRoot h1').first().waitFor();
        assert(!(await page.locator('.sidebar').isVisible())); assert(!(await page.locator('[data-sidebar-toggle]').isVisible()));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.equal(await page.locator('.workspace').evaluate((el) => parseFloat(getComputedStyle(el).marginInlineStart)), 0);
      }
      for (const [route, title] of Object.entries(routes)) {
        await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
        const menu = page.locator('dialog[open] .mobile-nav'); await menu.waitFor();
        assert.equal(await menu.locator('a').count(), 5);
        for (const label of Object.values(routes)) assert(await menu.getByRole('link', { name: label, exact: true }).isVisible());
        await menu.getByRole('link', { name: title, exact: true }).click(); await noDialog();
        await until(() => page.evaluate((h) => location.hash === h, '#/' + route));
      }
      await audit('navigation-mobile-' + width);
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await check('Identity: source category, tone and monogram survive account, enablement, test and theme changes', async () => {
    await go('#/integrations', '[data-id]'); await page.locator('[data-filter=all]').click(); await page.locator('[data-search-clear]').click();
    const identity = async () => card().evaluate((el) => ({ tone: el.dataset.serviceTone, category: el.querySelector('.service-category').textContent, monogram: el.querySelector('.service-monogram').textContent }));
    const baseline = await identity();
    assert.equal(baseline.category, 'Work & automation'); assert.equal(baseline.monogram, 'QW');
    let hash = 0; for (const char of sourceId) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
    assert.equal(baseline.tone, ['forest', 'ocean', 'plum', 'slate'][hash % 4]);
    assert.equal(await page.locator('[data-id="qa-card-01"] .service-category').innerText(), 'Custom integration');
    assert.equal(await page.locator('[data-id="qa-card-01"] .service-monogram').innerText(), 'QC');
    assert.equal(await page.locator(`[data-id="${sourceId}"] .service-monogram`).innerText(), baseline.monogram);
    const enabled = (await api('/mcps')).mcps.find((m) => m.id === sourceId).instances.find((a) => a.id === sourceId).enabled;
    try {
      const patched = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().endsWith(`/api/mcps/${sourceId}`));
      await card().locator('[data-toggle]').click(); assert((await patched).ok()); await pause(180); assert.deepEqual(await identity(), baseline);
      const tested = page.waitForResponse((r) => r.url().endsWith(`/api/mcps/${sourceId}/test`));
      await card().locator('[data-test]').click(); assert((await tested).ok()); await pause(180); assert.deepEqual(await identity(), baseline);
      for (const theme of ['dark', 'light']) {
        await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
        for (const width of [375, 768, 1440]) {
          await page.setViewportSize({ width, height: 1000 }); await pause(100);
          const heights = await page.locator('.integration-card:visible').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
          assert.equal(heights.length, 14); assert(heights.every((height) => height >= 44), 'Independent account metadata may wrap without clipping'); assert.deepEqual(await identity(), baseline);
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        }
      }
    } finally { await api(`/mcps/${sourceId}`, 'PATCH', { enabled }); }
  });
  for (const theme of ['light', 'dark']) await check(`Navigation collapsed ${theme}: axe serious/critical`, async () => {
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await go('#/integrations', '[data-id]'); await railState(true); await audit('navigation-collapsed-' + theme);
  });
  await check('Navigation: logout removes authenticated rail reservation and assistant layout', async () => {
    await page.evaluate(() => sessionStorage.removeItem('mcp-station-pwa-install-dismissed'));
    await page.goto(base + '/#/assistant'); await page.reload(); await page.locator('.assistant-page').waitFor(); await railState(true);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByLabel('Station password', { exact: true }).waitFor();
    for (const cls of ['station-authenticated', 'sidebar-collapsed', 'assistant-workspace']) assert(!(await page.locator('body').evaluate((el, c) => el.classList.contains(c), cls)));
    assert.equal(await page.locator('.sidebar').count(), 0);
    assert.equal(await page.locator('.station-pwa').evaluate((el) => parseFloat(getComputedStyle(el).marginInlineStart)), 16);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByLabel('Station password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.locator('.assistant-page').waitFor(); await railState(true);
  });
  await check('Runtime: no uncaught browser errors or external requests', async () => { assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []); });
  // Optional publication phase only AFTER canonical assertions, including QA-name expectations.
  // These are illustrative custom fixtures, not bundled integrations or external service health.
  if (process.env.PRODUCT_SCREENSHOT_DIR && results.every((r) => r.ok)) {
    await check('Product screenshots: actual served app, sample manifests only, no revealed credentials', async () => {
      const productOutput = path.resolve(process.env.PRODUCT_SCREENSHOT_DIR); await mkdir(productOutput, { recursive: true });
      const samples = [
        ['Files', 'Organise documents and work with files in a self-hosted workspace.'],
        ['Gemini', 'Explore an AI service integration and its account settings.'],
        ['Telegram', 'Connect messaging tools to a personal or team workflow.'],
        ['SiYuan', 'Bring notes and knowledge into an assistant workflow.'],
        ['n8n', 'Connect automation workflows through a service integration.'],
        ['Radarr', 'Manage a movie library through a media integration.'],
        ['Sonarr', 'Explore television library tools in your workspace.'],
        ['OpenProject', 'Keep project work connected to assistant workflows.'],
        ['Xero', 'Explore a custom accounting integration.'],
        ['Station', 'Manage tools and accounts from one workspace.'],
        ['Weather', 'An illustrative custom service for weather tools.'],
        ['Calendar', 'An illustrative custom service for calendar workflows.']
      ];
      const sources = (await api('/mcps')).mcps;
      for (let i = 0; i < samples.length; i++) {
        const id = i === 0 ? sourceId : `qa-card-${String(i).padStart(2, '0')}`;
        const manifest = structuredClone(sources.find((m) => m.id === id).manifest);
        [manifest.name, manifest.description] = samples[i];
        await api(`/mcps/${id}/file`, 'PUT', { path: 'manifest.json', content: JSON.stringify(manifest, null, 2) });
      }
      await api('/reload', 'POST', {});
      await page.evaluate(() => { localStorage.setItem('station.theme', 'light'); sessionStorage.setItem('mcp-station-pwa-install-dismissed', '1'); });
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(base + '/#/integrations'); await page.reload(); await page.locator('[data-id]').first().waitFor(); await railState(false);
      async function captureProduct(name) {
        assert.equal(await page.locator('[data-copy-token]').count(), 0);
        assert.equal(await page.locator('input[type=password]:visible').count(), 0);
        const text = await page.locator('body').innerText();
        for (const value of [password, secret, privateToken].filter(Boolean)) assert(!text.includes(value));
        await page.evaluate(() => {
          document.querySelector('[data-qa-sample-caption]')?.remove();
          const caption = document.createElement('div'); caption.dataset.qaSampleCaption = '';
          caption.textContent = 'Illustrative workspace · sample integrations';
          caption.style.cssText = 'position:fixed;top:0;right:0;z-index:9999;padding:5px 10px;background:#f0f4f3;color:#243e38;font:11px/16px sans-serif;border:1px solid #cad7d2;border-radius:0 0 0 8px;pointer-events:none';
          document.body.append(caption);
        });
        await page.mouse.move(0, 0); await pause(250);
        await page.screenshot({ path: path.join(productOutput, `${name}.png`), fullPage: false });
      }
      await captureProduct('integrations');
      await go('#/assistant', '.assistant-page textarea'); await captureProduct('assistant');
      await go(work('connect', accountA.id), '[data-connections]'); await captureProduct('workspace');
      await page.setViewportSize({ width: 390, height: 844 }); await go('#/integrations', '[data-id]');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await captureProduct('mobile');
      assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []);
      evidence.productScreenshots = { files: ['integrations.png', 'assistant.png', 'workspace.png', 'mobile.png'], sampleCaption: true, realServer: true, semanticSourceIdsUnchanged: true };
    });
  }
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
