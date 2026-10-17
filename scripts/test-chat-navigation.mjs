/** Real Chromium + isolated Station + gated loopback OpenAI SSE provider.
 * PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs node scripts/test-chat-navigation.mjs
 * No production state/env, external browser requests, model calls, or credentials.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const pw = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : require.resolve('playwright'));
const chromium = pw.chromium || pw.default.chromium;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await pause(25); }
  throw new Error(label);
}
const turns = [], errors = [], external = [], csrf = [], bodies = [], releases = [];
let temp, server, browser, context, page, base;
const provider = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  assert.equal(req.url, '/v1/responses');
  const body = JSON.parse(raw);
  const turn = { res, body, aborted: false, finished: false, index: turns.length + 1 };
  turns.push(turn);
  res.on('close', () => { if (!turn.finished) turn.aborted = true; });
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  turn.finish = () => {
    turn.finished = true;
    event('response.output_text.delta', { delta: ` final-${turn.index}` });
    event('response.completed', { response: { id: `r${turn.index}`, status: 'completed' } });
    res.end();
  };
  turn.tool = () => {
    turn.finished = true;
    const item = {id:`fc${turn.index}`,call_id:`call${turn.index}`,type:'function_call',name:'edit_module_file',arguments:JSON.stringify({path:'index.js',find:'export function register() {}',replace:'// assistant fixture revision\nexport function register() {}'})};
    event('response.output_item.added', {output_index:0,item});
    event('response.output_item.done', {output_index:0,item});
    event('response.completed', {response:{id:`r${turn.index}`,status:'completed'}});
    res.end();
  };
  event('response.created', { response: { id: `r${turn.index}`, status: 'in_progress' } });
  event('response.output_text.delta', { delta: `partial-${turn.index}` });
});
const chat = () => page.locator('.chat-body textarea');
const text = () => page.locator('.chat-body .a-msgs');
async function go(hash, selector) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForFunction((h) => location.hash === h, hash);
  if (selector) await page.locator(selector).first().waitFor();
}
async function start(prompt) {
  const n = turns.length;
  await chat().fill(prompt); await page.locator('.chat-body .a-input button').first().click();
  await until(() => turns.length === n + 1, 'Provider request missing');
  await until(async () => (await text().innerText()).includes(`partial-${n + 1}`), 'First real SSE chunk missing');
  return turns[n];
}
async function api(url, method = 'GET', data) {
  const r = await context.request.fetch(`${base}/api${url}`, { method, data, headers: { 'x-station-csrf': '1' } });
  assert(r.ok(), `Fixture API ${r.status()}`); return r.json();
}
try {
  temp = await mkdtemp(path.join(tmpdir(), 'station-chat-navigation-'));
  const mcps = path.join(temp, 'mcps'); await mkdir(mcps);
  await writeFile(path.join(temp, 'package.json'), '{"type":"module"}');
  for (const id of ['fixture-a', 'fixture-b']) {
    const dir = path.join(mcps, id); await mkdir(dir);
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ id, slug: id, name: id, version: '0.0.1', settings: [{key:'secret',label:'Secret',type:'secret'}] }));
    await writeFile(path.join(dir, 'index.js'), 'export function register() {}\n');
  }
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  const probe = http.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise((r) => probe.close(r)); base = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LD_LIBRARY_PATH'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  Object.assign(env, { PORT: String(port), PUBLIC_URL: base, APP_PASSWORD: 'public-navigation-fixture', DATA_DIR: path.join(temp, 'data'), MCPS_DIR: mcps, COOKIE_SECURE: '0', NODE_ENV: 'test', ASSISTANT_PROVIDER: 'openai', OPENAI_API_KEY: 'public-mock-only', OPENAI_BASE_URL: `http://127.0.0.1:${provider.address().port}` });
  server = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore','pipe','pipe'] }); server.stdout.resume(); server.stderr.resume();
  await until(async () => { try { return (await fetch(`${base}/healthz`)).ok; } catch { return false; } }, 'Fixture boot failed', 15000);
  browser = await chromium.launch({ headless: true, ...(process.env.QA_BROWSER_EXECUTABLE ? {executablePath:process.env.QA_BROWSER_EXECUTABLE} : {}) });
  context = await browser.newContext({ viewport: {width:1440,height:1000}, serviceWorkers:'block' });
  await context.route('**/*', (route) => { if (new URL(route.request().url()).origin === base) return route.continue(); external.push(true); return route.abort(); });
  await api('/login', 'POST', {password:'public-navigation-fixture'});
  const account = await api('/mcps/fixture-a/instances', 'POST', {name:'Second fixture account'});
  const accountId = account.instance?.id || account.id;
  assert(accountId, 'Created account id missing');
  page = await context.newPage(); page.setDefaultTimeout(4000);
  page.on('pageerror', () => errors.push(true));
  page.on('request', (r) => { if (r.url() === `${base}/api/assistant`) { csrf.push(r.headers()['x-station-csrf']); bodies.push(r.postDataJSON()); } });
  await page.goto(`${base}/#/assistant`); await chat().waitFor();
  const first = await start('station navigation');
  await page.locator('.sidebar a[data-route="integrations"]').click();
  await page.locator('.page-heading h1').waitFor();
  first.finish();
  await page.locator('.sidebar a[data-route="assistant"]').click(); await chat().waitFor();
  await until(async () => (await text().innerText()).includes('final-1'), 'FAIL route navigation cancelled live SSE: final-1 missing');
  assert(!first.aborted, 'Route navigation aborted provider stream');
  console.log('PASS station real-route delayed SSE survives navigation');
  await page.evaluate(async () => { const {stageDraft} = await import('/assets/js/chatSessions.js'); await stageDraft('station', 'staged station draft'); });
  assert.equal(await chat().inputValue(), 'staged station draft'); assert.equal(turns.length, 1);

  // More lifecycle checks run only after the original regression is green.
  const source = (id, tab = 'assistant') => `#/integrations/${id}/${tab}`;
  await go(source('fixture-a'), '.module-assistant textarea');
  const second = await start('source A navigation');
  assert(!second.aborted);
  assert(!(await text().innerText()).includes('final-2'));
  await chat().fill('unsent source A draft');
  await go(source('fixture-a','code'), '.editor-chat textarea');
  assert((await text().innerText()).includes('partial-2'));
  assert.equal(await chat().inputValue(), 'unsent source A draft');
  await go(source('fixture-b'), '.module-assistant textarea');
  assert(!(await text().innerText()).includes('partial-2'));
  const third = await start('source B navigation');
  await go('#/overview', '.welcome-panel');
  {
    assert.equal(await page.locator('[data-assistant-status]').getAttribute('data-running-count'), '2');
    await page.locator('[data-assistant-status] a').first().click(); await chat().waitFor();
    assert.equal(new URL(page.url()).hash, source('fixture-a'));
    await go('#/overview', '.welcome-panel');
  }
  assert((await page.locator('[data-assistant-status]').innerText()).includes('2 assistant replies'));
  assert(!(await page.locator('[data-assistant-status]').innerText()).includes('partial-'));
  second.finish();
  await until(async () => (await page.locator('[data-assistant-status]').getAttribute('data-running-count')) === '1', 'Status failed to decrement from two to one');
  third.finish();
  await until(async () => (await page.locator('[data-assistant-status]').getAttribute('data-running-count')) === '0', 'Status failed to clear after detached completion');
  await go(source('fixture-a'), '.module-assistant textarea');
  await until(async () => (await text().innerText()).includes('final-2'), 'Source A lost detached completion');
  assert.equal(await chat().inputValue(), 'unsent source A draft');
  await page.goBack(); await page.goForward(); await chat().waitFor();
  assert((await text().innerText()).includes('final-2'));
  const saved = await api('/mcps/fixture-a/chat');
  assert.equal(saved.messages.filter((m) => m.role === 'user').length, 1);
  assert(saved.messages.some((m) => m.content.includes('final-2')));
  await go(source('fixture-a') + `?account=${encodeURIComponent(accountId)}`, '.module-assistant textarea');
  assert((await text().innerText()).includes('final-2'));
  assert.equal(await chat().inputValue(), 'unsent source A draft');
  assert.equal(bodies[1].mcpId, 'fixture-a'); assert.equal(bodies[2].mcpId, 'fixture-b');
  assert.equal(turns.length, 3);
  console.log('PASS source/editor single controller, draft, history, independent scopes and browser history');
  await go(source('fixture-b'), '.module-assistant textarea');
  assert((await text().innerText()).includes('final-3'));
  const stopped = await start('explicit stop');
  await page.locator('[data-stop]').click();
  await until(() => stopped.aborted, 'Stop failed to abort real upstream');
  console.log('PASS explicit Stop aborts real upstream');
  const logout = await start('logout stop');
  await page.locator('[data-logout]').click();
  await until(() => logout.aborted, 'Logout failed to abort real upstream');
  await page.locator('input[type=password]').waitFor();
  await api('/login','POST',{password:'public-navigation-fixture'}); await page.reload();
  await go('#/assistant', '.assistant-page textarea');
  assert(!(await text().innerText()).includes('partial-1'));
  console.log('PASS logout aborts and clears cached station session');
  const unauth = await start('expired auth stop');
  await go(source('fixture-a'), '.module-assistant textarea');
  const other = await start('other source expired auth');
  await api('/logout', 'POST');
  await page.evaluate(async () => { const {api} = await import('/assets/js/api.js'); await api('/mcps').catch(() => {}); });
  await until(() => unauth.aborted && other.aborted, '401 failed to abort all sessions');
  await page.locator('input[type=password]').waitFor();
  assert(csrf.every((v) => v === '1')); assert.deepEqual(external, []); assert.deepEqual(errors, []);
  console.log('PASS 401 aborts every scope; CSRF intact; zero external calls/page errors');
  await api('/login','POST',{password:'public-navigation-fixture'}); await page.reload();
  await go('#/assistant', '.assistant-page textarea');
  const network = await start('network boot failure');
  await page.route('**/api/me', (route) => route.abort('failed'));
  await page.evaluate(() => window.dispatchEvent(new Event('station:mcps-changed')));
  await until(() => network.aborted, 'Network boot failure did not abort session');
  await page.locator('#retryBoot').waitFor();
  await page.unroute('**/api/me'); await page.locator('#retryBoot').click();
  await chat().waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('station.chat.v1')), null);
  // Concurrent consumers share the same pending load; reset invalidates its resolution.
  let releaseLoad;
  const loadGate = new Promise((resolve) => { releaseLoad = resolve; releases.push(resolve); });
  let chatGets = 0;
  await page.route('**/api/mcps/fixture-b/chat', async (route) => { chatGets++; await loadGate; await route.continue(); });
  await page.evaluate(() => {
    window.__sessionCheck = import('/assets/js/chatSessions.js').then(async (store) => {
      store.resetChatSessions();
      const a = store.getSourceSession('fixture-b'), b = store.getSourceSession('fixture-b');
      window.__samePending = a === b;
      window.__settledLoads = Promise.allSettled([a,b]);
    });
    return window.__sessionCheck;
  });
  await until(() => chatGets === 1, 'Concurrent history load was not deduplicated');
  assert(await page.evaluate(() => window.__samePending));
  await page.evaluate(async () => (await import('/assets/js/chatSessions.js')).resetChatSessions());
  releaseLoad();
  assert(await page.evaluate(async () => (await window.__settledLoads).every((result) => result.status === 'rejected')));
  await page.unroute('**/api/mcps/fixture-b/chat');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS network failure teardown, draft staging and pending-load generation fence');
  let retries = 0;
  await page.route('**/api/mcps/fixture-a/chat', async (route) => {
    if (route.request().method() === 'GET' && retries++ === 0) return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Public fixture load failure"}'});
    return route.continue();
  });
  await go(source('fixture-a'), '.assistant-load-error');
  await page.locator('[data-retry]').click(); await chat().waitFor();
  assert.equal(retries, 2); await page.unroute('**/api/mcps/fixture-a/chat');
  const tool = await start('edit local fixture and keep streaming');
  await chat().fill('draft while tools run');
  let releaseSave, puts = 0;
  const saveGate = new Promise((resolve) => { releaseSave = resolve; releases.push(resolve); });
  await page.route('**/api/mcps/fixture-a/chat', async (route) => {
    if (route.request().method() === 'PUT') { puts++; if (puts === 1) await saveGate; }
    await route.continue();
  });
  await go('#/overview', '.welcome-panel');
  tool.tool();
  await until(() => turns.length === tool.index + 1, 'Real tool follow-up provider request missing');
  const followup = turns.at(-1);
  assert.equal(followup.body.previous_response_id, `r${tool.index}`);
  await go(source('fixture-a','code'), '.editor-chat textarea');
  await until(async () => (await page.locator('#codeArea').inputValue()).includes('assistant fixture revision'), 'Returning editor failed to reload assistant-edited source');
  await until(async () => (await text().innerText()).includes(`partial-${followup.index}`), 'Detached tool-followup delta lost');
  const transcript = await text().innerText();
  assert(transcript.includes(`partial-${tool.index}`)); assert(transcript.includes('Completed:'));
  assert.equal(await chat().inputValue(), 'draft while tools run');
  await go(source('fixture-a'), '.module-assistant textarea');
  assert((await text().innerText()).includes('Completed:'));
  await go('#/overview', '.welcome-panel');
  followup.finish();
  await until(() => puts === 1, 'First history write not observed');
  // Drain browser tasks while first persistence is gated: no overlapping second PUT.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(puts, 1); releaseSave();
  await until(async () => (await page.locator('[data-assistant-status]').getAttribute('data-running-count')) === '0', 'Tool conversation failed to finish serialized saves');
  await page.unroute('**/api/mcps/fixture-a/chat');
  await go(source('fixture-a'), '.module-assistant textarea');
  assert((await text().innerText()).includes(`final-${followup.index}`));
  assert((await text().innerText()).includes('Completed:'));
  const toolHistory = (await api('/mcps/fixture-a/chat')).messages;
  assert.equal(toolHistory.filter((m) => m.content === 'edit local fixture and keep streaming').length, 1);
  assert(toolHistory.some((m) => m.content.includes(`final-${followup.index}`)));
  assert(puts >= 2); assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS real tool status/output survives detached hops, editor reloads disk, history PUTs serialize');
  await go(source('fixture-b','code'), '.editor-chat textarea');
  const hidden = await start('hidden composer focus');
  await page.locator('[data-chat]').click();
  await page.locator('#codeArea').focus(); hidden.finish();
  await until(async () => (await page.locator('[data-assistant-status]').getAttribute('data-running-count')) === '0', 'Hidden composer did not finish');
  assert(await page.locator('#codeArea').evaluate((el) => document.activeElement === el));
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS completing hidden composer does not steal editor focus');
} catch (e) {
  console.error(e.message);
  console.error(e.stack?.split('\n').find((line) => /test-chat-navigation.mjs:\d/.test(line))?.trim() || '');
  process.exitCode = 1;
} finally {
  for (const release of releases) release();
  await browser?.close();
  for (const turn of turns) turn.res.destroy();
  provider.closeAllConnections(); await new Promise((r) => provider.close(r));
  if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill('SIGTERM'); const timer = setTimeout(() => server.kill('SIGKILL'), 2500); await exited; clearTimeout(timer); }
  if (temp) await rm(temp, { recursive:true, force:true });
}
