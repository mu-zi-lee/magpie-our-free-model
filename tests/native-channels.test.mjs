import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startStandalone } from '../vendor/ofm/packages/standalone/service.mjs';
import { channelBusinessUrl, CHANNEL_COMMIT } from '../src/channel-source.mjs';
import { createRemoteConsole } from '../src/remote-console.mjs';
import { getManagedRuntime } from '../src/managed-runtime.mjs';

test('unchanged original bundle: native Gemini default login/credential save and Loomy QR/poll via real remote gateway',
  { skip: !process.env.OFM_TEST_CHANNEL_SOURCE }, async t => {
    assert.ok(process.execArgv.some(arg => arg.includes('native-channel-fixture.mjs')), 'requires fixture preload');
    // This host may inject non-Worker Node flags. Keep only the fixture preload.
    process.execArgv = ['--import', new URL('./native-channel-fixture.mjs', import.meta.url).href];
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ofm-native-channels-'));
    let service, gateway;
    t.after(async () => { await gateway?.close(); await service?.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
    const cache = path.join(dataDir, 'runtime', `channels-${CHANNEL_COMMIT}`);
    await fs.mkdir(path.dirname(cache), { recursive: true });
    await fs.cp(process.env.OFM_TEST_CHANNEL_SOURCE, cache, { recursive: true });
    const channelBusiness = await channelBusinessUrl({ dataDir }, { fetch() { throw new Error('must reuse verified cache'); } });
    service = await startStandalone({ dataDir, port: 0, refresh: false, channelBusiness,
      logger: { info() {}, warn() {}, error() {} } });
    gateway = await createRemoteConsole(service);
    assert.equal(service.channels.providers.length, 13);
    const origin = 'https://native-fixture.trycloudflare.com'; gateway.setOrigin(origin);
    let cookie;
    const request = (pathname, value) => new Promise((resolve, reject) => {
      const req = http.request(new URL(pathname, gateway.target), { method: value ? 'POST' : 'GET', headers: {
        host: new URL(origin).host, origin, 'content-type': 'application/json', ...cookie ? { cookie } : {},
      } }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }); req.on('error', reject); req.end(value ? JSON.stringify(value) : undefined);
    });
    const open = await request(new URL(gateway.ticket()).pathname);
    assert.equal(open.status, 303); cookie = open.headers['set-cookie'][0].split(';')[0];
    const homepage = await request('/'); assert.ok(homepage.body.includes('/remote/login-helper.js'));
    const rpc = async (method, payload) => {
      const response = await request('/api/management/channels/rpc', { method, payload });
      assert.equal(response.status, 200); const result = JSON.parse(response.body); assert.equal(result.ok, true); return result.value;
    };
    const gemini = await rpc('account.create', { provider: 'gemini' });
    const google = new URL(gemini.loginUrl); assert.equal(google.origin, 'https://accounts.google.com');
    assert.ok(google.searchParams.get('client_id'));
    const callback = new URL(google.searchParams.get('redirect_uri'));
    assert.equal(callback.hostname, 'localhost'); callback.searchParams.set('state', google.searchParams.get('state')); callback.searchParams.set('code', 'fixture-code');
    assert.equal((await request('/remote/callback', { callback: callback.href })).status, 200);
    const waitAccount = async (provider, expected) => {
      for (let i = 0; i < 100; i++) {
        const list = await rpc('account.list', { provider });
        if (list.accounts.some(row => row.nickname === expected)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail('native account did not persist');
    };
    await waitAccount('gemini', 'fixture@example.invalid');
    const credentials = JSON.parse(await fs.readFile(path.join(dataDir, 'channel-credentials.json'), 'utf8'));
    assert.ok(Object.values(credentials).some(raw => JSON.parse(raw).refresh_token === 'fixture-refresh'));
    const loomy = await rpc('account.create', { provider: 'loomy' });
    const qrPath = new URL(loomy.loginUrl).pathname; assert.ok(qrPath.startsWith('/remote/login/'));
    const qr = await request(qrPath); assert.equal(qr.status, 200);
    assert.ok(qr.body.includes('data:image/png;base64,')); assert.ok(qr.body.includes(qrPath.replace('/qr', '/poll')));
    const poll = await request(qrPath.replace('/qr', '/poll')); assert.equal(poll.status, 200);
    assert.equal(JSON.parse(poll.body).status, 'done');
    await waitAccount('loomy', 'Fixture WeChat');
    console.log('Original 13-provider bundle, native Gemini credential persistence and remote Loomy QR/poll passed with mocked vendor services.');
  });

test('managed runner defaults to the verified original bundle and ignores malformed legacy OAuth/App ID files',
  { skip: !process.env.OFM_TEST_CHANNEL_SOURCE || process.platform === 'win32' }, async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ofm-native-runner-'));
    const dataDir = path.join(directory, 'data');
    const cache = path.join(dataDir, 'runtime', `channels-${CHANNEL_COMMIT}`);
    await fs.mkdir(path.dirname(cache), { recursive: true });
    await fs.cp(process.env.OFM_TEST_CHANNEL_SOURCE, cache, { recursive: true });
    await fs.writeFile(path.join(dataDir, 'gemini-oauth.json'), 'invalid legacy config');
    await fs.writeFile(path.join(dataDir, 'loomy-wechat.json'), 'invalid legacy config');
    const nodePath = path.join(directory, 'node-fixture');
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    await fs.writeFile(nodePath, `#!/bin/sh\nexec ${quote(process.execPath)} --import ${quote(new URL('./native-channel-fixture.mjs', import.meta.url).pathname)} "$@"\n`, { mode: 0o700 });
    const runtime = getManagedRuntime({ directory: path.join(directory, 'config') }, {
      dataDir, nodePath, port: 0, refresh: false, autoInstallEac: false, consoleAccess: 'local',
    });
    t.after(async () => { await runtime.close(); await fs.rm(directory, { recursive: true, force: true }); });
    const service = await runtime.ensure();
    const { forwardKey } = JSON.parse(await fs.readFile(service.keyFile, 'utf8'));
    const response = await fetch(`${service.url}/api/management/session`, { method: 'POST',
      headers: { origin: service.url, 'content-type': 'application/json' }, body: JSON.stringify({ key: forwardKey }) });
    const cookie = response.headers.get('set-cookie').split(';')[0]; await response.body.cancel();
    const loginResponse = await fetch(`${service.url}/api/management/channels/rpc`, { method: 'POST',
      headers: { cookie, origin: service.url, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'account.create', payload: { provider: 'gemini' } }) });
    const login = await loginResponse.json(); assert.equal(login.ok, true);
    assert.ok(new URL(login.value.loginUrl).searchParams.get('client_id'));
  });
