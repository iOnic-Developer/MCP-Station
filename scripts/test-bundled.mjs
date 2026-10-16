/** Offline bundle regression: temporary sources/state, no ambient credentials, no service calls. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const EXPECTED = {
  "todoist": [
    "todoist_complete_task",
    "todoist_create_project",
    "todoist_create_task",
    "todoist_delete_task",
    "todoist_get_task",
    "todoist_list_projects",
    "todoist_list_sections",
    "todoist_list_tasks",
    "todoist_reopen_task",
    "todoist_update_task"
  ],
  "github": [
    "github_add_issue_comment",
    "github_compare_commits",
    "github_create_branch",
    "github_create_fork",
    "github_create_issue",
    "github_create_or_update_file",
    "github_create_pull_request",
    "github_create_pull_request_review",
    "github_create_release",
    "github_create_repository",
    "github_delete_branch",
    "github_delete_file",
    "github_delete_secret",
    "github_delete_variable",
    "github_get_archive_link",
    "github_get_clone_info",
    "github_get_commit",
    "github_get_file_contents",
    "github_get_me",
    "github_get_pull_request",
    "github_get_repository",
    "github_get_secret",
    "github_get_tree",
    "github_get_variable",
    "github_list_branches",
    "github_list_commits",
    "github_list_directory",
    "github_list_issue_comments",
    "github_list_issues",
    "github_list_my_repositories",
    "github_list_pull_request_files",
    "github_list_pull_requests",
    "github_list_releases",
    "github_list_secrets",
    "github_list_tags",
    "github_list_variables",
    "github_list_workflow_runs",
    "github_merge_pull_request",
    "github_rerun_workflow",
    "github_search_code",
    "github_search_issues",
    "github_search_repositories",
    "github_set_secret",
    "github_set_variable",
    "github_trigger_workflow",
    "github_update_issue",
    "github_update_pull_request"
  ],
  "dockerhub": [
    "dockerhub_create_access_token",
    "dockerhub_create_build_trigger",
    "dockerhub_create_org_access_token",
    "dockerhub_create_repository",
    "dockerhub_create_webhook",
    "dockerhub_delete_access_token",
    "dockerhub_delete_org_access_token",
    "dockerhub_delete_repository",
    "dockerhub_delete_tag",
    "dockerhub_delete_webhook",
    "dockerhub_generate_github_token",
    "dockerhub_get_build_history",
    "dockerhub_get_profile",
    "dockerhub_get_repository",
    "dockerhub_get_tag",
    "dockerhub_list_access_tokens",
    "dockerhub_list_build_triggers",
    "dockerhub_list_org_access_tokens",
    "dockerhub_list_org_members",
    "dockerhub_list_org_teams",
    "dockerhub_list_orgs",
    "dockerhub_list_repositories",
    "dockerhub_list_starred",
    "dockerhub_list_tag_images",
    "dockerhub_list_tags",
    "dockerhub_list_team_members",
    "dockerhub_list_webhooks",
    "dockerhub_search",
    "dockerhub_trigger_build",
    "dockerhub_update_repository"
  ],
  "pushover": [
    "pushover_cancel_receipt",
    "pushover_check_receipt",
    "pushover_get_limits",
    "pushover_list_sounds",
    "pushover_send_message",
    "pushover_update_glance",
    "pushover_validate_user"
  ],
  "protonpass": [
    "protonpass_create_login",
    "protonpass_create_pat",
    "protonpass_create_ssh_key",
    "protonpass_create_vault",
    "protonpass_delete_item",
    "protonpass_delete_pat",
    "protonpass_delete_vault",
    "protonpass_generate_password",
    "protonpass_get_item",
    "protonpass_get_totp",
    "protonpass_grant_pat_access",
    "protonpass_info",
    "protonpass_list_items",
    "protonpass_list_pat_access",
    "protonpass_list_pats",
    "protonpass_list_vault_members",
    "protonpass_list_vaults",
    "protonpass_score_password",
    "protonpass_share_vault",
    "protonpass_update_item",
    "protonpass_update_vault"
  ],
  "gmail": [
    "gmail_batch_modify_messages",
    "gmail_create_draft",
    "gmail_delete_draft",
    "gmail_delete_message",
    "gmail_delete_thread",
    "gmail_get_attachment",
    "gmail_get_draft",
    "gmail_get_message",
    "gmail_get_profile",
    "gmail_get_thread",
    "gmail_get_vacation_settings",
    "gmail_list_drafts",
    "gmail_list_labels",
    "gmail_list_messages",
    "gmail_list_threads",
    "gmail_manage_label",
    "gmail_modify_message_labels",
    "gmail_modify_thread_labels",
    "gmail_reply_message",
    "gmail_send_draft",
    "gmail_send_message",
    "gmail_set_vacation_settings",
    "gmail_trash_message",
    "gmail_trash_thread",
    "gmail_update_draft"
  ],
  "gdrive": [
    "gdrive_copy_file",
    "gdrive_create_folder",
    "gdrive_delete_file",
    "gdrive_get_file_metadata",
    "gdrive_get_storage_quota",
    "gdrive_list_accounts",
    "gdrive_list_files",
    "gdrive_list_permissions",
    "gdrive_list_shared_drives",
    "gdrive_move_file",
    "gdrive_read_file_content",
    "gdrive_remove_permission",
    "gdrive_share_file",
    "gdrive_update_file",
    "gdrive_upload_file"
  ],
  "cloudflare": [
    "cf_access_app_create",
    "cf_access_app_delete",
    "cf_access_app_get",
    "cf_access_app_list",
    "cf_access_app_update",
    "cf_access_group_create",
    "cf_access_group_delete",
    "cf_access_group_list",
    "cf_access_policy_create",
    "cf_access_policy_delete",
    "cf_access_policy_get",
    "cf_access_policy_list",
    "cf_access_policy_update",
    "cf_access_service_token_create",
    "cf_access_service_token_delete",
    "cf_access_service_token_list",
    "cf_dns_create_tunnel_cname",
    "cf_dns_delete_record",
    "cf_dns_list_records",
    "cf_dns_list_zones",
    "cf_tunnel_add_ingress_rule",
    "cf_tunnel_clean_connections",
    "cf_tunnel_create",
    "cf_tunnel_delete",
    "cf_tunnel_get",
    "cf_tunnel_get_config",
    "cf_tunnel_get_token",
    "cf_tunnel_list",
    "cf_tunnel_list_connections",
    "cf_tunnel_update_config"
  ]
};
const RETAINED = ['files', 'gemini', 'n8n', 'openproject', 'radarr', 'siyuan', 'sonarr', 'station', 'telegram', 'xero'];
const NEW = Object.keys(EXPECTED);
const ALL = [...RETAINED, ...NEW].sort();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'station-bundled-'));
const mcps = path.join(root, 'mcps');
const data = path.join(root, 'data');
fs.mkdirSync(mcps); fs.mkdirSync(data);
fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
const actual = fs.readdirSync('mcps', {withFileTypes:true}).filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.')).map((d) => d.name).sort();
assert.deepEqual(actual, ALL, 'Review the explicit module inventory when adding/removing a bundle');
for (const id of ALL) {
  const dest = path.join(mcps, id); fs.mkdirSync(dest);
  for (const entry of fs.readdirSync(path.join('mcps', id), {withFileTypes:true})) {
    // Deliberate source allowlist: never copy dotfiles, keys, runtime config or sessions.
    if (entry.isFile() && ['index.js', 'bundle.js', 'manifest.json', 'about.md', 'instructions.md'].includes(entry.name)) {
      fs.copyFileSync(path.join('mcps', id, entry.name), path.join(dest, entry.name));
    }
  }
}
process.env.DATA_DIR = data; process.env.MCPS_DIR = mcps;
for (const key of Object.keys(process.env)) if (/(TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL)/i.test(key)) delete process.env[key];
let networkAttempts = 0, commandAttempts = 0, checks = 0;
const realFetch = globalThis.fetch;
const realExecFile = cp.execFile;
globalThis.fetch = async () => { networkAttempts++; throw new Error('External networking forbidden in bundle regression'); };
cp.execFile = () => { commandAttempts++; throw new Error('Subprocess forbidden in bundle regression'); };
syncBuiltinESMExports();
const host = await import('../server/lib/mcpHost.js');
const state = await import('../server/lib/state.js');
const clients = [];
const captured = new Map();
function capture(mod, settings = {}, fetchJson = async () => { networkAttempts++; throw new Error('Unexpected service call'); }) {
  const tools = new Map();
  mod.register({server:{registerTool:(name,spec,handler)=>{assert.ok(!tools.has(name));tools.set(name,{spec,handler});}},z,
    getSettings:()=>({...settings}),log:()=>{},fetchJson});
  return tools;
}
async function connect(server) {
  const [a,b] = InMemoryTransport.createLinkedPair();
  const client = new Client({name:'bundle-fixture',version:'1.0.0'}, {capabilities:{}});
  await Promise.all([client.connect(a),server.connect(b)]); clients.push([client,server]); return client;
}
let child;
try {
  await host.loadModules();
  assert.deepEqual([...host.getModules().values()].map((m)=>m.id).sort(),ALL); checks++;
  for (const id of ALL) {
    const mod = host.getModuleById(id);
    assert.equal(mod.error,null,`${id} import/manifest`);
    assert.equal(state.getState().mcps[id].enabled,true,`${id} enabled on fresh install`);
    const described = await host.describeModule(id);
    assert.ok(described.tools.length>0,`${id} tools/list`); checks++;
    if (!NEW.includes(id)) continue;
    assert.deepEqual(described.tools.map((t)=>t.name).sort(), EXPECTED[id],`${id} exact tools/list`);
    const imported = await import(pathToFileURL(path.join(mcps,id,'index.js')).href);
    const defaults = Object.fromEntries(mod.manifest.settings.map((s)=>[s.key,s.default??'']));
    for (const setting of mod.manifest.settings) {
      if (setting.type==='secret') assert.equal(setting.default??'','',`${id} blank secret default`);
      if (/owner|username|email|account\d_name|vault/.test(setting.key)) assert.equal(setting.default??'','',`${id} no account default`);
    }
    const tools = capture(imported,defaults); captured.set(id,{imported,tools,defaults});
    assert.deepEqual([...tools.keys()].sort(),EXPECTED[id]);
    for (const [name,tool] of tools) {
      const result = await tool.handler({});
      assert.equal(result.isError,true,`${name} refuses blank credentials`);
      assert.match(result.content[0].text,/configure/i,`${name} actionable missing settings`); checks++;
    }
    assert.equal((await imported.test(defaults,{fetchJson:async()=>{networkAttempts++;throw new Error('Unexpected test network');}})).ok,false);
    const client = await connect(host.buildServerFor(mod));
    assert.deepEqual((await client.listTools()).tools.map((t)=>t.name).sort(),EXPECTED[id]);
    const smoke = described.tools.find((t)=>!t.inputSchema.required?.length);
    assert.ok(smoke,`${id} zero-required-argument smoke tool`);
    const response = await client.callTool({name:smoke.name,arguments:{}});
    assert.equal(response.isError,true,`${id} SDK-valid blank response`); checks++;
  }
  // No private runtime artifacts or unreviewed npm imports in the newly bundled sources.
  const scanRules = [
    ['private-address', /\b(?:10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)\b/],
    ['email', /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/],
    ['credential-literal', /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]+|AIza[A-Za-z0-9_-]{30,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/],
    ['long-literal', /['"][A-Za-z0-9+/=_-]{36,}['"]/],
    ['personal-identifier', new RegExp(['da'+'vid','db'+'zocchi','ionic'+'-developer','fish'+'andchips','nuc'+'nas'].join('|'),'i')]
  ];
  for (const id of NEW) {
    for (const filename of fs.readdirSync(path.join('mcps',id))) {
      assert.ok(['index.js','manifest.json','bundle.js','about.md','instructions.md'].includes(filename),`${id}: unexpected artifact`);
      const source=fs.readFileSync(path.join('mcps',id,filename),'utf8');
      const publicHosts=new Set(['api.todoist.com','api.github.com','github.com','hub.docker.com','registry.hub.docker.com',
        'api.pushover.net','proton.me','oauth2.googleapis.com','gmail.googleapis.com','www.googleapis.com','drive.google.com',
        'api.cloudflare.com','example.com']);
      source.split('\n').forEach((line,index)=>{
        for (const match of line.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
          assert.ok(publicHosts.has(match[1]),`${id}/${filename}:${index+1}:unreviewed-literal-host`);
        }
      });
      source.split('\n').forEach((line,index)=>{
        for (const [category,pattern] of scanRules) assert.ok(!pattern.test(line),`${id}/${filename}:${index+1}:${category}`);
      });
      if (filename.endsWith('.js')) {
        for (const match of source.matchAll(/^import .*? from ["']([^"']+)["']/gm)) {
          assert.ok(match[1].startsWith('node:') || match[1]==='./bundle.js',`${id}: unexpected dependency`);
        }
      }
      checks++;
    }
    // Exercise the real host's secret encryption/mirror path, using fake strings only.
    const secret=host.getModuleById(id).manifest.settings.find((setting)=>setting.type==='secret');
    const sentinel=`fixture-only-${id}-credential`;
    host.saveSettings(id,{[secret.key]:sentinel});
    const mirror=fs.readFileSync(path.join(mcps,id,'.config.json'),'utf8');
    assert.ok(mirror.includes('enc:v1:'));assert.ok(!mirror.includes(sentinel));
    assert.equal(host.getSettingsFor(id)[secret.key],sentinel);
    host.saveSettings(id,{[secret.key]:''}); checks++;
  }
  // A provider echoing a configured credential in an error must not expose it.
  const github=captured.get('github');
  const sensitive='fixture-only-error-credential';
  const failing=capture(github.imported,{pat:sensitive},async()=>{throw new Error(sensitive);});
  const errorResult=await failing.get('github_get_me').handler({});
  assert.equal(errorResult.isError,true);assert.ok(!JSON.stringify(errorResult).includes(sensitive));checks++;
  assert.equal((await github.imported.test({pat:sensitive},{fetchJson:async()=>{throw new Error(sensitive);}})).message.includes(sensitive),false);checks++;
  // White-space credentials and partial Google combinations are not configuration.
  for (const id of NEW) {
    const {configurationError} = await import(pathToFileURL(path.join(mcps,id,'bundle.js')).href);
    assert.ok(configurationError(id,Object.fromEntries(Object.keys(captured.get(id).defaults).map((k)=>[k,'  ']))));
  }
  const {normalizeResult} = await import(pathToFileURL(path.join(mcps,'todoist','bundle.js')).href);
  for (const value of [[],null,undefined,7,'text',false,{ok:true}]) {
    const result=normalizeResult({content:[{type:'text',text:'fixture'}],structuredContent:value});
    assert.ok(result.structuredContent && !Array.isArray(result.structuredContent) && typeof result.structuredContent==='object'); checks++;
  }
  // Actual Todoist list response: arrays must pass the SDK result validator.
  globalThis.fetch = async(url)=>{assert.equal(url,'https://api.todoist.com/api/v1/projects');return new Response(JSON.stringify([{id:'fixture-project',name:'Fixture'}]),{status:200});};
  const mod = host.getModuleById('todoist');
  const originalRegister=mod.register;
  const {McpServer}=await import('@modelcontextprotocol/sdk/server/mcp.js');
  const mockServer=new McpServer({name:'bundle-array-fixture',version:'1.0.0'});
  originalRegister({server:mockServer,z,getSettings:()=>({api_key:'fixture-only'}),log:()=>{},fetchJson:async()=>{throw new Error('Unexpected');}});
  const mockClient=await connect(mockServer);
  const arrayResult=await mockClient.callTool({name:'todoist_list_projects',arguments:{}});
  assert.deepEqual(arrayResult.structuredContent.items,[{id:'fixture-project',name:'Fixture'}]); checks++;
  globalThis.fetch = async()=>{networkAttempts++;throw new Error('External network forbidden');};
  // Two independent account instances must never reuse another credential's cached token.
  for (const id of ['gmail','gdrive']) {
    const {imported}=captured.get(id); const seen=[];let refreshes=0;
    const fake=async(url,opts={})=>{
      if (url==='https://oauth2.googleapis.com/token') {refreshes++;const refresh=new URLSearchParams(opts.body).get('refresh_token');return {access_token:`mock-${refresh}`,expires_in:3600};}
      seen.push(opts.headers.Authorization);
      return id==='gmail'?{emailAddress:'fixture',messagesTotal:0,threadsTotal:0}:{user:{displayName:'Fixture'},storageQuota:{limit:'0',usage:'0'}};
    };
    for (const label of ['one','two','one']) {
      const settings={client_id:'fixture-client',client_secret:'fixture-secret',refresh_token:label,account1_refresh_token:label,account1_enabled:'enabled'};
      const tools=capture(imported,settings,fake);
      const name=id==='gmail'?'gmail_get_profile':'gdrive_get_storage_quota';
      const result=await tools.get(name).handler({});assert.notEqual(result.isError,true);
    }
    assert.deepEqual(seen,['Bearer mock-one','Bearer mock-two','Bearer mock-one'],`${id} credential-isolated cache`);
    assert.ok(refreshes>=2); checks++;
  }
  // CLI settings/arguments must not turn into executable or option injection.
  const pp=captured.get('protonpass');
  for (const settings of [{personal_access_token:'fixture-only',cli_path:'/bin/sh'},{personal_access_token:'fixture-only',cli_path:'pass-cli'}]) {
    const tools=capture(pp.imported,settings);
    const name=settings.cli_path==='/bin/sh'?'protonpass_info':'protonpass_get_item';
    const result=await tools.get(name).handler({item:'--help'});
    assert.equal(result.isError,true); checks++;
  }
  assert.equal(networkAttempts,0,'No real network attempt, even when unconfigured');
  assert.equal(commandAttempts,0,'No subprocess attempt');
  // Real station HTTP fixture: private data directory + source-only module copies.
  const guard=path.join(root,'offline-guard.mjs');
  fs.writeFileSync(guard,`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';\nglobalThis.fetch=async()=>{throw new Error('OFFLINE_FIXTURE_NETWORK_FORBIDDEN');};cp.execFile=()=>{throw new Error('OFFLINE_FIXTURE_PROCESS_FORBIDDEN');};syncBuiltinESMExports();`);
  const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
  const port=socket.address().port;await new Promise((r)=>socket.close(r));
  const base=`http://127.0.0.1:${port}`;
  child=cp.spawn(process.execPath,['--import',guard,'server/index.js'],{cwd:process.cwd(),env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:root,NODE_ENV:'test',PORT:String(port),DATA_DIR:path.join(root,'http-data'),MCPS_DIR:mcps,APP_PASSWORD:'fixture-password',MCP_TOKEN:'fixture-master',PUBLIC_URL:base,COOKIE_SECURE:'0'},stdio:'ignore'});
  const request=async(url,opts={})=>realFetch(base+url,{...opts,signal:AbortSignal.timeout(5000)});
  for(let i=0;i<100;i++) {try {if((await request('/healthz')).ok)break;}catch{} if(child.exitCode!==null||i===99)throw new Error('Offline HTTP fixture failed to start');await new Promise((r)=>setTimeout(r,50));}
  const login=await request('/api/login',{method:'POST',headers:{'content-type':'application/json','x-station-csrf':'1'},body:JSON.stringify({password:'fixture-password'})});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const rpc=async(slug,token)=>request(`/${slug}/mcp`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:`Bearer ${token}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  for(const id of NEW) {
    const slug=host.getModuleById(id).manifest.slug;
    const r=await rpc(slug,'fixture-master');assert.equal(r.status,200);
    assert.deepEqual((await r.json()).result.tools.map((t)=>t.name).sort(),EXPECTED[id]);
    const mint=await request(`/api/mcps/${id}/token`,{method:'POST',headers:{cookie,'x-station-csrf':'1','content-type':'application/json'},body:'{}'});
    assert.equal(mint.status,200);const {token}=await mint.json();
    assert.equal((await rpc(slug,token)).status,200);
    const other=NEW.find((n)=>n!==id);assert.equal((await rpc(host.getModuleById(other).manifest.slug,token)).status,401);
    assert.equal((await rpc(slug,'invalid-fixture')).status,401);checks++;
  }
  console.log(`PASS: ${ALL.length} bundled modules (${RETAINED.length} retained, ${NEW.length} new), ${NEW.reduce((n,id)=>n+EXPECTED[id].length,0)} new tools; ${checks} checks. Offline SDK, account isolation, HTTP tools/list and scoped-token smoke passed.`);
} finally {
  if(child && child.exitCode===null) {const done=once(child,'exit');child.kill('SIGTERM');await done;}
  for(const [client,server] of clients){await client.close().catch(()=>{});await server.close().catch(()=>{});}
  globalThis.fetch=realFetch;cp.execFile=realExecFile;syncBuiltinESMExports();
  // Let the host's debounced temporary state write finish before cleanup.
  await new Promise((r)=>setTimeout(r,200));fs.rmSync(root,{recursive:true,force:true});
}
