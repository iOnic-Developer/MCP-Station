/** Isolated real-server AI-first regression and shared capture lab. No paid model or live credentials. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
export const disclosure = 'Accelerated demo · local scripted AI provider · no live credentials';
export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function until(fn, label, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await pause(50); }
  throw new Error(label);
}
export async function createLab() {
  const temp = await mkdtemp(path.join(tmpdir(), 'station-ai-first-'));
  let server, browser, context, page, base;
  const records = [], requests = [], errors = [], external = [], sessions = new Map();
  let fixtureHits = 0, serial = 0;
  const sourceCode = (units = false) => `// Local deterministic weather fixture; NOT live weather.\nexport function register({server,z,fetchJson}) {\n  server.registerTool('forecast_echo', {description:'Local weather fixture forecast (not live weather)',inputSchema:{location:z.string().default('London')}}, async ({location}) => {\n    const data = await fetchJson('${fixtureBase}/weather');\n    return {content:[{type:'text',text:JSON.stringify({...data,location})}]};\n  });\n${units ? `  server.registerTool('forecast_units', {description:'Convert local fixture to Celsius or Fahrenheit',inputSchema:{units:z.enum(['C','F']).default('C')}}, async ({units}) => {\n    const data = await fetchJson('${fixtureBase}/weather');\n    return {content:[{type:'text',text:JSON.stringify({temperature:units==='F'?data.celsius*9/5+32:data.celsius,units,fixture:true})}]};\n  });\n` : ''}}\nexport async function test(settings,{fetchJson}) {\n  const data = await fetchJson('${fixtureBase}/weather');\n  return {ok:data.fixture===true && data.celsius===18,message:'Local weather fixture verified: 18 C. No live weather API or credentials.'};\n}\n`;
  let fixtureBase;
  const provider = http.createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, {'content-type':'application/json'}); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/weather') { fixtureHits++; return json(200, {fixture:true,celsius:18,condition:'clear'}); }
    if (req.method === 'GET' && req.url === '/docs') { res.writeHead(200, {'content-type':'text/plain'}); return res.end('LOCAL FIXTURE ONLY. GET /weather returns {fixture:true,celsius:18,condition:"clear"}. No authentication. Not real weather.'); }
    if (req.method !== 'POST' || req.url !== '/v1/responses') return json(404, {error:'Unknown local fixture route'});
    try {
      assert.equal(req.headers.authorization, 'Bearer public-mock-only');
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      let state = sessions.get(body.previous_response_id);
      if (!state) {
        const text = [...body.input].reverse().find((item) => item.role === 'user')?.content || '';
        const mode = /addunits/i.test(text) ? 'modify' : /repair/i.test(text) ? 'fix' : 'create';
        state = {mode, step:0, plan: mode === 'create' ? ['manifest-read','source-read','docs','manifest-write','source-write','verify'] : ['source-read','source-write','verify']};
      } else {
        for (const result of body.input.filter((item) => item.type === 'function_call_output')) {
          const output = JSON.parse(result.output); assert(!output.error && !output.load_error, `Real tool failed: ${output.error || output.load_error}`);
          if (state.last === 'manifest-read') state.manifest = JSON.parse(output.content);
          if (state.last === 'verify') assert.equal(output.content, sourceCode(state.mode === 'modify'));
        }
      }
      const stage = state.plan[state.step++]; state.last = stage;
      const id = `local_mock_${++serial}`; sessions.set(id, state);
      res.writeHead(200, {'content-type':'text/event-stream','cache-control':'no-cache'});
      const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
      event('response.created', {response:{id,status:'in_progress'}});
      await pause(160);
      if (stage) {
        let name = 'read_module_file', args = {path:'index.js'};
        if (stage === 'manifest-read') args.path = 'manifest.json';
        if (stage === 'docs') { name = 'fetch_url'; args = {url:`${fixtureBase}/docs`}; }
        if (stage === 'manifest-write') { name = 'write_module_file'; args = {path:'manifest.json',content:JSON.stringify({...state.manifest,description:'Local weather fixture demo; not live weather.',settings:[]},null,2)}; }
        if (stage === 'source-write') { name = 'write_module_file'; args = {path:'index.js',content:sourceCode(state.mode === 'modify')}; }
        records.push({mode:state.mode,stage,name});
        event('response.output_text.delta', {delta:`Local scripted provider: ${stage}.\n`});
        const item = {id:`fc_${id}`,call_id:`call_${id}`,type:'function_call',name,arguments:JSON.stringify(args)};
        event('response.output_item.added', {output_index:0,item});
        event('response.output_item.done', {output_index:0,item});
      } else event('response.output_text.delta', {delta:`LOCAL MOCK COMPLETE: ${state.mode}. Saved and read back real source. ${state.mode === 'modify' ? 'Added forecast_units; preserved forecast_echo.' : 'forecast_echo uses only the local weather fixture.'} Review Code and run Test connection. Endpoint remains disabled. No live provider or weather service was tested.`});
      event('response.completed', {response:{id,status:'completed'}}); res.end();
    } catch (error) { errors.push(error.message); if (!res.headersSent) json(500,{error:{message:'Local mock assertion failed'}}); else res.end(); }
  });
  async function close() {
    await browser?.close(); provider.closeAllConnections(); await new Promise((resolve) => provider.close(resolve));
    if (server && server.exitCode === null) { const exited = once(server,'exit'); server.kill(); const timer = setTimeout(() => server.kill('SIGKILL'),2500); await exited; clearTimeout(timer); }
    await rm(temp,{recursive:true,force:true});
  }
  try {
    provider.listen(0,'127.0.0.1'); await once(provider,'listening'); fixtureBase = `http://127.0.0.1:${provider.address().port}`;
    const mcps = path.join(temp,'mcps');
    await cp(path.join(root,'mcps'),mcps,{recursive:true,filter:(src) => !path.relative(path.join(root,'mcps'),src).split(path.sep).some((part) => part.startsWith('.'))});
    await writeFile(path.join(temp,'package.json'),'{"type":"module"}');
    const probe = http.createServer(); probe.listen(0,'127.0.0.1'); await once(probe,'listening');
    const port = probe.address().port; await new Promise((resolve) => probe.close(resolve)); base = `http://127.0.0.1:${port}`;
    const env = Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LD_LIBRARY_PATH'].filter((key) => process.env[key]).map((key) => [key,process.env[key]]));
    Object.assign(env,{PORT:String(port),PUBLIC_URL:base,APP_PASSWORD:'public-ai-lab',DATA_DIR:path.join(temp,'data'),MCPS_DIR:mcps,COOKIE_SECURE:'0',NODE_ENV:'test',ASSISTANT_PROVIDER:'openai',OPENAI_API_KEY:'public-mock-only',OPENAI_MODEL:'local-scripted-demo',OPENAI_BASE_URL:fixtureBase});
    server = spawn(process.execPath,['server/index.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']}); server.stdout.resume(); server.stderr.resume();
    await until(async () => { try { return (await fetch(`${base}/healthz`)).ok; } catch { return false; } },'Isolated server failed to start');
    const pw = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : require.resolve('playwright'));
    browser = await (pw.chromium || pw.default.chromium).launch({headless:true,...(process.env.QA_BROWSER_EXECUTABLE ? {executablePath:process.env.QA_BROWSER_EXECUTABLE} : {})});
    context = await browser.newContext({viewport:{width:1100,height:850},deviceScaleFactor:1,serviceWorkers:'block'});
    await context.route('**/*',(route) => { if (new URL(route.request().url()).origin === base) return route.continue(); external.push(new URL(route.request().url()).origin); return route.abort(); });
    const api = async (url, method='GET', data) => { const response = await context.request.fetch(`${base}/api${url}`,{method,data,headers:{'x-station-csrf':'1'}}); assert(response.ok(),`API ${url}: ${response.status()}`); return response.json(); };
    await api('/login','POST',{password:'public-ai-lab'});
    page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror',(error) => errors.push(error.message));
    page.on('request',(request) => { if (request.url() === `${base}/api/assistant`) requests.push({body:request.postDataJSON(),csrf:request.headers()['x-station-csrf']}); });
    const go = async (hash, selector) => { await page.goto(`${base}/${hash}`); if (selector) await page.locator(selector).first().waitFor(); };
    const chat = () => page.locator('.chat-body textarea');
    const send = async (mode) => { await page.locator('.chat-body .a-input button').first().click(); await until(async () => (await page.locator('.chat-body .a-msgs').innerText()).includes(`LOCAL MOCK COMPLETE: ${mode}`),`Agent ${mode} did not finish`); await until(async () => !(await page.locator('.chat-body .a-input button').first().isDisabled()),'Conversation persistence not finished'); assert.deepEqual(errors,[]); };
    return {temp,mcps,base,fixtureBase,page,context,api,go,chat,send,close,records,requests,errors,external,sourceCode,get fixtureHits(){return fixtureHits;}};
  } catch (error) { await close(); throw error; }
}

async function regression() {
  const lab = await createLab();
  let assertions = 0;
  const check = (value, label) => { assert(value, label); assertions++; console.log('PASS ' + label); };
  try {
    const { page, api } = lab;
    const globalBefore = await api('/global');
    const globalWrites = [];
    page.on('request', (request) => { if (request.url().endsWith('/api/global') && request.method() !== 'GET') globalWrites.push(request.method()); });
    await lab.go('#/overview', '[data-add]');
    check(await page.locator('.sidebar [data-route=create]').count() === 1, 'Create integration replaces primary Assistant');
    check(await page.locator('.sidebar [data-route=connect],.sidebar [data-route=assistant]').count() === 0, 'No duplicate primary Connections or Assistant');
    await page.locator('[data-add]').click(); await page.locator('#buildName').waitFor();
    check(await page.locator('form input[required],form textarea[required]').count() === 1, 'Only service name required');
    await page.locator('#buildName').fill('Weather demo');
    await page.locator('form details summary').click();
    await page.locator('#buildGoal').fill('BuildWeather: read-only local weather fixture, forecast_echo. No live API.');
    await page.locator('#buildDocs').fill('https://example.invalid/docs?token=fixture');
    await page.locator('[data-build-submit]').click();
    await until(async () => /without credentials/.test(await page.locator('[data-build-error]').innerText()), 'Unsafe URL rejection');
    check(lab.requests.length === 0, 'Unsafe URL never reaches AI');
    await page.locator('#buildDocs').fill(lab.fixtureBase + '/docs');
    const createdResponse = page.waitForResponse((r) => r.url() === lab.base + '/api/mcps' && r.request().method() === 'POST');
    await page.locator('[data-build-submit]').click(); const { id } = await (await createdResponse).json();
    await until(() => lab.requests.length === 1, 'Create directly starts AI POST');
    check((await api('/mcps')).mcps.find((m) => m.id === id).enabled === false, 'Source disabled before generation');
    check(lab.requests[0].body.mcpId === id && lab.requests[0].csrf === '1', 'Existing session/CSRF and source-scoped AI request');
    check(lab.requests[0].body.messages.at(-1).content.includes('BuildWeather'), 'Authoring prompt includes user request');
    await page.evaluate(() => { location.hash = '/integrations'; }); await page.locator('[data-mcp-search]').waitFor();
    await pause(250);
    await page.evaluate(() => { location.hash = '/create'; }); await page.locator('#buildName').waitFor();
    await until(async () => (await page.locator('.chat-body .a-msgs').innerText()).includes('LOCAL MOCK COMPLETE: create'), 'Real tool loop completes after route change');
    await until(async () => !(await page.locator('[data-build-submit]').isDisabled()), 'Build persistence completes');
    check((await api(`/mcps/${id}/file?path=index.js`)).content === lab.sourceCode(), 'Real write/hot reload/read-back produced module');
    check(lab.records.some((r) => r.name === 'write_module_file'), 'Actual authoring tools executed');
    check(await page.locator('#buildName').inputValue() === 'Weather demo', 'Form survives navigation');
    check(await page.getByRole('link', { name: 'Configure credentials', exact:true }).count() === 1, 'Configure next step available');
    check(JSON.stringify(await api('/global')) === JSON.stringify(globalBefore) && !globalWrites.length, 'Provider/model/settings unchanged');
    for (const theme of ['light','dark']) for (const width of [375,768,1440]) {
      await page.setViewportSize({width,height:1000});
      await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; },theme);
      for (const style of ['default','mono','paper','moderno','ocean']) {
        await page.evaluate((style) => { document.documentElement.dataset.style = style; },style);
        for (const hash of ['/create','/integrations']) {
          await page.evaluate((hash) => { location.hash=hash; },hash); await pause(80);
          check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow ${width}/${theme}/${style}${hash}`);
        }
      }
    }
    await page.evaluate(() => { location.hash='/connect'; });
    await until(() => page.evaluate(() => location.hash === '#/integrations'), 'Legacy route redirects');
    check(await page.locator('[data-id="' + id + '"]').count() === 1, 'Generated integration visible in installed list');
    const account = (await api(`/mcps/${id}/instances`, 'POST', {name:'Second account'})).instance;
    await page.reload(); await page.locator('[data-id="' + account.id + '"]').waitFor();
    check(await page.locator('[data-source="' + id + '"]').count() === 2, 'One row per account, not source dropdown');
    check(await page.locator('[data-id="' + account.id + '"] a[href*="account=' + account.id + '"]').count() >= 2, 'Account-specific Configure and Access links');
    await page.goto(lab.base + '/#/create'); await page.locator('#buildName').waitFor();
    await page.locator('#buildName').fill('Retry fixture');
    // Force a transport failure, then resume the same source without another POST.
    await page.route('**/api/assistant', (route) => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Local simulated outage'})}));
    await page.locator('[data-build-submit]').click();
    await until(async () => /Local simulated outage/.test(await page.locator('[data-build-error]').innerText()), 'Build failure visible');
    const beforeRetry = (await api('/mcps')).mcps.length;
    check(await page.locator('#buildName').inputValue() === 'Retry fixture', 'Failure retains input');
    await page.unroute('**/api/assistant');
    await page.locator('[data-build-submit]').click();
    await until(async () => (await page.locator('.chat-body .a-msgs').innerText()).includes('LOCAL MOCK COMPLETE: create'), 'Retry completes');
    check((await api('/mcps')).mcps.length === beforeRetry, 'Retry reuses source without duplicate');
    await page.locator('[data-build-another]').click();
    check(await page.locator('#buildName').inputValue() === '', 'Create another resets only the creation form');
    await page.route('**/api/me', async (route) => { const response = await route.fetch(); const me = await response.json(); await route.fulfill({response,json:{...me,hasAssistantKey:false,hasAnthropicKey:false}}); });
    await page.reload(); await page.locator('#buildName').waitFor();
    await page.locator('#buildName').fill('Missing key draft');
    const requestsBefore = lab.requests.length, sourcesBefore = (await api('/mcps')).mcps.length;
    await page.locator('[data-build-submit]').click();
    check(await page.locator('[data-provider-warning]').isVisible(), 'Missing key warning has Settings link');
    check(lab.requests.length === requestsBefore && (await api('/mcps')).mcps.length === sourcesBefore, 'Missing key starts neither source creation nor AI');
    await page.evaluate(() => { location.hash='/integrations'; }); await page.locator('[data-mcp-search]').waitFor();
    await page.evaluate(() => { location.hash='/create'; }); await page.locator('#buildName').waitFor();
    check(await page.locator('#buildName').inputValue() === 'Missing key draft', 'Cancel navigation preserves unsent form');
    check(globalWrites.length === 0, 'No global settings mutation across create, failure, retry or missing key');
    check(lab.errors.length === 0 && lab.external.length === 0, 'No browser errors or external browser requests');
    console.log(`PASS ${assertions} assertions: real local provider and tools; no paid AI, secrets or deployment.`);
  } finally { await lab.close(); }
}
regression().catch((error) => { console.error(error.stack); process.exitCode=1; });
