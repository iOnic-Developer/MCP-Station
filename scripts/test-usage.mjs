import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fixture } from './test-instances.mjs';

const f = await fixture();
try {
  assert.equal((await f.request('/api/usage','GET',undefined,false)).status,401);
  let usage = await f.api('/usage');
  assert.equal(usage.days,7);
  assert.deepEqual(usage.totals,{calls:0,errors:0,successRate:null,averageLatencyMs:null});
  assert.deepEqual(usage.daily,[]); assert.deepEqual(usage.integrations,[]); assert.deepEqual(usage.recent,[]);
  for (const days of ['0','31','1.5','bad','']) assert.equal((await f.request('/api/usage?days='+days)).status,400);
  await f.api('/mcps/dummy','PATCH',{settings:{secret:'default-private-secret'}});
  const a = (await f.api('/mcps/dummy/instances','POST',{name:'Work'})).instance;
  await f.api(`/mcps/${a.id}`,'PATCH',{enabled:true,settings:{account:'work',secret:'work-private-secret'}});
  await f.rpc('dummy-route','fixture-master','tools/list',{});
  await f.rpc('dummy-route','fixture-master','initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'private-client',version:'1'}});
  await f.rpc('dummy-route','not-authorized','tools/call',{name:'identity',arguments:{}});
  assert.equal((await f.api('/usage')).totals.calls,0,'non-tool and unauthenticated traffic excluded');
  await f.rpc('dummy-route','fixture-master','tools/call',{name:'identity',arguments:{delay:20,privateInput:'private-argument-marker'}});
  await f.rpc(a.id,'fixture-master','tools/call',{name:'identity',arguments:{fail:true}});
  await f.rpc(a.id,'fixture-master','tools/call',{name:'explode',arguments:{}});
  await f.rpc(a.id,'fixture-master','tools/call',{name:'identity',arguments:{delay:'not-a-number'}});
  usage=await f.api('/usage?days=7');
  assert.equal(usage.totals.calls,4); assert.equal(usage.totals.errors,3);
  assert.equal(usage.totals.successRate,0.25); assert.ok(usage.totals.averageLatencyMs>=0);
  assert.equal(usage.daily.length,1); assert.equal(usage.daily[0].calls,4); assert.equal(usage.daily[0].errors,3);
  assert.equal(usage.integrations.length,2);
  assert.equal(usage.integrations.find((i)=>i.id===a.id).name,'Work');
  assert.equal(usage.integrations.find((i)=>i.id===a.id).calls,3);
  const scoped=await f.api('/usage?instanceId='+a.id);
  assert.equal(scoped.totals.calls,3); assert.equal(scoped.totals.errors,3);
  assert.ok(scoped.recent.every((e)=>e.instanceId===a.id && e.moduleId==='dummy'));
  assert.equal((await f.api('/usage?instanceId=unknown')).totals.calls,0);
  for (const e of usage.recent) assert.deepEqual(Object.keys(e).sort(),['time','instanceId','moduleId','tool','durationMs','ok'].sort());
  await f.restart();
  const stored=fs.readFileSync(path.join(f.data,'usage.json'),'utf8');
  for (const marker of ['default-private-secret','work-private-secret','private-argument-marker','private-error-body','private-client','fixture-master','arguments','content','clientId','token']) {
    assert.ok(!stored.includes(marker),`usage must not retain ${marker}`);
    assert.ok(!JSON.stringify(usage).includes(marker));
  }
  assert.equal((await f.api('/usage')).totals.calls,4,'usage survives restart');
  const backup = await f.api('/backup','POST');
  const backupName = backup.name;
  assert.ok(backupName);
  await f.api(`/mcps/${a.id}`,'PATCH',{settings:{account:'modified-after-backup'}});
  await f.rpc(a.id,'fixture-master','tools/call',{name:'identity',arguments:{}});
  assert.equal((await f.api('/usage')).totals.calls,5);
  await f.api('/restore/'+backupName,'POST');
  assert.equal((await f.api('/usage')).totals.calls,4,'restore reloads usage history, not stale memory');
  assert.equal((await f.api('/mcps')).mcps[0].instances.find((i)=>i.id===a.id).settings.account,'work');
  // A pre-analytics archive has no usage.json: never retain destination history.
  const legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'station-legacy-backup-'));
  try {
    execFileSync('tar', ['-xzf', path.join(f.data, 'backups', backupName), '-C', legacy]);
    fs.rmSync(path.join(legacy, 'usage.json'), { force: true });
    const legacyName = 'legacy-without-usage.tar.gz';
    execFileSync('tar', ['-czf', path.join(f.data, 'backups', legacyName), '-C', legacy, '.']);
    await f.api('/restore/' + legacyName, 'POST');
    assert.equal((await f.api('/usage')).totals.calls, 0, 'legacy restore clears unrelated destination history');
    await f.restart();
    assert.equal((await f.api('/usage')).totals.calls, 0, 'legacy empty history persists across restart');
  } finally { fs.rmSync(legacy, { recursive: true, force: true }); }
  const privateName = 'private-api-key-request-marker';
  await f.rpc(a.id, 'fixture-master', 'tools/call', { name: privateName, arguments: {} });
  const rejected = await f.api('/usage');
  assert.equal(rejected.totals.calls, 1);
  assert.equal(rejected.totals.errors, 1);
  assert.equal(rejected.recent[0].tool, '(invalid)', 'unknown but syntactically valid tool identifiers are redacted');
  assert.ok(!JSON.stringify(rejected).includes(privateName));
  await f.restart();
  assert.ok(!fs.readFileSync(path.join(f.data, 'usage.json'), 'utf8').includes(privateName));
  console.log('PASS privacy/restore regressions: unknown tool names redacted; legacy backup resets usage on restore and restart');
  console.log('PASS usage HTTP: session auth, empty/null stats, validation, tools/call only, isError/throw/schema failures, instance filtering, persistence, metadata-only');
} finally { await f.close(); }

// Exercise retention/capping and projection of untrusted/older on-disk records independently.
const root=fs.mkdtempSync(path.join(os.tmpdir(),'station-usage-'));
try {
  process.env.DATA_DIR=root;
  const now=Date.now();
  const event={time:new Date(now-1000).toISOString(),instanceId:'dummy',moduleId:'dummy',tool:'identity',durationMs:12,ok:true};
  const rows=Array.from({length:5010},()=>({...event,arguments:'MUST-NOT-RETAIN',token:'MUST-NOT-RETAIN'}));
  rows.push({...event,time:new Date(now-31*86400_000).toISOString()});
  rows.push({...event,time:new Date(now+86400_000).toISOString()});
  fs.writeFileSync(path.join(root,'usage.json'),JSON.stringify(rows));
  const {getUsage,recordUsage,persistUsage,MAX_EVENTS}=await import('../server/lib/usage.js');
  let u=getUsage({days:30});
  assert.equal(u.totals.calls,4998); assert.equal(u.recent.length,100);
  assert.ok(!JSON.stringify(u).includes('MUST-NOT-RETAIN'));
  for(let i=0;i<10;i++) recordUsage({...event,time:new Date().toISOString(),durationMs:25,ok:false,body:'MUST-NOT-RETAIN'});
  recordUsage({...event,durationMs:NaN});
  persistUsage();
  u=getUsage({days:30});
  assert.equal(u.totals.calls,MAX_EVENTS); assert.equal(u.totals.errors,10);
  const saved=JSON.parse(fs.readFileSync(path.join(root,'usage.json'),'utf8'));
  assert.equal(saved.length,MAX_EVENTS); assert.ok(!JSON.stringify(saved).includes('MUST-NOT-RETAIN'));
  console.log('PASS usage retention: 30-day cutoff, future/malformed exclusion, 5000-event cap, 100 recent, strict metadata projection');
} finally {fs.rmSync(root,{recursive:true,force:true});}
