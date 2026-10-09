import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createManagedPlugin, managedModel } from '../src/managed.mjs';
import { getManagedRuntime } from '../src/managed-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(100); }
  throw new Error('Fixture wait expired');
}
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

test('upstream runtime hashes match the declared snapshot and Google configuration patch', () => {
  const dir = path.join(root, 'vendor/ofm');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'UPSTREAM.json')));
  assert.equal(manifest.commit, 'f8974369c5904858c696b520d8b9b82ad4425f78');
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(path.join(dir, file.path));
    const patch = manifest.adaptations?.find(patch => patch.path === file.path);
    if (patch) assert.equal(patch.originalSha256, file.sha256);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), patch?.sha256 ?? file.sha256, file.path);
    assert.doesNotMatch(file.path, /(?:^|\/)(?:settings|channel-credentials|eac-user|service\.lock)\.json$/);
  }
  const business = fs.readFileSync(path.join(dir, 'packages/standalone/channels/business.mjs'), 'utf8');
  for (const name of ['vault-data.js', 'vault-anchor.js']) assert.equal(fs.existsSync(path.join(dir, 'src', name)), false);
  const stub = fs.readFileSync(path.join(dir, 'src/vault.js'), 'utf8');
  assert.ok(!stub.includes('crypto') && !stub.includes('LANE_SEAL'));
  assert.match(business, /var GEMINI_DEFAULT_CLIENT_ID = "";/);
  assert.match(business, /var GEMINI_DEFAULT_CLIENT_SECRET = "";/);
  assert.match(business, /var LOOMY_WECHAT_APP_ID = "";/);
  assert.doesNotMatch(business, /wx[0-9a-f]{16}/);
  assert.match(business, /encodeURIComponent\(appId\)/);
});

test('managed metadata preserves native effort ids and declared image/context capabilities', () => {
  const model = managedModel({ id: 'buddy/test', context_window: 128000, max_tokens: 8192,
    input: ['text', 'image'], reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }, 'http://127.0.0.1/v1');
  assert.equal(model.limit.context, 128000);
  assert.equal(model.limit.output, 8192);
  assert.equal(model.capabilities.input.image, true);
  assert.equal(model.capabilities.reasoning, true);
  assert.deepEqual(model.variants.high, { reasoningEffort: 'high' });
  const plain = managedModel({ id: 'unknown' }, 'http://127.0.0.1/v1');
  assert.equal(plain.capabilities.input.image, false);
  assert.deepEqual(plain.variants, {});
  assert.equal(managedModel({ id: '__proto__' }, ''), undefined);
});

test('managed lifecycle validates settings, prevents conflicting instances and diagnoses missing Node', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => getManagedRuntime({ directory: dir }, { port: -1 }), /port/);
  assert.throws(() => getManagedRuntime({ directory: dir }, { port: 18900, consolePort: 18900 }), /consolePort/);
  const runtime = getManagedRuntime({ directory: dir }, { nodePath: path.join(dir, 'missing-node') });
  assert.equal(getManagedRuntime({ directory: dir }, { nodePath: path.join(dir, 'missing-node') }), runtime);
  assert.throws(() => getManagedRuntime({ directory: dir }, { port: 0 }), /不同服务设置/);
  await assert.rejects(runtime.ensure(), /Node/);
});

test('real bundled service: console handoff, channels, EAC, requests, key rotation and shutdown', { skip: process.platform === 'win32' }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-managed-'));
  const dataDir = path.join(dir, 'data');
  const requests = [];
  const upstream = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ pathname, body, headers: req.headers });
    const json = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
    if (pathname.endsWith('/auth/status')) return json({ authorized: !!req.headers['x-ofm-user'], starred: true });
    if (pathname.endsWith('/auth/github/start')) { res.writeHead(302, { location: 'https://example.invalid/login' }); return res.end(); }
    if (pathname.endsWith('/auth/poll')) return json({ status: 'ok', token: 'fixture-eac', login: 'fixture', ackRequired: true });
    if (pathname.endsWith('/auth/ack') || pathname.endsWith('/auth/logout')) return json({ ok: true });
    if (pathname.endsWith('/pool')) return json({ ok: true, inflight: 1 });
    if (pathname.endsWith('/models')) return json({ data: req.headers['x-ofm-signature']
      ? [{ id: 'fixture-eac-model' }] : pathname === '/models' ? [{ id: 'fixture/free', isFree: true }]
      : [{ id: 'mimo-v2.6-flash-free' }] });
    if (pathname.includes('/console/enterprises/') || pathname.endsWith('/v3/config')) return json({ data: {
      models: [{ id: 'fixture-free', name: 'Fixture', credits: 'x0', maxInputTokens: 128000,
        maxOutputTokens: 4096, supportsImages: true, reasoning: { supportedEfforts: ['low', 'high'], defaultEffort: 'high' } }],
      agents: [{ name: 'craft', models: ['fixture-free'] }],
    } });
    if (pathname.endsWith('/chat/completions')) {
      res.setHeader('content-type', 'text/event-stream');
      const frames = [ { choices: [{ index: 0, delta: { content: 'managed-ok' } }] },
        ...(body.tools?.some(tool => tool.function?.name === 'lookup') ? [{ choices: [{ index: 0, delta: { tool_calls: [
          { index: 0, id: 'call_fixture', type: 'function', function: { name: 'lookup', arguments: '{}' } } ] } }] }] : []),
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } } ];
      return res.end(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n');
    }
    json({ data: { Response: { Data: { Accounts: [] } } } });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const fixture = `http://127.0.0.1:${upstream.address().port}`;
  const envKeys = ['OFM_TEST_UPSTREAM', 'OUR_FREE_MODEL_BASE', 'OUR_FREE_MODEL_KILO_BASE', 'OFM_TEST_EAC_SOURCE'];
  const before = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys.slice(0, 3)) process.env[key] = fixture;
  const eacSourceDir = path.join(dir, 'local-eac');
  process.env.OFM_TEST_EAC_SOURCE = eacSourceDir;
  fs.mkdirSync(path.join(dataDir, 'channel-pack'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'channel-pack/state.json'), JSON.stringify({
    accounts: [{ id: 'buddy-fixture', provider: 'buddy', nickname: 'Fixture', enabled: true,
      refreshable: false, createdAt: Date.now(), expiresAt: Date.now() + 86400000, credentialRef: 'BUDDY_FIXTURE' }], disabledModels: {},
  }));
  fs.writeFileSync(path.join(dataDir, 'channel-credentials.json'), JSON.stringify({ BUDDY_FIXTURE: JSON.stringify({
    access_token: 'fixture-access', refresh_token: 'fixture-refresh', domain: 'copilot.tencent.com',
    expires_at: String(Date.now() + 86400000), refresh_expires_at: String(Date.now() + 7 * 86400000),
    user_id: 'fixture-user', nickname: 'Fixture', account_type: 'personal',
  }) }));
  const wrapper = path.join(dir, 'node-fixture');
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec ${quote(process.execPath)} --import ${quote(path.join(root, 'tests/managed-fixture.mjs'))} "$@"\n`, { mode: 0o700 });
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const consolePort = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const input = { directory: dir };
  const tunnelTarget = path.join(dir, 'tunnel-target.txt');
  const tailscaleScript = path.join(dir, 'tailscale-fixture.mjs');
  fs.writeFileSync(tailscaleScript, `import fs from 'node:fs';
    const args=process.argv.slice(2);
    if(args[0]==='version') { console.log('1.102.4'); process.exit(0); }
    if(args[0]==='status') { console.log(JSON.stringify({BackendState:'Running',Self:{DNSName:'managed.fixture.ts.net.'}})); process.exit(0); }
    if(args[0]==='funnel' && args[1]==='status') { console.log('{}'); process.exit(0); }
    if(args[0]==='funnel') {
      fs.writeFileSync(${JSON.stringify(tunnelTarget)}, args.at(-1));
      console.log('Available on the internet:\\nhttps://managed.fixture.ts.net');
      setInterval(()=>{},1000); process.on('SIGTERM',()=>process.exit(0));
    } else process.exit(1);
  `);
  const tailscalePath = path.join(dir, 'tailscale');
  fs.writeFileSync(tailscalePath, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(tailscaleScript)} "$@"\n`, { mode: 0o700 });
  const options = { dataDir, nodePath: wrapper, port: 0, consolePort, eacSourceDir, consoleAccess: 'local', tailscalePath };
  const runtime = getManagedRuntime(input, options);
  t.after(async () => {
    await runtime.close();
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
    for (const key of envKeys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const plugin = await createManagedPlugin(input, options);
  const login = await plugin.auth.methods[0].authorize();
  const result = await login.callback();
  const auth = { type: 'api', key: result.key, metadata: result.metadata };
  assert.equal(auth.key, 'managed');
  assert.ok(!login.url.includes('ofm-'));
  assert.equal(new URL(login.url).port, String(consolePort));
  const conn = await runtime.connection();
  const api = async (suffix, body, cookie) => {
    const response = await fetch(conn.base.replace(/\/v1$/, '') + suffix, {
      method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json',
        ...(cookie ? { cookie } : { authorization: `Bearer ${(await runtime.connection()).key}` }) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
    return { status: response.status, body: await response.json() };
  };
  await t.test('one-use console login gives a real management cookie and can be reopened', async () => {
    const handoff = await fetch(login.url, { redirect: 'manual' });
    assert.equal(handoff.status, 303);
    const cookie = handoff.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    const summary = await api('/api/management/summary', undefined, cookie.split(';')[0]);
    assert.equal(summary.status, 200);
    assert.equal(summary.body.channels.state, 'ready');
    assert.equal(summary.body.networkMode, 'fixture');
    assert.equal((await fetch(login.url)).status, 401);
    const next = await plugin.auth.methods[0].authorize();
    assert.notEqual(next.url, login.url);
    assert.equal((await fetch(next.url, { redirect: 'manual' })).status, 303);
  });
  await t.test('remote auth goes through the real runner and gateway; closing it keeps model service running', async () => {
    const remote = await plugin.auth.methods[1].authorize();
    assert.match(remote.url, /^https:\/\/managed\.fixture\.ts\.net\/open\//);
    const target = fs.readFileSync(tunnelTarget, 'utf8');
    // Node fetch does not preserve a caller-supplied Host on all supported versions.
    const request = (pathname, options = {}) => new Promise((resolve, reject) => {
      const req = httpRequest(target + pathname, { ...options, headers: { host: 'managed.fixture.ts.net', ...options.headers } }, res => {
        let body = ''; res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }); req.on('error', reject); req.end();
    });
    const opened = await request(new URL(remote.url).pathname);
    assert.equal(opened.status, 303);
    const cookie = opened.headers['set-cookie'][0].split(';')[0];
    const summary = await request('/api/management/summary', { headers: { cookie } });
    assert.equal(summary.status, 200); assert.equal(JSON.parse(summary.body).channels.state, 'ready');
    const closed = await request('/remote/close', { method: 'POST', headers: { cookie, origin: 'https://managed.fixture.ts.net' } });
    assert.equal(closed.status, 200);
    await until(async () => { try { await fetch(target); return false; } catch { return true; } });
    assert.equal((await api('/api/management/summary')).status, 200);
  });
  let models;
  const provider = { models: {} };
  await t.test('model sync uses real core and channel capabilities, not defaults', async () => {
    models = await until(async () => { const rows = await plugin.provider.models(provider, { auth }); return rows['buddy/fixture-free'] && rows['mimo-v2.6-flash-free'] ? rows : undefined; });
    assert.equal(models['buddy/fixture-free'].capabilities.input.image, true);
    assert.equal(models['buddy/fixture-free'].limit.context, 128000);
    assert.deepEqual(Object.keys(models['mimo-v2.6-flash-free'].variants), ['light', 'balanced', 'deep']);
    assert.equal(models['mimo-v2.6-flash-free'].capabilities.input.image, true);
  });
  const loader = await plugin.auth.loader(async () => auth);
  const call = (model, extra = {}) => loader.fetch(`${loader.baseURL}/chat/completions`, { method: 'POST',
    headers: { authorization: 'Bearer downstream-secret', cookie: 'downstream-cookie' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], stream: true, ...extra }) });
  await t.test('real channel inference retains tools and strips downstream secrets', async () => {
    const response = await call('buddy/fixture-free', { tools: [{ type: 'function', function: { name: 'lookup', parameters: {} } }] });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /managed-ok/); assert.match(text, /call_fixture/);
    assert.ok(!JSON.stringify(requests).includes('downstream-secret'));
    assert.ok(!JSON.stringify(requests).includes('downstream-cookie'));
  });
  await t.test('inline image bytes reach the real channel adapter', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
    const response = await call('buddy/fixture-free', { messages: [{ role: 'user', content: [
      { type: 'text', text: 'what' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } } ] }] });
    assert.equal(response.status, 200); await response.text();
    assert.ok(JSON.stringify(requests.findLast(req => req.pathname.endsWith('/chat/completions')).body).includes(png));
  });
  await t.test('anonymous Light effort applies the original hard token budget', async () => {
    const response = await call('mimo-v2.6-flash-free', { reasoning_effort: 'light', max_tokens: 7000 });
    assert.equal(response.status, 200); await response.text();
    assert.equal(requests.findLast(req => req.pathname.endsWith('/chat/completions')).body.max_tokens, 4096);
  });
  await t.test('EAC preserves upstream authorization and updates the unified model catalog', async () => {
    const start = await api('/api/management/eac/login/start', {});
    assert.ok(start.body.link, JSON.stringify(start));
    const poll = await api(`/api/management/eac/login/poll?link=${start.body.link}`);
    assert.equal(poll.body.status, 'ok');
    const rows = await until(async () => { const rows = await plugin.provider.models(provider, { auth }); return rows['fixture-eac-model'] ? rows : undefined; });
    const id = 'fixture-eac-model';
    const response = await call(id); assert.equal(response.status, 200); await response.text();
    const request = requests.findLast(req => req.pathname.endsWith('/chat/completions'));
    assert.equal(request.headers['x-ofm-user'], 'fixture-eac');
    assert.equal(typeof request.headers['x-ofm-signature'], 'string');
  });
  await t.test('stale Magpie catalog cannot re-enable a disabled model', async () => {
    const disabled = await api('/api/management/channels/rpc', { method: 'model.setDisabled', payload: { provider: 'buddy', modelId: 'fixture-free', disabled: true } });
    assert.equal(disabled.body.ok, true, JSON.stringify(disabled));
    const before = requests.filter(req => req.pathname.endsWith('/chat/completions')).length;
    const response = await call('buddy/fixture-free');
    assert.equal(response.status, 404);
    const stream = await response.text();
    assert.ok(!stream.includes('managed-ok'));
    assert.equal(requests.filter(req => req.pathname.endsWith('/chat/completions')).length, before);
    await api('/api/management/channels/rpc', { method: 'model.setDisabled', payload: { provider: 'buddy', modelId: 'fixture-free', disabled: false } });
  });
  await t.test('API key rotation does not require another Magpie login', async () => {
    const old = conn.key;
    const rotate = await api('/api/management/key/rotate', { confirm: true });
    assert.equal(rotate.status, 200);
    assert.notEqual((await runtime.connection()).key, old);
    const response = await call('buddy/fixture-free'); assert.equal(response.status, 200); await response.text();
  });
  await t.test('parallel starts share one child and close removes its service lock', async () => {
    const states = await Promise.all([runtime.ensure(), runtime.ensure()]);
    assert.equal(states[0].pid, states[1].pid);
    await runtime.close();
    assert.equal(fs.existsSync(path.join(dataDir, 'service.lock')), false);
    await assert.rejects(fetch(conn.base + '/models', { signal: AbortSignal.timeout(1000) }));
  });
  await t.test('dead child lock is recovered and existing account data survives restart', async () => {
    const state = await runtime.ensure();
    process.kill(state.pid, 'SIGKILL'); await runtime.exited;
    assert.equal(fs.existsSync(path.join(dataDir, 'service.lock')), true);
    const next = await runtime.ensure();
    assert.notEqual(next.pid, state.pid);
    assert.ok(JSON.parse(fs.readFileSync(path.join(dataDir, 'channel-credentials.json'))).BUDDY_FIXTURE);
    await runtime.close();
    assert.equal(fs.existsSync(path.join(dataDir, 'service.lock')), false);
  });
});
