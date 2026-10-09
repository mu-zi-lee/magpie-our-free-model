import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';

// A short-lived browser handoff exchanges a one-use ticket for the upstream
// HttpOnly management cookie. API keys never enter URLs or browser JavaScript.
export async function createConsoleHandoff(service, port = 0) {
  const tickets = new Map();
  let address;
  const server = http.createServer(async (req, res) => {
    const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" };
    try {
      if (req.headers.host !== new URL(address).host || req.method !== 'GET' ||
          req.headers.origin && req.headers.origin !== address) throw new Error('invalid handoff');
      const target = new URL(req.url, address);
      const token = target.pathname.startsWith('/open/') ? target.pathname.slice(6) : '';
      const until = tickets.get(token);
      tickets.delete(token);
      if (!until || until < Date.now() || target.search) throw new Error('expired handoff');
      const { forwardKey } = JSON.parse(fs.readFileSync(service.keyFile, 'utf8'));
      const session = await fetch(`${service.url}/api/management/session`, { method: 'POST',
        headers: { 'content-type': 'application/json', origin: service.url },
        body: JSON.stringify({ key: forwardKey }), redirect: 'error', signal: AbortSignal.timeout(5000) });
      const cookie = session.headers.get('set-cookie');
      await session.body?.cancel();
      if (!session.ok || !cookie) throw new Error('session exchange failed');
      res.writeHead(303, { ...headers, 'set-cookie': cookie, location: service.url + '/' });
      res.end();
    } catch {
      res.writeHead(401, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
      res.end('管理链接已失效。请回 Magpie，再次点击“打开账号管理控制台”。');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  address = `http://127.0.0.1:${server.address().port}`;
  return {
    ticket() {
      for (const [id, until] of tickets) if (until < Date.now()) tickets.delete(id);
      if (tickets.size >= 32) tickets.delete(tickets.keys().next().value);
      const token = crypto.randomBytes(32).toString('base64url');
      tickets.set(token, Date.now() + 10 * 60000);
      return `${address}/open/${token}`;
    },
    close() { tickets.clear(); server.closeAllConnections?.(); return new Promise(resolve => server.close(resolve)); },
  };
}
