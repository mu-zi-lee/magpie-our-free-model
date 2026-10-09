import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { createRemoteLogin } from '../src/remote-login.mjs';

const origin = 'https://fixture-console.trycloudflare.com';
async function handle(login, pathname, { session = 'session', method = 'GET', value, headers = {} } = {}) {
  const req = Readable.from(value === undefined ? [] : [Buffer.from(JSON.stringify(value))]);
  req.method = method; req.headers = headers;
  const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  const handled = await login.handle(req, response, new URL(pathname, origin), session, origin);
  return { ...response, handled };
}
function registerGoogle(login, port, session = 'session') {
  const redirect = `http://localhost:${port}/oauth-callback`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('redirect_uri', redirect); url.searchParams.set('state', 'fixture-state');
  login.decorate({ ok: true, value: { accountId: 'account', loginUrl: url.href } }, session, origin, { method: 'account.create', payload: { provider: 'gemini' } });
  return `${redirect}?state=fixture-state&code=fixture-code`;
}

test('Gemini remote callback reaches original listener once, with session/state/port/origin fences', async t => {
  let calls = 0;
  const server = http.createServer((req, res) => { calls++; assert.equal(req.headers.cookie, undefined); assert.equal(req.headers.authorization, undefined); res.end('ok'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const login = createRemoteLogin();
  const callback = registerGoogle(login, server.address().port);
  const request = overrides => handle(login, '/remote/callback', { method: 'POST', value: { callback }, headers: { origin, cookie: 'private', authorization: 'private' }, ...overrides });
  assert.equal((await request({ session: 'another' })).status, 400);
  assert.equal((await request({ headers: { origin: 'https://evil.invalid' } })).status, 403);
  for (const bad of [callback.replace('fixture-state', 'wrong'), callback.replace('localhost', 'evil.invalid'), callback.replace('/oauth-callback', '/settings'), callback + '&state=fixture-state', callback.replace(`:${server.address().port}`, ':9')]) {
    assert.equal((await request({ value: { callback: bad } })).status, 400);
  }
  assert.equal(calls, 0);
  assert.equal((await request()).status, 200); assert.equal(calls, 1);
  assert.equal((await request()).status, 400); assert.equal(calls, 1);
});

test('Loomy native QR HTML and complete routes are relayed only for the originating session', async t => {
  let received;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received = { path: req.url, body, headers: req.headers };
    res.setHeader('set-cookie', 'do-not-forward=private');
    res.end(req.url === '/wechat/qr' ? '<style>body{color:red}</style><img src="data:image/png;base64,AA"><script>fetch(\'/wechat/poll\'); fetch(\'/wechat/complete\')</script>' : '{"ok":true}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  let clock = Date.now();
  const login = createRemoteLogin({ now: () => clock });
  const reply = { ok: true, value: { accountId: 'account', loginUrl: `http://127.0.0.1:${server.address().port}/wechat/qr` } };
  const decorated = login.decorate(reply, 'session', origin, { method: 'account.create', payload: { provider: 'loomy' } });
  const route = new URL(decorated.value.loginUrl).pathname;
  assert.ok(route.startsWith('/remote/login/')); assert.equal(reply.value.loginUrl.startsWith('http:'), true);
  assert.equal((await handle(login, route, { session: 'another' })).status, 404);
  const html = await handle(login, route);
  assert.equal(html.status, 200); assert.ok(html.body.includes(route.replace('/qr', '/poll')));
  assert.match(html.headers['content-security-policy'], /script-src 'sha256-/);
  assert.equal(html.headers['set-cookie'], undefined);
  assert.equal((await handle(login, route.replace('/qr', '/complete'), { method: 'POST', value: { phone: 'fixture' } })).status, 403);
  const complete = await handle(login, route.replace('/qr', '/complete'), { method: 'POST', headers: { origin }, value: { phone: 'fixture' } });
  assert.equal(complete.status, 200); assert.equal(received.path, '/wechat/complete');
  assert.equal(received.headers.cookie, undefined);
  for (const path of [route + '?target=http://localhost:9', route.replace('/qr', '/settings'), route.replace('/wechat/qr', '/../../settings')]) assert.equal((await handle(login, path)).status, 404);
  clock += 6 * 60000 + 1; assert.equal((await handle(login, route)).status, 404);
});

test('callback expiry and closing a session remove its pending login', async () => {
  let clock = Date.now(); const login = createRemoteLogin({ now: () => clock, fetcher() { throw new Error('must not fetch'); } });
  let callback = registerGoogle(login, 1234); clock += 6 * 60000 + 1;
  assert.equal((await handle(login, '/remote/callback', { method: 'POST', headers: { origin }, value: { callback } })).status, 400);
  callback = registerGoogle(login, 1234); login.clear('session');
  assert.equal((await handle(login, '/remote/callback', { method: 'POST', headers: { origin }, value: { callback } })).status, 400);
});
