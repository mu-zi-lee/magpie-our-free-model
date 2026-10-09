import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRemoteLogin } from './remote-login.mjs';

const COOKIE = '__Host-ofm_remote';
const HEADERS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" };
const ticketMs = 10 * 60_000;

// The Funnel target is this authenticated gateway, never the model/API listener.
// External origins are checked before translating requests to the loopback fence.
export async function createRemoteConsole(service, { sessionMs = 30 * 60_000, onClose = () => {}, now = Date.now } = {}) {
  let origin;
  let closed = false;
  const tickets = new Map();
  const sessions = new Map();
  const upstreamSessions = new Set();
  const upstream = new URL(service.url);
  const login = createRemoteLogin({ now });
  const prune = () => {
    for (const [key, until] of tickets) if (until <= now()) tickets.delete(key);
    for (const [key, value] of sessions) if (value.until <= now()) { sessions.delete(key); login.clear(key); }
  };
  const cookieValue = req => String(req.headers.cookie ?? '').split(';').map(x => x.trim())
    .find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const fail = (res, status, message) => {
    res.writeHead(status, { ...HEADERS, 'content-type': 'text/plain; charset=utf-8' }); res.end(message);
  };
  const sameOrigin = (req, navigation = false) => {
    if (!origin || req.headers.host !== new URL(origin).host) return false;
    if (req.headers['sec-fetch-site'] === 'cross-site' && (!navigation || req.headers['sec-fetch-mode'] !== 'navigate')) return false;
    for (const name of ['origin', 'referer']) {
      if (req.headers[name] === undefined) continue;
      // A one-use capability link can be opened from Magpie on another origin.
      // All subsequent asset/API requests still require the exact public origin.
      if (navigation && name === 'referer') continue;
      try { if (new URL(req.headers[name]).origin !== origin) return false; } catch { return false; }
    }
    return true;
  };
  const closeAfterResponse = res => res.once('finish', () => { Promise.resolve(onClose()).catch(() => {}); });
  const server = http.createServer(async (req, res) => {
    try {
      const opening = req.method === 'GET' && String(req.url).startsWith('/open/');
      if (closed || !sameOrigin(req, opening)) return fail(res, 403, '远程入口仅允许当前 HTTPS 地址的同源访问');
      prune();
      const target = new URL(req.url, origin);
      if (target.pathname.startsWith('/open/')) {
        if (req.method !== 'GET' || target.search) return fail(res, 400, '无效管理链接');
        const token = target.pathname.slice(6);
        const until = tickets.get(token);
        tickets.delete(token);
        if (!until || until <= now()) return fail(res, 401, '管理链接已失效，请回 Magpie 重新打开远程控制台');
        if (sessions.size >= 16) return fail(res, 429, '远程会话过多');
        const { forwardKey } = JSON.parse(fs.readFileSync(service.keyFile, 'utf8'));
        const response = await fetch(`${service.url}/api/management/session`, { method: 'POST',
          headers: { 'content-type': 'application/json', origin: service.url },
          body: JSON.stringify({ key: forwardKey }), redirect: 'error', signal: AbortSignal.timeout(5000) });
        const cookie = response.headers.get('set-cookie')?.split(';')[0];
        await response.body?.cancel();
        if (!response.ok || !cookie || closed) return fail(res, 502, '管理会话建立失败，请重新打开');
        const id = crypto.randomBytes(32).toString('base64url');
        upstreamSessions.add(cookie);
        sessions.set(id, { cookie, until: now() + sessionMs });
        const headers = { ...HEADERS,
          'set-cookie': `${COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(sessionMs / 1000)}` };
        if (req.headers['sec-fetch-site'] === 'cross-site') {
          // Establish a same-site document before the next navigation so Strict
          // cookies work even when the capability link originated in Magpie Web.
          res.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' });
          return res.end('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/"><title>进入控制台</title><a href="/">身份已验证，进入控制台</a>');
        }
        res.writeHead(303, { ...headers, location: '/' }); return res.end();
      }
      const id = cookieValue(req);
      const session = sessions.get(id);
      if (!session) return fail(res, 401, '请通过 Magpie 生成的一次性链接进入远程控制台');
      if (target.pathname === '/remote/close') {
        if (req.method !== 'POST' || req.headers.origin !== origin) return fail(res, 403, '请在控制台点击结束远程访问');
        sessions.clear(); tickets.clear(); login.clear();
        closeAfterResponse(res);
        res.writeHead(200, { ...HEADERS, 'content-type': 'text/plain; charset=utf-8',
          'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
        return res.end('远程通道已关闭，可以关闭此页面。Magpie 的模型服务继续运行。');
      }
      if (await login.handle(req, res, target, id, origin)) return;
      const asset = target.pathname === '/' || /^\/assets\/[\w-]+\.(js|css)$/.test(target.pathname);
      const api = /^\/api\/management\/[\w/-]+$/.test(target.pathname);
      if (!asset && !api || ['/api/management/session', '/api/management/login/terminal'].includes(target.pathname)) {
        return fail(res, 404, '远程入口仅提供账号管理控制台');
      }
      if (asset && !['GET', 'HEAD'].includes(req.method) || api && !['GET', 'POST'].includes(req.method)) return fail(res, 405, '不支持的请求方法');
      const headers = { host: upstream.host, cookie: session.cookie, origin: service.url, referer: `${service.url}/`, 'sec-fetch-site': 'same-origin' };
      const channelRpc = target.pathname === '/api/management/channels/rpc' && req.method === 'POST';
      const callChunks = [];
      for (const name of ['content-type', 'accept']) if (req.headers[name]) headers[name] = req.headers[name];
      const out = http.request(new URL(target.pathname + target.search, upstream), { method: req.method, headers }, back => {
        const returned = {};
        for (const name of ['content-type', 'content-security-policy', 'x-content-type-options']) if (back.headers[name]) returned[name] = back.headers[name];
        returned['cache-control'] = 'no-store'; returned['referrer-policy'] = 'no-referrer';
        // Never leak upstream cookies, keys via URL redirects, or forwarding headers.
        if (back.statusCode >= 300 && back.statusCode < 400) { back.resume(); return fail(res, 502, '控制台返回了不支持的重定向'); }
        if (target.pathname === '/' && req.method === 'GET' && back.statusCode === 200) {
          let html = '';
          back.setEncoding('utf8');
          back.on('data', chunk => { html += chunk; });
          back.on('end', () => {
            const banner = '<aside>临时远程控制台：通道最多开放 30 分钟。完成账号管理后请关闭。<form method="post" action="/remote/close"><button type="submit">结束远程访问</button></form>' + login.html + '</aside>';
            res.writeHead(200, returned); res.end(html.replace('<body>', `<body>${banner}`));
          });
        } else if (channelRpc && back.statusCode === 200) {
          const chunks = []; let size = 0;
          back.on('data', chunk => {
            size += chunk.length;
            if (size > 8 * 1024 * 1024) { back.destroy(); return fail(res, 502, '渠道响应过大'); }
            chunks.push(chunk);
          });
          back.on('end', () => {
            if (res.headersSent) return;
            const raw = Buffer.concat(chunks);
            let result = raw;
            try {
              const call = JSON.parse(Buffer.concat(callChunks).toString('utf8'));
              result = JSON.stringify(login.decorate(JSON.parse(raw.toString('utf8')), id, origin, call));
            } catch { /* Preserve unrelated native RPC replies. */ }
            res.writeHead(200, returned); res.end(result);
          });
        } else {
          if (target.pathname === '/api/management/logout' && req.method === 'POST' && back.statusCode < 300) {
            upstreamSessions.delete(session.cookie); sessions.delete(id); login.clear(id); closeAfterResponse(res);
          }
          res.writeHead(back.statusCode, returned); back.pipe(res);
        }
        back.on('error', () => res.destroy());
      });
      out.on('error', () => { if (!res.headersSent) fail(res, 502, '本机控制台暂时不可用'); else res.destroy(); });
      req.on('aborted', () => out.destroy());
      res.on('close', () => out.destroy());
      let bytes = 0;
      req.on('data', chunk => {
        bytes += chunk.length;
        if (channelRpc && bytes <= 16384) callChunks.push(chunk);
        else if (channelRpc) callChunks.length = 0;
        if (bytes > 8 * 1024 * 1024) { out.destroy(); if (!res.headersSent) fail(res, 413, '请求内容过大'); }
      });
      req.pipe(out);
    } catch { if (!res.headersSent) fail(res, 502, '远程控制台请求失败'); else res.destroy(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    target: `http://127.0.0.1:${server.address().port}`,
    setOrigin(value) {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.ts.net') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('无效 Tailscale HTTPS 地址');
      origin = url.origin;
    },
    ticket() {
      if (closed || !origin) throw new Error('远程通道尚未就绪');
      prune();
      if (tickets.size >= 32) tickets.delete(tickets.keys().next().value);
      const token = crypto.randomBytes(32).toString('base64url');
      tickets.set(token, now() + ticketMs);
      return `${origin}/open/${token}`;
    },
    async close() {
      closed = true; tickets.clear(); sessions.clear(); login.clear(); server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      // Reopening remote access must not consume the upstream's 64 session slots.
      const cookies = [...upstreamSessions]; upstreamSessions.clear();
      await Promise.allSettled(cookies.map(async cookie => {
        const response = await fetch(`${service.url}/api/management/logout`, { method: 'POST',
          headers: { cookie, origin: service.url, 'content-type': 'application/json' },
          body: '{}', redirect: 'error', signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
      }));
    },
  };
}
