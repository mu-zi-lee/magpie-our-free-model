import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import * as entry from '../index.mjs';
import { buildKiloModels } from '../src/kilo.mjs';

const auth = { type: 'api', key: 'public' };
const rows = [
  { id: 'vendor/free', name: 'Free Model', isFree: true, context_length: 64000,
    top_provider: { max_completion_tokens: 8192 }, supported_parameters: ['tools', 'reasoning', 'temperature'],
    architecture: { input_modalities: ['text', 'image'] } },
  { id: 'vendor/paid', isFree: false },
  { id: 'stepfun/free', isFree: true, supported_parameters: ['reasoning'] },
  { id: 'kilo-auto/free', isFree: true, supported_parameters: ['reasoning'] },
  { id: '__proto__', isFree: true },
];
const chat = text => ({ id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
const sse = value => `data: ${JSON.stringify(value)}\n\ndata: [DONE]\n\n`;

async function fixture(t) {
  const state = { calls: [], rows, status: 200, listingStatus: 200, header: 'text/event-stream' };
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    state.calls.push({ url: req.url, headers: req.headers, body: text ? JSON.parse(text) : undefined });
    if (req.url === '/v1/models') {
      if (state.hangListing) { state.onListing?.(); return; }
      res.writeHead(state.listingStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: state.rows }));
    } else if (state.hang) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': heartbeat\n\n');
    } else if (state.status !== 200) {
      res.writeHead(state.status, { 'content-type': 'application/json', 'retry-after': '30' });
      res.end('{"error":{"message":"limited"}}');
    } else {
      res.writeHead(200, { 'content-type': state.header });
      res.end(state.reply ?? sse(chat('你好')));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const plugin = await entry.KiloFreePlugin({}, { kilo: { baseURL: base } });
  const provider = { models: {} };
  provider.models = await plugin.provider.models(provider, { auth });
  const loader = await plugin.auth.loader(async () => auth, provider);
  return { state, base, plugin, provider, loader };
}

function request(loader, base, body = {}, signal) {
  return loader.fetch(`${base}/chat/completions`, { method: 'POST', signal,
    headers: { authorization: 'Bearer client-secret', cookie: 'private', 'x-api-key': 'client-key' },
    body: JSON.stringify({ model: 'vendor/free', messages: [{ role: 'user', content: 'hello' }], stream: true, ...body }) });
}

test('entry exports exactly three provider functions and disabling each makes no network calls', async () => {
  assert.deepEqual(Object.keys(entry).sort(), ['KiloFreePlugin', 'LocalGatewayPlugin', 'ZenFreePlugin']);
  for (const [name, option] of [['ZenFreePlugin', 'zen'], ['KiloFreePlugin', 'kilo'], ['LocalGatewayPlugin', 'local']]) {
    assert.deepEqual(await entry[name]({}, { [option]: false }), {});
  }
});

test('Kilo lists only explicit free models and maps capabilities and reasoning restrictions', () => {
  const models = buildKiloModels(rows, 'https://example.com/v1');
  assert.deepEqual(Object.keys(models), ['vendor/free', 'stepfun/free', 'kilo-auto/free']);
  assert.equal(models['vendor/free'].capabilities.input.image, true);
  assert.equal(models['vendor/free'].capabilities.toolcall, true);
  assert.equal(models['vendor/free'].limit.context, 64000);
  assert.equal(models['vendor/free'].variants.disabled.reasoningEffort, 'disabled');
  assert.equal(models['stepfun/free'].variants.disabled, undefined);
  assert.equal(models['kilo-auto/free'].variants.disabled, undefined);
});

test('Kilo registers without overwriting config and activates without a personal key', async t => {
  const { plugin } = await fixture(t);
  const cfg = {};
  await plugin.config(cfg);
  assert.equal(cfg.provider['our-free-kilo'].npm, '@ai-sdk/openai-compatible');
  const own = { custom: true };
  cfg.provider['our-free-kilo'] = own;
  await plugin.config(cfg);
  assert.equal(cfg.provider['our-free-kilo'], own);
  assert.deepEqual(await plugin.auth.methods[0].authorize(), { type: 'success', key: 'public' });
  assert.deepEqual(await plugin.auth.loader(async () => null), {});
});

for (const mislabeled of [false, true]) test(`Kilo preserves streaming, Unicode, tools and usage; mislabeled=${mislabeled}`, async t => {
  const { state, base, loader } = await fixture(t);
  if (mislabeled) state.header = 'application/json';
  const tools = [{ type: 'function', function: { name: 'Read', parameters: { type: 'object', properties: {} } } }];
  const response = await request(loader, base, { tools });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const text = await response.text();
  assert.match(text, /你好/);
  assert.match(text, /prompt_tokens/);
  const call = state.calls.at(-1);
  assert.deepEqual(call.body.tools, tools);
  assert.equal(call.headers.authorization, undefined);
  assert.equal(call.headers.cookie, undefined);
  assert.equal(call.headers['x-api-key'], undefined);
});

test('Kilo collapses SSE for JSON callers and preserves reasoning fields', async t => {
  const { state, base, loader } = await fixture(t);
  state.reply = sse({ ...chat('ok'), choices: [{ index: 0, delta: { content: 'ok', reasoning_content: 'think' }, finish_reason: 'stop' }] });
  const response = await request(loader, base, { stream: false });
  const body = await response.json();
  assert.equal(body.choices[0].message.content, 'ok');
  assert.equal(body.choices[0].message.reasoning_content, 'think');
  assert.equal(body.usage.total_tokens, 5);
  assert.equal(state.calls.at(-1).body.stream, true);
});

test('Kilo accepts ordinary JSON when upstream ignores streaming', async t => {
  const { state, base, loader } = await fixture(t);
  state.header = 'text/event-stream';
  state.reply = JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'json' }, finish_reason: 'stop' }] });
  const response = await request(loader, base, { stream: false });
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal((await response.json()).choices[0].message.content, 'json');
});

test('Kilo maps effort to unified reasoning, refuses unsupported off and preserves caller reasoning', async t => {
  const { state, base, loader } = await fixture(t);
  await (await request(loader, base, { reasoning_effort: 'low', reasoning: { exclude: false } })).text();
  assert.deepEqual(state.calls.at(-1).body.reasoning, { exclude: false, enabled: true, effort: 'low' });
  assert.equal(state.calls.at(-1).body.reasoning_effort, undefined);
  await (await request(loader, base, { reasoning_effort: 'disabled' })).text();
  assert.equal(state.calls.at(-1).body.reasoning.enabled, false);
  await assert.rejects(request(loader, base, { model: 'stepfun/free', reasoning_effort: 'disabled' }), /Unsupported reasoning/);
});

test('Kilo rejects paid models and foreign endpoints before inference', async t => {
  const { state, base, loader } = await fixture(t);
  await assert.rejects(request(loader, base, { model: 'vendor/paid' }), /free pool/);
  assert.equal(state.calls.filter(c => c.url.includes('completions')).length, 0);
  await assert.rejects(loader.fetch('https://example.com/steal', { method: 'POST', body: '{}' }), /endpoint/);
});

test('Kilo cached models survive listing failure but a successful empty list removes them', async t => {
  const { state, plugin, provider } = await fixture(t);
  state.listingStatus = 503;
  const cached = await plugin.provider.models(provider, { auth });
  assert.equal(cached[Symbol.for('magpie.fellBack')], true);
  assert.ok(cached['vendor/free']);
  state.listingStatus = 200; state.rows = [];
  assert.deepEqual(await plugin.provider.models(provider, { auth }), {});
});

test('Kilo forwards rate-limit metadata and does not mark public activation expired on 401', async t => {
  const { state, base, loader } = await fixture(t);
  state.status = 429;
  const limited = await request(loader, base);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '30');
  await limited.text();
  state.status = 401;
  const denied = await request(loader, base);
  assert.equal(denied.headers.get('X-Magpie-Sign-In'), 'kept');
  await denied.text();
});

test('Kilo refuses upstream tool calls the client did not declare', async t => {
  const { state, base, loader } = await fixture(t);
  state.reply = JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'unknown', arguments: '{}' } }] } }] });
  state.header = 'application/json';
  const response = await request(loader, base);
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /"name":"unknown"/);
});

test('Kilo forwards caller cancellation during a streamed reply', async t => {
  const { state, base, loader } = await fixture(t);
  state.hang = true;
  const controller = new AbortController();
  const response = await request(loader, base, {}, controller.signal);
  const reading = response.text();
  controller.abort();
  await assert.rejects(reading);
});

test('Kilo cancellation interrupts unknown-model discovery', async t => {
  const { state, base, loader } = await fixture(t);
  state.hangListing = true;
  const controller = new AbortController();
  const begun = new Promise(resolve => { state.onListing = resolve; });
  const pending = request(loader, base, { model: 'new/free' }, controller.signal);
  await begun;
  controller.abort();
  await assert.rejects(pending);
});

test('Local gateway discovers account models and substitutes only its own API key', async t => {
  const { state, base } = await fixture(t);
  state.rows = [{ id: 'qoder/code-model', context_window: 128000 }];
  const plugin = await entry.LocalGatewayPlugin({}, { local: { baseURL: base } });
  const account = { type: 'api', key: 'local-service-key', metadata: { baseURL: base } };
  const provider = { models: await plugin.provider.models({ models: {} }, { auth: account }) };
  assert.equal(provider.models['qoder/code-model'].limit.context, 128000);
  assert.equal(state.calls.at(-1).headers.authorization, 'Bearer local-service-key');
  const loader = await plugin.auth.loader(async () => account, provider);
  await (await request(loader, base, { model: 'qoder/code-model' })).text();
  assert.equal(state.calls.at(-1).headers.authorization, 'Bearer local-service-key');
  assert.equal(state.calls.at(-1).headers.cookie, undefined);
});

test('Local gateway keeps account catalogs separate and reports expired local keys', async t => {
  const { state, base } = await fixture(t);
  const plugin = await entry.LocalGatewayPlugin({}, { local: { baseURL: base } });
  const a = { type: 'api', key: 'a' }; const b = { type: 'api', key: 'b' };
  state.rows = [{ id: 'first/model' }];
  const first = await plugin.provider.models({ models: {} }, { auth: a });
  state.rows = [{ id: 'second/model' }];
  await plugin.provider.models({ models: {} }, { auth: b });
  state.listingStatus = 503;
  const cached = await plugin.provider.models({ models: {} }, { auth: a });
  assert.deepEqual(Object.keys(cached), Object.keys(first));
  state.listingStatus = 401;
  await assert.rejects(plugin.provider.models({ models: {} }, { auth: a }), { signIn: 'expired' });
});

test('Local gateway rejects remote endpoints and malformed base URLs', async () => {
  for (const value of ['https://example.com/v1', 'http://127.0.0.1:18900/v1?key=secret', 'http://user:pass@127.0.0.1/v1', 'file:///tmp/v1']) {
    await assert.rejects(entry.LocalGatewayPlugin({}, { local: { baseURL: value } }));
  }
});
