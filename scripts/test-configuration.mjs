/** Declarative configuration checks: isolated state, no module execution or service calls. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'station-configuration-'));
process.env.DATA_DIR = path.join(root, 'data');
process.env.MCPS_DIR = path.join(root, 'mcps');
process.env.SESSION_SECRET = 'configuration-fixture-only';
fs.mkdirSync(process.env.MCPS_DIR, { recursive: true });
fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network forbidden in configuration tests'); };
const host = await import('../server/lib/mcpHost.js');
const { getState, persist, loadState } = await import('../server/lib/state.js');
let checks = 0;
function configured(id, expected) {
  assert.equal(host.isConfigured(id), expected, `${id} configuration status`);
  checks++;
}
function set(id, values = {}) {
  const settings = host.getModuleById(id).manifest.settings;
  host.saveSettings(id, Object.fromEntries(settings.map((s) => [s.key, values[s.key] ?? ''])));
}
try {
  // Use real manifests but inert implementations: readiness never calls register/test.
  const manifests = {};
  for (const id of ['gmail', 'gdrive']) {
    manifests[id] = JSON.parse(fs.readFileSync(new URL(`../mcps/${id}/manifest.json`, import.meta.url), 'utf8'));
  }
  manifests.required = { id: 'required', slug: 'required', name: 'Required', settings: [
    { key: 'needed', label: 'Needed', required: true },
    { key: 'token', label: 'Token', type: 'secret' }
  ] };
  manifests.both = { ...structuredClone(manifests.required), id: 'both', slug: 'both',
    configurationAlternatives: [[{ key: 'token' }]] };
  manifests.optional = { id: 'optional', slug: 'optional', name: 'Optional', settings: [] };
  for (const [id, manifest] of Object.entries(manifests)) {
    const dir = path.join(process.env.MCPS_DIR, id);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(dir, 'index.js'), 'export function register(){throw new Error("Configuration must not execute module code");}\n');
  }
  await host.loadModules();
  assert.ok([...host.getModules().values()].every((m) => !m.error));
  configured('unknown', false);
  configured('optional', true);
  configured('required', false);
  set('required', { needed: 'present' }); configured('required', true);
  set('required', { needed: ' ' }); configured('required', true); // legacy required semantics unchanged
  set('both', { token: 'fixture' }); configured('both', false);
  set('both', { needed: 'present' }); configured('both', false);
  set('both', { needed: 'present', token: 'fixture' }); configured('both', true);

  for (const id of ['gmail', 'gdrive']) {
    configured(id, false);
    set(id, { access_token: ' \t\n' }); configured(id, false);
    set(id, { access_token: ' fixture-direct ' }); configured(id, true);
    for (const values of [{ client_id: 'id' }, { client_secret: 'secret' }, { client_id: 'id', client_secret: 'secret' }]) {
      set(id, values); configured(id, false);
    }
    const instance = host.createInstance(id, { name: 'Blank account' });
    configured(instance.id, false);
    set(instance.id, { access_token: 'fixture-instance' }); configured(instance.id, true);
    configured(id, false);
  }
  const gmailTuple = { client_id: 'id', client_secret: 'fixture-secret', refresh_token: 'fixture-refresh' };
  set('gmail', gmailTuple); configured('gmail', true);
  for (const key of Object.keys(gmailTuple)) {
    set('gmail', { ...gmailTuple, [key]: ' \t' }); configured('gmail', false);
  }
  for (let i = 1; i <= 3; i++) {
    const tuple = { client_id: 'id', client_secret: 'fixture-secret', [`account${i}_refresh_token`]: 'fixture-refresh', [`account${i}_enabled`]: 'enabled' };
    for (const status of ['disabled', 'false', '', ' enabled ']) {
      set('gdrive', { ...tuple, [`account${i}_enabled`]: status }); configured('gdrive', status === '' && i === 1);
    }
    set('gdrive', tuple); configured('gdrive', true);
    for (const key of ['client_id', 'client_secret', `account${i}_refresh_token`]) {
      set('gdrive', { ...tuple, [key]: ' \t' }); configured('gdrive', false);
    }
    const instance = host.createInstance('gdrive', { name: `Slot ${i}` });
    set(instance.id, { ...tuple, [`account${i}_enabled`]: '' }); configured(instance.id, false);
    host.saveSettings(instance.id, { [`account${i}_enabled`]: 'enabled' }); configured(instance.id, true);
  }
  // Source defaults apply, but new account instances deliberately inherit no defaults.
  set('gdrive', { client_id: 'id', client_secret: 'fixture-secret', account1_refresh_token: 'fixture-refresh' });
  delete getState().mcps.gdrive.settings.account1_enabled;
  configured('gdrive', true);
  set('gdrive', { client_id: 'id', client_secret: 'fixture-secret', account2_refresh_token: 'fixture-refresh' });
  delete getState().mcps.gdrive.settings.account2_enabled;
  configured('gdrive', false);
  set('gdrive', { client_id: 'id', client_secret: 'fixture-secret', account1_refresh_token: 'fixture-disabled', account1_enabled: 'disabled', account3_refresh_token: 'fixture-active', account3_enabled: 'enabled' });
  configured('gdrive', true);
  set('gdrive', { access_token: 'fixture-direct', account1_refresh_token: 'fixture-disabled', account1_enabled: 'disabled' });
  configured('gdrive', true);

  set('gdrive', { client_id: 'id', client_secret: 'fixture-secret', ...Object.fromEntries(
    [1, 2, 3].flatMap((i) => [[`account${i}_refresh_token`, 'fixture-disabled'], [`account${i}_enabled`, 'disabled']])) });
  configured('gdrive', false);
  set('gdrive', { client_id: 'id', client_secret: 'fixture-secret', account1_enabled: 'enabled',
    account2_enabled: 'disabled', account2_refresh_token: 'fixture-wrong-slot' });
  configured('gdrive', false);

  for (const id of ['gmail', 'gdrive']) {
    set(id, { access_token: 'fixture-private-token' });
    const encrypted = getState().mcps[id].settings.access_token;
    assert.ok(encrypted.startsWith('enc:v1:'));
    const masked = host.stationStore.settings(id);
    assert.equal(masked.settings.find((s) => s.key === 'access_token').value, '••••••');
    assert.ok(!JSON.stringify(masked).includes('fixture-private-token'));
    host.saveSettings(id, { access_token: '••••••' });
    assert.equal(getState().mcps[id].settings.access_token, encrypted);
    configured(id, true);
    persist();
    assert.ok(!fs.readFileSync(path.join(process.env.DATA_DIR, 'station.json'), 'utf8').includes('fixture-private-token'));
    loadState();
    assert.equal(host.getSettingsFor(id).access_token, 'fixture-private-token');
    configured(id, true);
    host.saveSettings(id, { access_token: '' }); configured(id, false);
    assert.ok(!JSON.stringify(host.getModuleById(id).manifest).includes('fixture-private-token'));
  }

  const base = manifests.gmail;
  assert.equal(host.ManifestSchema.safeParse({ ...base, configurationAlternatives: undefined }).success, true);
  for (const alternatives of [null, {}, [], [[]], [['access_token']], [[{}]], [[{ key: 'unknown' }]],
    [[{ key: 'access_token', value: 'private-literal' }]], [[{ key: 'client_id', value: '' }]],
    [[{ key: 'client_id', value: ' ' }]], [[{ key: 'client_id', value: false }]],
    [[{ key: 'client_id', equals: 'enabled' }]], [[{ key: 'client_id', value: 'enabled', private: 'forbidden' }]]]) {
    assert.equal(host.ManifestSchema.safeParse({ ...base, configurationAlternatives: alternatives }).success, false);
    checks++;
  }
  // Private registry keys are not valid references, even if present on disk.
  assert.equal(host.ManifestSchema.safeParse({ ...base, configurationAlternatives: [[{ key: 'token' }]] }).success, false);
  const legacy = host.ManifestSchema.parse(manifests.optional);
  assert.equal(Object.hasOwn(legacy, 'configurationAlternatives'), false);
  console.log(`PASS configuration: ${checks} readiness/schema checks; alternatives, exact guards, defaults, blank instances, encrypted sentinel roundtrip; no service calls`);
} finally {
  globalThis.fetch = originalFetch;
  await new Promise((resolve) => setTimeout(resolve, 200));
  fs.rmSync(root, { recursive: true, force: true });
}
