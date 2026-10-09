// Preload only for the explicitly invoked native-channel validation. All vendor
// services are mocked; actual loopback management/callback servers are used.
import assert from 'node:assert/strict';
const original = globalThis.fetch;
for (const key of ['CMDC_PAK_GOOGLE_CLIENT_ID', 'CMDC_PAK_GOOGLE_CLIENT_SECRET', 'OFM_LOOMY_WECHAT_APP_ID']) delete process.env[key];
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return original(input, options);
  if (url.href === 'https://oauth2.googleapis.com/token') {
    const body = new URLSearchParams(options.body);
    assert.ok(body.get('client_id')); assert.ok(body.get('client_secret'));
    assert.equal(body.get('code'), 'fixture-code'); assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(new URL(body.get('redirect_uri')).pathname, '/oauth-callback');
    return Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, token_type: 'Bearer' });
  }
  if (url.href === 'https://www.googleapis.com/oauth2/v2/userinfo') return Response.json({ id: 'fixture-sub', email: 'fixture@example.invalid' });
  if (url.hostname === 'open.weixin.qq.com' && url.pathname === '/connect/qrconnect') {
    assert.ok(url.searchParams.get('appid')); assert.equal(url.searchParams.get('redirect_uri'), 'https://loomy.xunfei.cn/oauth/wechat/callback');
    return new Response('<img src="/connect/qrcode/fixture-uuid">');
  }
  if (url.hostname === 'open.weixin.qq.com' && url.pathname === '/connect/qrcode/fixture-uuid') {
    const image = Buffer.alloc(220); image.set([137, 80, 78, 71]); return new Response(image);
  }
  if (url.hostname === 'long.open.weixin.qq.com') return new Response("window.wx_errcode=405;window.wx_code='fixture-wechat-code';");
  if (url.pathname === '/login/thirdAccount/bind/auth') return Response.json({ code: '000000', data: { bind: 1, rcode: 'fixture-rcode', nickname: 'Fixture WeChat' } });
  if (url.pathname === '/login/thirdAccount/bind/skip') return Response.json({ code: '000000', data: { session: 'fixture-loomy-session', userid: 'fixture-loomy-user' } });
  // No outgoing vendor network is allowed, including background quota/catalog.
  return Response.json({ error: 'fixture endpoint unavailable' }, { status: 404 });
};
