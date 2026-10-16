/** Real HTTP regression tests, temporary state/source only; no external API or credentials. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

export async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'station-instances-'));
  const data = path.join(root, 'data');
  const mcps = path.join(root, 'mcps');
  fs.mkdirSync(data); fs.mkdirSync(mcps);
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  const manifest = { id: 'dummy', slug: 'dummy-route', name: 'Dummy', version: '1.0.0', settings: [
    { key: 'account', label: 'Account', type: 'text', required: true, default: 'manifest-account' },
    { key: 'secret', label: 'Secret', type: 'secret', required: true }
  ] };
  const dir = path.join(mcps, 'dummy'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'index.js'), `
export function register({server,z,getSettings}) {
  server.registerTool('identity', {inputSchema: {delay:z.number().default(0),fail:z.boolean().default(false),privateInput:z.string().default('')}}, async ({delay,fail}) => {
    const before=getSettings();
    const account=before.account;
    before.account='MUTATED';
    await new Promise(r=>setTimeout(r,delay));
    const after=getSettings();
    return {content:[{type:'text',text:JSON.stringify({account,after:after.account,secret:after.secret})}],isError:fail};
  });
  server.registerTool('explode', {inputSchema:{}}, async()=>{throw new Error('private-error-body');});
}
export async function test(settings) {return {ok:!!settings.account && !!settings.secret,message:settings.account};}
`);
  fs.writeFileSync(path.join(data, 'station.json'), JSON.stringify({ mcps: { dummy: {
    id: 'dummy', enabled: true, settings: { account: 'legacy-default', secret: '' }, createdAt: '2020-01-01T00:00:00.000Z'
  } } }));
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise((r) => socket.close(r));
  const base = `http://127.0.0.1:${port}`;
  let child, cookie, log = '';
  async function start() {
    log = '';
    child = spawn(process.execPath, ['server/index.js'], { cwd: process.cwd(), env: { ...process.env,
      PORT: String(port), DATA_DIR: data, MCPS_DIR: mcps, APP_PASSWORD: 'fixture-password', MCP_TOKEN: 'fixture-master',
      PUBLIC_URL: base, COOKIE_SECURE: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (b) => { log = (log + b).slice(-15000); });
    child.stderr.on('data', (b) => { log = (log + b).slice(-15000); });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + '/healthz')).ok) break; } catch {}
      if (child.exitCode !== null || i === 99) throw new Error('Fixture server did not start: ' + log);
      await new Promise((r) => setTimeout(r, 50));
    }
    const login = await fetch(base + '/api/login', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({password:'fixture-password'}) });
    assert.equal(login.status, 200);
    cookie = login.headers.get('set-cookie').split(';')[0];
  }
  async function stop() {
    if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; }
  }
  async function request(url, method = 'GET', body, authed = true) {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-station-csrf': '1', ...(authed ? {cookie} : {}) },
      ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(10000) });
    return { status: r.status, body: await r.json() };
  }
  async function api(url, method = 'GET', body) {
    const r = await request('/api' + url, method, body);
    assert.ok(r.status >= 200 && r.status < 300, `${method} ${url}: ${JSON.stringify(r)}`);
    return r.body;
  }
  async function rpc(slug, token = 'fixture-master', method = 'tools/call', params = {name:'identity',arguments:{}}, id = 1) {
    const r = await fetch(`${base}/${slug}/mcp`, { method: 'POST', headers: {'content-type':'application/json',accept:'application/json, text/event-stream',authorization:`Bearer ${token}`},
      body: JSON.stringify({jsonrpc:'2.0',...(id === undefined ? {} : {id}),method,params}), signal: AbortSignal.timeout(10000) });
    return {status:r.status,body:await r.json()};
  }
  async function authorization(slug, stopAt) {
    const redirect = 'https://example.com/callback';
    const reg = await request('/register', 'POST', {client_name:'Instance fixture',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']}, false);
    assert.equal(reg.status, 201);
    const client = reg.body.client_id;
    const verifier = 'fixture-verifier-0123456789abcdefghijklmnopqrstuvwxyz';
    const q = new URLSearchParams({client_id:client,redirect_uri:redirect,response_type:'code',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource:`${base}/${slug}/mcp`});
    const page = await fetch(base + '/authorize?' + q);
    const loginId = (await page.text()).match(/name="login_id" value="([^"]+)"/)?.[1];
    assert.ok(loginId);
    if (stopAt === 'pending') return {loginId,client};
    const approve = await fetch(base + '/oauth/approve', {method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({login_id:loginId,password:'fixture-password'})});
    assert.equal(approve.status,302);
    const code = new URL(approve.headers.get('location')).searchParams.get('code');
    if (stopAt === 'code') return {code,client,verifier,redirect};
    const exchange = await request('/token','POST',{grant_type:'authorization_code',client_id:client,code,code_verifier:verifier,redirect_uri:redirect},false);
    assert.equal(exchange.status,200);
    return {...exchange.body,client};
  }
  try { await start(); } catch (e) { await stop(); fs.rmSync(root,{recursive:true,force:true}); throw e; }
  return {root,data,mcps,dir,base,manifest,api,request,rpc,authorization,
    restart:async()=>{await stop();await start();}, close:async()=>{await stop();fs.rmSync(root,{recursive:true,force:true});}};
}

export async function testInstances() {
  const f = await fixture();
  try {
    let list = (await f.api('/mcps')).mcps;
    assert.equal(list.length,1);
    assert.equal(list[0].id,'dummy'); assert.equal(list[0].manifest.slug,'dummy-route');
    assert.equal(list[0].settings.account,'legacy-default');
    assert.equal(list[0].instances[0].id,'dummy'); assert.equal(list[0].instances[0].name,'Default account');
    await f.api('/mcps/dummy','PATCH',{settings:{secret:'default-private-secret'}});
    const defaultToken = (await f.api('/mcps/dummy/token','POST')).token;
    const mirror = fs.readFileSync(path.join(f.dir,'.config.json'),'utf8');
    const a = (await f.api('/mcps/dummy/instances','POST',{name:'Personal'})).instance;
    const b = (await f.api('/mcps/dummy/instances','POST',{name:'Work'})).instance;
    assert.equal(a.id,'dummy-route--personal'); assert.equal(a.sourceId,'dummy');
    assert.equal(a.settings.account,''); assert.equal(a.settings.secret,'');
    assert.equal(a.clients,0); assert.equal(a.lastTest,null);
    assert.equal(a.enabled,false); assert.equal(a.configured,false); assert.equal(a.tokenSet,false);
    for (const slug of ['api','assets','f','token','dummy','dummy-route',a.id,'../bad','Bad','_hidden']) {
      assert.equal((await f.request('/api/mcps/dummy/instances','POST',{name:'Bad',slug})).status,400,slug);
    }
    assert.equal((await f.request(`/api/mcps/${a.id}/instances`,'POST',{name:'Nested'})).status,400);
    for (const [i,account] of [[a,'personal'],[b,'work']]) {
      await f.api(`/mcps/${i.id}`,'PATCH',{enabled:true,settings:{account,secret:account+'-private-secret'}});
      assert.equal((await f.api(`/mcps/${i.id}/test`,'POST')).message,account);
    }
    await f.api(`/mcps/${a.id}`,'PATCH',{settings:{secret:'••••••'}});
    assert.equal((await f.api(`/mcps/${a.id}/test`,'POST')).ok,true);
    assert.equal((await f.api(`/mcps/${b.id}/capabilities`)).tools.length,2);
    assert.equal((await f.request(`/api/mcps/dummy/instances/${b.id}`,'DELETE',undefined,false)).status,401);
    assert.equal((await f.request(`/api/mcps/wrong/instances/${b.id}`,'DELETE')).status,404);
    assert.equal((await f.request('/api/mcps/dummy/instances/dummy','DELETE')).status,404);
    const ta = (await f.api(`/mcps/${a.id}/token`,'POST')).token;
    const tb = (await f.api(`/mcps/${b.id}/token`,'POST')).token;
    assert.notEqual(ta,tb);
    assert.equal((await f.rpc(b.id,ta,'tools/list',{})).status,403);
    assert.equal((await f.rpc('dummy-route',ta,'tools/list',{})).status,403);
    const outcomes = await Promise.all(Array.from({length:24},async(_,n)=>{
      const i=n%2?a:b, account=n%2?'personal':'work';
      const r=await f.rpc(i.id,n%2?ta:tb,'tools/call',{name:'identity',arguments:{delay:(n%5)*7}});
      assert.equal(r.status,200);
      assert.deepEqual(JSON.parse(r.body.result.content[0].text),{account,after:account,secret:account+'-private-secret'});
    }));
    assert.equal(outcomes.length,24);
    assert.equal(fs.readFileSync(path.join(f.dir,'.config.json'),'utf8'),mirror,'instances never overwrite source mirror');
    assert.equal(fs.readdirSync(f.mcps).length,1,'no source copies');
    for (const route of [`/mcps/${a.id}/files`,`/mcps/${a.id}/file?path=index.js`,`/mcps/${a.id}/export-module`]) {
      assert.equal((await f.request('/api'+route)).status,400);
    }
    assert.equal((await f.request(`/api/mcps/${a.id}`,'DELETE')).status,400);
    assert.equal((await f.request('/api/mcps/dummy','DELETE')).status,400);
    assert.equal((await f.request('/api/mcps/dummy/file?path=.config.json')).status,400);
    fs.symlinkSync(path.join(f.dir,'.config.json'),path.join(f.dir,'alias.json'));
    assert.equal((await f.request('/api/mcps/dummy/file?path=alias.json')).status,400);
    assert.equal((await f.request('/api/mcps/dummy/file','PUT',{path:'alias.json',content:'{}'})).status,400);
    assert.ok(!(await f.api('/mcps/dummy/files')).files.some((e)=>e.path==='alias.json'));
    fs.unlinkSync(path.join(f.dir,'alias.json'));
    assert.equal((await f.request('/api/mcps/dummy/file','PUT',{path:'./manifest.json',content:JSON.stringify({...f.manifest,slug:a.id})})).status,400);
    const oa = await f.authorization(a.id);
    assert.equal((await f.rpc(a.id,oa.access_token,'tools/list',{})).status,200);
    assert.equal((await f.rpc(b.id,oa.access_token,'tools/list',{})).status,403);
    assert.equal((await f.api(`/mcps/${a.id}/connections`)).connections.length,1);
    assert.equal((await f.api(`/mcps/${b.id}/connections`)).connections.length,0);
    // Reload a shared source once; both accounts must execute the new code with their own config.
    const originalSource = fs.readFileSync(path.join(f.dir,'index.js'),'utf8');
    await f.api('/mcps/dummy/file','PUT',{path:'index.js',content:originalSource.replace('secret:after.secret}', 'secret:after.secret,revision:2}')});
    await f.api('/reload','POST');
    for (const [i,token,account] of [[a,ta,'personal'],[b,tb,'work']]) {
      const r = await f.rpc(i.id,token,'tools/call',{name:'identity',arguments:{}});
      const payload = JSON.parse(r.body.result.content[0].text);
      assert.equal(payload.revision,2); assert.equal(payload.account,account);
    }
    assert.equal((await f.rpc(a.id,ta,'tools/list',{})).status,200);
    assert.equal((await f.rpc(b.id,tb,'tools/list',{})).status,200);
    await f.restart();
    list=(await f.api('/mcps')).mcps;
    assert.equal(list.length,1); assert.equal(list[0].instances.length,3);
    assert.equal(list[0].settings.account,'legacy-default');
    assert.equal((await f.rpc(a.id,ta,'tools/list',{})).status,200);
    assert.equal((await f.rpc(a.id,oa.access_token,'tools/list',{})).status,200);
    assert.equal((await f.rpc('dummy-route',defaultToken,'tools/list',{})).status,200);
    const pending = await f.authorization(a.id,'pending');
    const code = await f.authorization(a.id,'code');
    const ob = await f.authorization(b.id);
    await f.api(`/mcps/dummy/instances/${a.id}`,'DELETE');
    assert.equal((await fetch(f.base+'/oauth/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login_id:pending.loginId,password:'fixture-password'})})).status,400);
    assert.equal((await f.request('/token','POST',{grant_type:'authorization_code',client_id:code.client,code:code.code,code_verifier:code.verifier,redirect_uri:code.redirect},false)).status,400);
    assert.equal((await f.rpc(b.id,ob.access_token,'tools/list',{})).status,200);
    assert.equal((await f.rpc(a.id,ta,'tools/list',{})).status,404);
    const refresh=await f.request('/token','POST',{grant_type:'refresh_token',client_id:oa.client,refresh_token:oa.refresh_token},false);
    assert.equal(refresh.status,400);
    // Reuse of a deleted endpoint cannot revive old OAuth/static credentials.
    await f.api('/mcps/dummy/instances','POST',{name:'Replacement',slug:a.id});
    await f.api(`/mcps/${a.id}`,'PATCH',{enabled:true});
    assert.equal((await f.rpc(a.id,oa.access_token,'tools/list',{})).status,401);
    assert.equal((await f.rpc(a.id,ta,'tools/list',{})).status,401);
    assert.equal((await f.rpc(b.id,tb,'tools/list',{})).status,200);
    assert.equal((await f.rpc('dummy-route','fixture-master','tools/list',{})).status,200);
    console.log('PASS instances: migration/default, blank accounts, parallel isolation, scoped static/OAuth access, restart, shared-source guards, delete/reuse revocation');
  } finally { await f.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await testInstances();
}
