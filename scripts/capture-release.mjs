/** Real release UI captures. No fixtures, upstream calls, ambient secrets or live state.
 * node scripts/capture-release.mjs
 * PRODUCT_BROWSER_MODULE may point to an existing Playwright ESM entry point.
 * The release owner must set the actual application version before capture.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const expectedVersion = process.env.CAPTURE_EXPECTED_VERSION || '2.7.0';
const expected = ['cloudflare','dockerhub','files','gdrive','gemini','github','gmail','n8n','openproject','protonpass','pushover','radarr','siyuan','sonarr','station','telegram','todoist','xero'].sort();
const output = path.join(root, 'docs/assets/product');
const versionSource = await fs.readFile(path.join(root,'server/lib/env.js'),'utf8');
assert.equal(versionSource.match(/version:\s*['"]([^'"]+)['"]/)?.[1], expectedVersion, 'Wait for the parent release version; never relabel an older application');
let playwright;
for (const specifier of [process.env.PRODUCT_BROWSER_MODULE, 'playwright', '/workspace/omniforge/node_modules/playwright/index.mjs'].filter(Boolean)) {
  try { const mod = await import(path.isAbsolute(specifier) ? pathToFileURL(specifier).href : specifier); playwright = mod.default || mod; if (playwright.chromium) break; } catch { /* Try existing installation; never install dependencies. */ }
}
assert.ok(playwright?.chromium, 'Provide PRODUCT_BROWSER_MODULE pointing to an installed Playwright');
const temp = await fs.mkdtemp(path.join(os.tmpdir(),'station-release-'));
let child, browser, context;
const external = [], pageErrors = [], captures = [];
let cleanupStarted = false;
async function cleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  try { await context?.close(); } finally {
    try { await browser?.close(); } finally {
      try {
        if (child && child.exitCode === null && child.signalCode === null) {
          const exited = once(child,'exit'); child.kill('SIGTERM');
          const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
          try { await exited; } finally { clearTimeout(timer); }
        }
      } finally { await fs.rm(temp,{recursive:true,force:true}); }
    }
  }
}
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { cleanup().finally(() => process.exit(1)); });
try {
  const mcps = path.join(temp,'mcps'), data = path.join(temp,'data');
  await fs.mkdir(mcps); await fs.mkdir(data);
  await fs.writeFile(path.join(temp,'package.json'),'{"type":"module"}');
  const actual = (await fs.readdir(path.join(root,'mcps'),{withFileTypes:true})).filter(e=>e.isDirectory()&&!/^[._]/.test(e.name)).map(e=>e.name).sort();
  assert.deepEqual(actual,expected,'Capture all 18 actual bundled modules, not a reduced fixture');
  for (const id of actual) {
    const src = path.join(root,'mcps',id), dest = path.join(mcps,id);
    await fs.mkdir(dest);
    for (const entry of await fs.readdir(src,{withFileTypes:true})) {
      if (entry.isFile() && ['index.js','bundle.js','manifest.json','about.md','instructions.md'].includes(entry.name)) await fs.copyFile(path.join(src,entry.name),path.join(dest,entry.name));
    }
  }
  // Apply network guards before importing the server. No credentials are inherited.
  const guard = path.join(temp,'loopback-only.mjs');
  await fs.writeFile(guard,`import net from 'node:net';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const local = h => ['127.0.0.1','localhost','::1'].includes(h);
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const first = args[0];
  const options = Array.isArray(first) ? first[0] : first;
  const host = typeof options === 'object' ? options.host : (typeof args[1] === 'string' ? args[1] : 'localhost');
  if ((typeof options === 'object' && options.path) || !local(host || 'localhost')) throw new Error('Capture blocked non-loopback socket');
  return realConnect.apply(this,args);
};
const realListen = net.Server.prototype.listen;
net.Server.prototype.listen = function(...args) {
  if (typeof args[0] === 'number' && typeof args[1] !== 'string') args.splice(1,0,'127.0.0.1');
  return realListen.apply(this,args);
};
const realFetch = globalThis.fetch;
globalThis.fetch = (input,opts) => { if (!local(new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname)) throw new Error('Capture blocked external fetch'); return realFetch(input,opts); };
for (const method of ['exec','execFile','execSync','execFileSync','spawn','spawnSync','fork']) cp[method] = () => { throw new Error('Capture blocked subprocess'); };
syncBuiltinESMExports();`);
  const reservation = net.createServer(); reservation.listen(0,'127.0.0.1'); await once(reservation,'listening');
  const port = reservation.address().port; await new Promise(resolve=>reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath,['--import',guard,path.join(root,'server/index.js')],{cwd:root,env:{PATH:process.env.PATH || '/usr/bin:/bin',LANG:'C.UTF-8',TZ:'UTC',PORT:String(port),PUBLIC_URL:origin,DATA_DIR:data,MCPS_DIR:mcps,APP_PASSWORD:'release-capture-local-only',COOKIE_SECURE:'0'},stdio:['ignore','pipe','pipe']});
  let bootLog = ''; child.stdout.on('data',b=>{bootLog+=b;}); child.stderr.on('data',b=>{bootLog+=b;});
  let health;
  for (let i=0;i<100;i++) {
    try { const r=await fetch(`${origin}/healthz`); if(r.ok) {health=await r.json();break;} } catch { /* Boot pending. */ }
    if(child.exitCode!==null) throw new Error(`Temporary app exited: ${bootLog.slice(-2000)}`);
    await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(health?.version,expectedVersion); assert.equal(health.modules,18);
  browser = await playwright.chromium.launch({headless:true,args:['--no-sandbox','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']});
  context = await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,colorScheme:'light',locale:'en-GB',timezoneId:'UTC',serviceWorkers:'block'});
  await context.route('**/*',route=>{
    if(new URL(route.request().url()).origin===origin) return route.continue();
    external.push(new URL(route.request().url()).origin); return route.abort('blockedbyclient');
  });
  await context.addInitScript(()=>{
    localStorage.setItem('station.theme','light'); localStorage.setItem('station.sidebar.collapsed','0');
    sessionStorage.setItem('mcp-station-pwa-install-dismissed','1');
  });
  const page=await context.newPage(); page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto(origin); await page.locator('#pw').fill('release-capture-local-only');
  await page.getByRole('button',{name:'Sign in',exact:true}).click(); await page.locator('.app-shell').waitFor();
  // Mutation calls use the real browser login cookie and normal CSRF header.
  async function api(url,method='GET',body) {
    return page.evaluate(async({url,method,body})=>{
      const r=await fetch(url,{method,headers:{'Content-Type':'application/json','x-station-csrf':'1'},body:body===undefined?undefined:JSON.stringify(body)});
      const result=await r.json(); if(!r.ok) throw new Error(result.error || `HTTP ${r.status}`); return result;
    },{url:`/api${url}`,method,body});
  }
  const initial=(await api('/mcps')).mcps;
  assert.deepEqual(initial.map(m=>m.id).sort(),expected);
  for(const m of initial) {
    assert.equal(m.error,null);
    const settings=Object.fromEntries(m.manifest.settings.map(s=>[s.key,'']));
    await api(`/mcps/${m.id}`,'PATCH',{enabled:false,settings});
  }
  await api('/mcps/gmail/instances','POST',{name:'Personal (example)'});
  const work=(await api('/mcps/gmail/instances','POST',{name:'Work (example)'})).instance;
  assert.equal(work.enabled,false); assert.equal(work.lastTest,null);
  assert.ok(Object.values(work.settings).every(v=>v===''));
  await page.reload(); await page.locator('.app-shell').waitFor();
  await fs.mkdir(output,{recursive:true});
  async function navigate(hash,selector) {
    await page.evaluate(hash=>{location.hash=hash;},hash);
    await page.locator(selector).first().waitFor(); await page.waitForTimeout(350);
    await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('.main')?.scrollTo(0,0);});
  }
  async function capture(name) {
    await page.evaluate(({version,name})=>{
      document.querySelector('[data-capture-label]')?.remove();
      const label=document.createElement('p'); label.dataset.captureLabel=''; label.className='help';
      label.style.cssText='font-size:11px;margin:0 0 8px;';
      label.textContent=`v${version} · Sample accounts · Not live-tested`;
      if (name === 'usage') document.querySelector('.usage-panel').prepend(label);
      else document.querySelector('#routeRoot').prepend(label);
    },{version:expectedVersion,name});
    if (name === 'usage') await page.locator('.usage-panel').scrollIntoViewIfNeeded();
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:path.join(temp,`${name}.png`),fullPage:false,animations:'disabled'});
    captures.push({name,...page.viewportSize()});
  }
  await navigate(`#/integrations/gmail/settings?account=${work.id}`,'#setForm');
  assert.equal(await page.locator('[data-account] option:checked').textContent(),'Work (example)');
  assert.equal(await page.locator('[data-account] option').count(),3);
  assert.ok(await page.locator('#setForm input').evaluateAll(inputs=>inputs.every(i=>i.value==='')));
  await capture('workspace');
  await navigate('#/integrations','.integration-card');
  assert.equal(await page.locator('.integration-card').count(),18);
  assert.match(await page.locator('[data-result-count]').textContent(),/18/);
  assert.equal(await page.locator('.service-category').count(),18);
  assert.equal(await page.locator('.service-icon svg').count(),18);
  assert.ok((await page.locator('.sidebar-version').textContent()).includes(`v${expectedVersion}`));
  await capture('integrations');
  await navigate('#/assistant','[data-provider-warning]');
  assert.equal(await page.locator('[data-provider-warning]').isVisible(),true);
  await page.getByRole('heading',{name:'What would you like to connect?'}).waitFor();
  await capture('assistant');
  await navigate('#/connect','.connection-row');
  assert.equal(await page.locator('.connection-row').count(),18);
  await capture('connections');
  await navigate('#/overview','.usage-panel');
  await page.getByRole('heading',{name:'No recorded tool calls in this period'}).waitFor();
  // Scroll the real overview to its usage panel; do not manufacture a usage route or graph.
  await page.locator('.usage-panel').scrollIntoViewIfNeeded(); await capture('usage');
  await page.setViewportSize({width:375,height:900});
  await navigate('#/integrations','.integration-card');
  await page.locator('.bottom-nav').waitFor({state:'visible'});
  await capture('mobile');
  assert.deepEqual(pageErrors,[],'No browser application errors');
  assert.deepEqual(external,[],'No external browser requests');
  // Publish only after all six real captures and assertions succeed.
  for(const {name} of captures) await fs.copyFile(path.join(temp,`${name}.png`),path.join(output,`${name}.png`));
  // Keep the owned publication notes accurate after the parent's stable recapture.
  if (health.version === '2.7.0') {
    const notesPath = path.join(root,'docs/media/SCREENSHOTS.md');
    let notes = await fs.readFile(notesPath,'utf8');
    notes = notes.replace(/Updated: \*\*[^*]+\*\*/, `Updated: **${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'})}**`);
    notes = notes.replace(/## Release gate[\s\S]*?(?=## What the sample data means)/,
      '## Release capture\n\n**Captured application version: 2.7.0.** Both the actual health endpoint and\nvisible application version were verified. All 18 bundled sources loaded.\nNo application version or status was falsified.\n\n');
    notes = notes.replace('- Recapture at actual version 2.7.0; do not publish these prerelease-version images as stable evidence.',
      '- Actual version 2.7.0 was verified during capture; rerun the generator after further visible UI changes.');
    await fs.writeFile(notesPath,notes);
  }
  console.log(JSON.stringify({version:health.version,modules:health.modules,accounts:3,externalRequests:external.length,pageErrors,captures},null,2));
} finally { await cleanup(); }
