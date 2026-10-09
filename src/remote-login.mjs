import crypto from 'node:crypto';

const loopback = url => url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
  Number(url.port) > 0 && !url.username && !url.password && !url.hash;
const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
const html = '<details><summary>Gemini 服务器登录回调</summary><p>先在渠道页开始 Gemini 登录。Google 授权后，如果 localhost 页面打不开，请复制地址栏中的完整地址，粘贴到这里回传。</p><form id="ofm-callback"><label>完整回调地址 <input name="callback" type="url" required autocomplete="off" spellcheck="false"></label><button>回传登录结果</button><output aria-live="polite"></output></form></details><script src="/remote/login-helper.js" defer></script>';
const script = `document.getElementById('ofm-callback')?.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const output = form.querySelector('output');
  output.textContent = '正在回传…';
  try { const response = await fetch('/remote/callback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callback: form.elements.callback.value }) });
    output.textContent = await response.text(); if (response.ok) form.reset();
  } catch { output.textContent = '回传失败，请检查远程通道。'; }
});`;

async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new Error('body');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Targets come only from the authenticated upstream account.create reply. Never
// accept a browser-selected port as a new forwarding target.
export function createRemoteLogin({ now = Date.now, fetcher = fetch } = {}) {
  const flows = new Map();
  const prune = () => { for (const [id, flow] of flows) if (flow.until <= now()) flows.delete(id); };
  const send = (res, status, message, contentType = 'text/plain; charset=utf-8', extra = {}) => {
    res.writeHead(status, { ...headers, 'content-type': contentType, ...extra }); res.end(message);
  };
  return {
    html,
    clear(session) { for (const [id, flow] of flows) if (session === undefined || flow.session === session) flows.delete(id); },
    decorate(reply, session, origin, call) {
      prune();
      if (call?.method === 'account.delete' && reply?.ok === true) {
        for (const [id, flow] of flows) if (flow.session === session && flow.accountId === call.payload?.accountId) flows.delete(id);
      }
      if (call?.method !== 'account.create' || reply?.ok !== true || typeof reply.value?.loginUrl !== 'string') return reply;
      try {
        const login = new URL(reply.value.loginUrl);
        let flow;
        if (call.payload?.provider === 'gemini' && login.origin === 'https://accounts.google.com' && login.pathname === '/o/oauth2/v2/auth') {
          const callback = new URL(login.searchParams.get('redirect_uri'));
          const state = login.searchParams.get('state');
          if (!loopback(callback) || callback.pathname !== '/oauth-callback' || callback.search || !state) return reply;
          flow = { type: 'gemini', callback, state };
        } else if (call.payload?.provider === 'loomy' && loopback(login) && login.pathname === '/wechat/qr' && !login.search) {
          flow = { type: 'loomy', callback: login };
        } else return reply;
        // Bound retained flows even when a client repeatedly starts logins.
        if (flows.size >= 64) flows.delete(flows.keys().next().value);
        const id = crypto.randomBytes(24).toString('base64url');
        flows.set(id, { ...flow, session, accountId: reply.value.accountId, until: now() + (flow.type === 'loomy' ? 5 : 6) * 60_000 });
        if (flow.type === 'loomy') return { ...reply, value: { ...reply.value, loginUrl: `${origin}/remote/login/${id}/wechat/qr` } };
      } catch { /* Unknown upstream flows retain their original URL. */ }
      return reply;
    },
    async handle(req, res, target, session, origin) {
      if (!target.pathname.startsWith('/remote/')) return false;
      prune();
      if (target.pathname === '/remote/login-helper.js' && req.method === 'GET' && !target.search) {
        send(res, 200, script, 'text/javascript; charset=utf-8'); return true;
      }
      if (target.pathname === '/remote/callback') {
        if (req.method !== 'POST' || req.headers.origin !== origin || target.search) {
          send(res, 403, '请在当前控制台回传登录地址'); return true;
        }
        try {
          const callback = new URL(JSON.parse((await body(req)).toString('utf8')).callback);
          const entry = [...flows].find(([, flow]) => flow.type === 'gemini' && flow.session === session &&
            callback.origin === flow.callback.origin && callback.pathname === flow.callback.pathname &&
            callback.searchParams.get('state') === flow.state);
          const keys = [...callback.searchParams.keys()];
          if (!entry || !loopback(callback) || new Set(keys).size !== keys.length ||
              !(callback.searchParams.get('code') || callback.searchParams.get('error'))) {
            send(res, 400, '地址与当前待完成登录不匹配，或登录已过期；请重新开始登录'); return true;
          }
          // Remove before sending: a callback code is usable only once.
          flows.delete(entry[0]);
          const response = await fetcher(callback, { redirect: 'error', signal: AbortSignal.timeout(15000) });
          await response.body?.cancel();
          send(res, response.ok ? 200 : 400, response.ok ? '回调已送达服务器，请在渠道页查看登录状态。' : '原登录服务未接受回调，请重新登录。');
        } catch { send(res, 400, '回传失败，请确认完整回调地址和登录有效期。'); }
        return true;
      }
      const match = target.pathname.match(/^\/remote\/login\/([\w-]+)(\/wechat\/(qr|poll|complete))$/);
      const flow = match && flows.get(match[1]);
      if (!flow || flow.type !== 'loomy' || flow.session !== session || target.search ||
          req.method !== (match[3] === 'complete' ? 'POST' : 'GET')) {
        send(res, 404, '登录页面不存在或已过期，请回渠道页重新开始登录'); return true;
      }
      if (req.method === 'POST' && req.headers.origin !== origin) {
        send(res, 403, '请在当前扫码页面提交'); return true;
      }
      try {
        const response = await fetcher(new URL(match[2], flow.callback), { method: req.method,
          ...req.method === 'POST' ? { body: await body(req), headers: { 'content-type': 'application/json' } } : {},
          redirect: 'error', signal: AbortSignal.timeout(45000) });
        // Bound output from a native login listener; never forward its cookies.
        const reader = response.body?.getReader(); const chunks = []; let size = 0;
        try {
          while (reader) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.length; if (size > 2 * 1024 * 1024) throw new Error('response');
            chunks.push(Buffer.from(value));
          }
        } finally { await reader?.cancel().catch(() => {}); }
        let content = Buffer.concat(chunks).toString('utf8');
        const contentType = match[3] === 'qr' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8';
        const extra = {};
        if (match[3] === 'qr') {
          content = content.replaceAll('/wechat/', `/remote/login/${match[1]}/wechat/`);
          // The original QR page uses inline JS/style. Authorize only its exact
          // contents instead of broadly allowing any injected inline script.
          const hashes = (tag) => [...content.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))]
            .map(m => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`).join(' ');
          extra['content-security-policy'] = `default-src 'none'; script-src ${hashes('script')}; style-src ${hashes('style')}; img-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`;
        }
        send(res, response.status, content, contentType, extra);
      } catch { send(res, 502, '扫码登录服务暂时不可用，请重新开始登录。'); }
      return true;
    },
  };
}
