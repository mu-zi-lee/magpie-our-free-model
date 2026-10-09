import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createRemoteConsole } from '../src/remote-console.mjs';
import { structuralRejection } from '../vendor/ofm/src/trust.js';

test(`Cloudflare gateway authenticates all routes, translates only validated origins and closes explicitly`, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-gateway-'));
  const keyFile = path.join(dir, 'settings.json');
  fs.writeFileSync(keyFile, JSON.stringify({ forwardKey: 'local-private-key' }));
  let received, origin, closed = 0, clock = Date.now();
  const upstream = http.createServer(async (req, res) => {
    assert.equal(structuralRejection(req), undefined);
    let body = ''; for await (const chunk of req) body += chunk;
    if (req.url === '/api/management/session') {
      assert.equal(JSON.parse(body).key, 'local-private-key');
      res.writeHead(200, { 'set-cookie': 'upstream=private-session; HttpOnly; Path=/api/management' });
      return res.end('{}');
    }
    assert.equal(req.headers.cookie, 'upstream=private-session');
    received = { url: req.url, headers: req.headers, body };
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end('<html><body><div id="root"></div></body></html>'); }
    res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const gateway = await createRemoteConsole({ url: `http://127.0.0.1:${upstream.address().port}`, keyFile },
    { onClose: () => { closed++; }, now: () => clock, sessionMs: 30000 });
  t.after(async () => { await gateway.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  for (const address of ['https://attacker.example', 'https://old.tailnet.ts.net',
    'http://fixture.trycloudflare.com', 'https://nested.fixture.trycloudflare.com',
    'https://fixture.trycloudflare.com:8443', 'https://fixture.trycloudflare.com/path']) {
    assert.throws(() => gateway.setOrigin(address), /无效/);
  }
  origin = 'https://fixture-console.trycloudflare.com'; gateway.setOrigin(origin);
  const request = (pathname, options = {}) => new Promise((resolve, reject) => {
    const req = http.request(new URL(pathname, gateway.target), { method: options.method ?? 'GET',
      headers: { host: new URL(origin).host, ...(options.headers ?? {}) } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }); req.on('error', reject); req.end(options.body);
  });
  for (const route of ['/', '/assets/app.js', '/api/management/summary', '/v1/models']) assert.equal((await request(route)).status, 401);
  const ticket = gateway.ticket();
  const opened = await request(new URL(ticket).pathname);
  assert.equal(opened.status, 303); assert.equal(opened.headers.location, '/');
  assert.match(opened.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Strict/);
  assert.doesNotMatch(opened.headers['set-cookie'][0], /private-session/);
  assert.equal((await request(new URL(ticket).pathname)).status, 401);
  const cookie = opened.headers['set-cookie'][0].split(';')[0];
  const authenticated = (route, options = {}) => request(route, { ...options, headers: { cookie, ...options.headers } });
  const index = await authenticated('/'); assert.match(index.body, /结束远程访问/);
  assert.equal((await authenticated('/api/management/summary', { headers: { origin, referer: `${origin}/`, authorization: 'Bearer attacker', 'x-forwarded-host': 'evil.example' } })).status, 200);
  assert.equal(received.headers.authorization, undefined); assert.equal(received.headers['x-forwarded-host'], undefined);
  for (const headers of [{ origin: 'https://evil.example' }, { referer: 'https://evil.example' }, { host: '127.0.0.1' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await authenticated('/api/management/settings', { method: 'POST', headers })).status, 403);
  }
  for (const route of ['/v1/models', '/api/management/session', '/api/management/login/terminal', '/assets/../settings.json']) assert.equal((await authenticated(route)).status, 404);
  assert.equal((await authenticated('/remote/close', { method: 'POST' })).status, 403);
  assert.equal((await authenticated('/remote/close', { method: 'POST', headers: { origin } })).status, 200);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, 1);
  assert.equal((await authenticated('/')).status, 401);
  const expired = gateway.ticket(); clock += 10 * 60000 + 1;
  assert.equal((await request(new URL(expired).pathname)).status, 401);
  const navigation = gateway.ticket();
  const crossSite = await request(new URL(navigation).pathname, { headers: { referer: 'https://magpie.example/', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } });
  assert.equal(crossSite.status, 200); assert.match(crossSite.body, /http-equiv="refresh"/);
  const resource = gateway.ticket();
  assert.equal((await request(new URL(resource).pathname, { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' } })).status, 403);
});
