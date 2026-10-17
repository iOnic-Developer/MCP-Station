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
    const send = async (mode) => { await page.locator('.chat-body .a-input button').first().click(); await until(async () => (await page.locator('.chat-body .a-msgs').innerText()).includes(`LOCAL MOCK COMPLETE: ${mode}`),`Agent ${mode} did not finish`); await until(async () => (await page.locator('[data-assistant-status]').getAttribute('data-running-count')) === '0','Conversation persistence not finished'); assert.deepEqual(errors,[]); };
    return {temp,mcps,base,fixtureBase,page,context,api,go,chat,send,close,records,requests,errors,external,sourceCode,get fixtureHits(){return fixtureHits;}};
  } catch (error) { await close(); throw error; }
}

export async function buildWeather(lab, {checkpoint=async()=>{}, validation=false}={}) {
  const {page,api,chat} = lab;
  await lab.go('#/overview','[data-add]'); await page.locator('[data-add]').click(); await page.locator('#buildGoal').waitFor();
  assert.equal(await page.locator('#accountName').count(),0);
  await page.locator('#buildGoal').fill('BuildWeather: build a read-only local weather demo with forecast_echo. Use only the supplied local fixture, not real weather.');
  await page.locator('#buildName').fill('Weather demo');
  assert.equal(await page.locator('#buildDocs').getAttribute('required'),null);
  if (validation) {
    await page.locator('#buildDocs').fill('https://example.invalid/docs?token=public-fixture');
    await page.locator('[data-build-submit]').click(); await until(async()=> /without credentials/.test(await page.locator('[data-build-error]').innerText()),'Unsafe URL not rejected');
    assert.equal(lab.requests.length,0);
    assert(!(await api('/mcps')).mcps.some((source)=>source.manifest?.name==='Weather demo'));
  }
  await page.locator('#buildDocs').fill(`${lab.fixtureBase}/docs`);
  await checkpoint('Describe a local weather service; credentials never enter chat.');
  let releasePatch; const patchGate = new Promise((resolve)=>{releasePatch=resolve;}); let created;
  await page.route('**/api/mcps/*',async(route)=> {
    if (route.request().method()==='PATCH' && route.request().postDataJSON().enabled===false) { created = new URL(route.request().url()).pathname.split('/').at(-1); await patchGate; }
    await route.continue();
  });
  try {
    const post = page.waitForRequest((request)=>request.url()===`${lab.base}/api/mcps` && request.method()==='POST');
    await page.locator('[data-build-submit]').click(); const request = await post;
    assert.equal(request.postDataJSON().enabled,false);
    await until(()=>Boolean(created),'Disabled PATCH not observed');
    const firstList = (await api('/mcps')).mcps.find((source)=>source.id===created);
    assert(firstList && firstList.enabled===false,'Starter enabled before follow-up PATCH');
    assert(firstList.instances.every((instance)=>instance.enabled===false));
  } finally { releasePatch(); }
  await chat().waitFor(); await page.unroute('**/api/mcps/*');
  const draft = await chat().inputValue(); assert(draft.includes('BuildWeather')); assert(draft.includes(JSON.stringify(created)));
  assert.equal(lab.requests.length,0,'Continue unexpectedly sent to provider');
  await checkpoint('Disabled starter created. Review the staged request before Send.');
  await lab.send('create');
  assert.equal(lab.requests[0].body.mcpId,created); assert.equal(lab.requests[0].csrf,'1');
  const file = await api(`/mcps/${created}/file?path=index.js`); assert.equal(file.content,lab.sourceCode());
  await checkpoint('Real agent tools wrote index.js, hot-reloaded it, and read it back.');
  return created;
}
export async function testConnection(lab,id,expected=true) {
  const response = lab.page.waitForResponse((response)=>response.url()===`${lab.base}/api/mcps/${id}/test`);
  await lab.page.locator('[data-workspace-test]').click(); const body = await (await response).json();
  assert.equal(body.ok,expected,JSON.stringify(body));
  if (!expected) assert.match(body.message,/404/,'Expected the deliberate local fixture HTTP 404');
  await pause(200); return body;
}
export async function sourceTask(lab,id,mode,checkpoint=async()=>{}) {
  const {page,chat,api} = lab;
  await lab.go(`#/integrations/${id}/assistant`,'.chat-body textarea');
  const n = lab.requests.length; await page.locator(mode==='fix'?'[data-ai-fix]':'[data-ai-modify]').click();
  await until(async()=> (await chat().inputValue()).includes(mode==='fix'?'diagnose and fix':'change or extend'),'Source action failed to stage intent');
  assert.equal(lab.requests.length,n,'Source action sent without consent');
  const draft = await chat().inputValue(); assert(draft.includes(JSON.stringify(id))); assert(!/public-ai-lab|public-mock-only/.test(draft));
  await chat().fill(draft + (mode==='fix' ? '\nrepair: Test connection returns HTTP 404. Restore /weather, not /weather-broken. Only use the local fixture.' : '\naddunits: Preserve forecast_echo and add forecast_units with C/F conversion using the same local fixture.'));
  await checkpoint(mode==='fix'?'Explain the observed 404; review the source-scoped repair request.':'Request forecast_units; preserve the original forecast_echo tool.');
  await lab.send(mode); assert.equal(lab.requests.at(-1).body.mcpId,id);
  assert.equal((await api(`/mcps/${id}/file?path=index.js`)).content,lab.sourceCode(mode==='modify'));
  await checkpoint('Real source write, hot reload, and read-back completed.');
}
async function regression() {
  const lab = await createLab();
  try {
    assert.equal((await lab.api('/mcps')).mcps.length,18,'Expected 18 isolated bundled modules');
    const id = await buildWeather(lab,{validation:true});
    await testConnection(lab,id);
    await lab.api(`/mcps/${id}/file`,'PUT',{path:'index.js',content:lab.sourceCode().replaceAll('/weather\'', '/weather-broken\'')});
    await lab.api('/reload','POST',{});
    await testConnection(lab,id,false);
    await sourceTask(lab,id,'fix'); await testConnection(lab,id);
    await sourceTask(lab,id,'modify'); await testConnection(lab,id);
    await lab.go(`#/integrations/${id}/tools`,'.workspace-tabs');
    await lab.page.locator('#toolList summary').filter({hasText:'forecast_units'}).waitFor();
    const source=(await lab.api('/mcps')).mcps.find((item)=>item.id===id);
    assert.equal(source.enabled,false); assert(source.instances.every((instance)=>!instance.enabled));
    assert.equal(lab.requests.length,3); assert(lab.fixtureHits>=3); assert.deepEqual(lab.errors,[]); assert.deepEqual(lab.external,[]);
    for (const mode of ['create','fix','modify']) assert(lab.records.some((record)=>record.mode===mode && record.name==='write_module_file'));
    // Omitted documentation is accepted, but stays an honest reviewable draft.
    await lab.go('#/integrations/new','#buildGoal');
    await lab.page.locator('#buildGoal').fill('Ask me for API documentation before building.');
    await lab.page.locator('#buildName').fill('Docs optional fixture');
    await lab.page.locator('[data-build-submit]').click(); await lab.chat().waitFor();
    const optionalDraft=await lab.chat().inputValue();
    assert(optionalDraft.includes('Documentation URL: Not provided'));
    assert.equal(lab.requests.length,3);
    const optional=(await lab.api('/mcps')).mcps.find((item)=>item.manifest?.name==='Docs optional fixture');
    assert(optional && !optional.enabled);
    assert.deepEqual(lab.errors,[]); assert.deepEqual(lab.external,[]);

    console.log('PASS: 18 isolated modules; unsafe URL rejected; optional docs; create disabled before PATCH; staged drafts require Send; correct source scope; real agent writes/reloads/read-backs; failing 404 test repaired; units tool added; fixture tests pass; endpoint stays disabled; no page errors/external browser calls.');
  } finally { await lab.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) regression().catch((error)=>{console.error(error.stack);process.exitCode=1;});
