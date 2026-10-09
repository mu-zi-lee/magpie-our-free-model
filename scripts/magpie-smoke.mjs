import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { quietBrowserEnv } from './smoke-browser.mjs';

const binary = process.env.MAGPIE_BIN;
if (!binary) throw new Error('Set MAGPIE_BIN to your Magpie CLI absolute path');
const project = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const compatibility = path.join(project, 'compatibility.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-magpie-test-'));
const calls = [];
const row = { id: 'fixture/free', name: 'Fixture Free', isFree: true, context_length: 64000,
  supported_parameters: ['tools', 'reasoning'], architecture: { input_modalities: ['text', 'image'] } };
const server = createServer(async (req, res) => {
  let text = '';
  for await (const part of req) text += part;
  const body = text ? JSON.parse(text) : undefined;
  calls.push({ url: req.url, body, auth: req.headers.authorization });
  res.setHeader('content-type', 'application/json');
  if (req.url === '/catalog') {
    return res.end(JSON.stringify({ opencode: { npm: '@ai-sdk/openai-compatible', models: {
      'chat-free': { name: 'Chat Free', cost: { input: 0, output: 0 }, limit: { context: 64000, output: 8192 }, tool_call: true },
      'responses-free': { name: 'Responses Free', provider: { npm: '@ai-sdk/openai' }, cost: { input: 0, output: 0 } },
      'messages-free': { name: 'Messages Free', provider: { npm: '@ai-sdk/anthropic' }, cost: { input: 0, output: 0 } },
    } } }));
  }
  if (req.url === '/docs') return res.end('| Chat | chat-free | `https://opencode.ai/zen/v1/chat/completions` |\n| Responses | responses-free | `https://opencode.ai/zen/v1/responses` |\n| Messages | messages-free | `https://opencode.ai/zen/v1/messages` |');
  if (req.url.endsWith('/models')) {
    const data = req.url.startsWith('/zen/') ? ['chat-free', 'responses-free', 'messages-free'].map(id => ({ id }))
      : req.url.startsWith('/local/') ? [{ id: 'qoder/fixture', context_window: 64000 }] : [row];
    return res.end(JSON.stringify({ data }));
  }
  // Deliberately keep the JSON content type for SSE to test prefix detection in Bun.
  if (req.url.endsWith('/responses')) {
    const response = { id: 'r1', object: 'response', model: body.model, status: 'completed',
      output: [{ id: 'm1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] }],
      usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } };
    return res.end(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response })}\n\n`);
  }
  if (req.url.endsWith('/messages')) {
    const events = [
      ['message_start', { type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', model: body.model, content: [], usage: { input_tokens: 2, output_tokens: 0 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }],
      ['message_stop', { type: 'message_stop' }],
    ];
    return res.end(events.map(([name, value]) => `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`).join(''));
  }
  res.end(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', model: body?.model,
    choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } })}\n\ndata: [DONE]\n\n`);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const env = quietBrowserEnv(root, { ...process.env, XDG_CONFIG_HOME: path.join(root, 'config'),
  XDG_CACHE_HOME: process.env.MAGPIE_TEST_CACHE || path.join(root, 'cache'),
  MAGPIE_PLUGIN_MARKET: 'off', MAGPIE_ADDR: '127.0.0.1:3499' });
async function run(args, input = '') {
  const child = spawn(binary, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', value => { out += value; });
  child.stderr.on('data', value => { err += value; });
  child.stdin.end(input);
  const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
  const [code] = await once(child, 'exit');
  clearTimeout(timer);
  assert.equal(code, 0, `${args.join(' ')}\n${out}\n${err}`);
  return { out, err };
}
try {
  console.log((await run(['--version'])).out.trim());
  await run(['plugin', 'add', compatibility]);
  await run(['plugin', 'options', compatibility, JSON.stringify({
    managed: false,
    zen: { baseURL: `${origin}/zen/v1`, catalogURL: `${origin}/catalog`, docsURL: `${origin}/docs` },
    kilo: { baseURL: `${origin}/kilo/v1` }, local: { baseURL: `${origin}/local/v1` },
  })]);
  for (const id of ['our-free-zen', 'our-free-kilo']) {
    const login = await run(['plugin', 'login', id], 'public\n');
    assert.match(login.out, /signed in/);
  }
  const local = await run(['plugin', 'login', 'our-free-local'], `${origin}/local/v1\nfixture-local-key\n`);
  assert.match(local.out, /signed in/);
  const listing = await run(['plugin', '--json']);
  const data = JSON.parse(listing.out);
  assert.equal(data.providers.length, 3);
  assert.ok(data.providers.every(provider => provider.signedIn));
  const kiloInfo = data.providers.find(provider => provider.id === 'our-free-kilo');
  assert.deepEqual(kiloInfo.models[0].variants, ['low', 'medium', 'high', 'disabled']);
  assert.equal(kiloInfo.models[0].context, 64000);
  assert.equal(kiloInfo.models[0].image, true);
  console.log('Host listing: three signed-in providers; context, image and reasoning variants verified.');
  for (const [id, model] of [['our-free-zen', 'chat-free'], ['our-free-zen', 'responses-free'],
    ['our-free-zen', 'messages-free'], ['our-free-kilo', 'fixture/free'], ['our-free-local', 'qoder/fixture']]) {
    const result = await run(['provider', 'test', id, model]);
    console.log(`${id}/${model}: ${result.out.trim()} ${result.err.trim()}`);
    assert.match(result.out + result.err, /✓/);
  }
  assert.ok(calls.some(c => c.url === '/zen/v1/responses'));
  assert.ok(calls.some(c => c.url === '/zen/v1/messages'));
  const kilo = calls.find(c => c.url === '/kilo/v1/chat/completions');
  assert.ok(kilo);
  assert.equal(kilo.auth, undefined);
  const bridge = calls.find(c => c.url === '/local/v1/chat/completions');
  assert.ok(bridge);
  assert.equal(bridge.auth, 'Bearer fixture-local-key');
  console.log('Real Magpie/Bun host smoke passed: three providers, five model protocols, local fixture only.');
} finally {
  server.closeAllConnections();
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
}
