import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';

if (process.platform === 'win32') throw new Error('This POSIX test wrapper is verified on Linux only');
const binary = process.env.MAGPIE_BIN;
if (!binary) throw new Error('Set MAGPIE_BIN to the official CLI');
const project = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-managed-magpie-'));
const dataDir = path.join(scratch, 'data');
const calls = [];
const upstream = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  calls.push({ path: req.url, body });
  res.setHeader('content-type', 'application/json');
  if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mimo-v2.6-flash-free' }] }));
  if (req.url.endsWith('/chat/completions')) {
    res.setHeader('content-type', 'text/event-stream');
    return res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'OK' } }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1 } })}\n\ndata: [DONE]\n\n`);
  }
  res.end('{}');
});
upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
const fixture = `http://127.0.0.1:${upstream.address().port}`;
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const nodePath = path.join(scratch, 'node-fixture');
fs.writeFileSync(nodePath, `#!/bin/sh\nexec ${quote(process.execPath)} --import ${quote(path.join(project, 'tests/managed-fixture.mjs'))} "$@"\n`, { mode: 0o700 });
const env = { ...process.env, XDG_CONFIG_HOME: path.join(scratch, 'config'),
  XDG_CACHE_HOME: process.env.MAGPIE_TEST_CACHE || path.join(scratch, 'cache'),
  OFM_TEST_UPSTREAM: fixture, OUR_FREE_MODEL_BASE: fixture, OUR_FREE_MODEL_KILO_BASE: fixture,
  MAGPIE_PLUGIN_MARKET: 'off', MAGPIE_ADDR: '127.0.0.1:3498' };
async function run(args, input = '') {
  const child = spawn(binary, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', value => out += value);
  child.stderr.on('data', value => err += value);
  child.stdin.end(input);
  const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
  const [code] = await once(child, 'exit'); clearTimeout(timer);
  assert.equal(code, 0, `${args.join(' ')}\n${out}\n${err}`);
  return { out, err };
}
try {
  await run(['plugin', 'add', project]);
  await run(['plugin', 'options', project, JSON.stringify({ zen: false, kilo: false, local: false,
    managed: { dataDir, nodePath, refresh: false } })]);
  const login = await run(['plugin', 'login', 'our-free-model']);
  console.log(login.out.trim());
  const { out } = await run(['plugin', '--json']);
  const listing = JSON.parse(out);
  assert.equal(listing.providers.length, 1);
  const provider = listing.providers[0];
  assert.equal(provider.id, 'our-free-model'); assert.equal(provider.signedIn, true);
  const model = provider.models.find(model => model.id === 'mimo-v2.6-flash-free');
  assert.ok(model, JSON.stringify(provider));
  assert.equal(model.image, true);
  assert.deepEqual(model.variants, ['light', 'balanced', 'deep']);
  console.log('Real Magpie/Bun: unified provider signed in; image, context and reasoning variants mapped.');
  const inference = await run(['provider', 'test', 'our-free-model', 'mimo-v2.6-flash-free']);
  assert.match(inference.out + inference.err, /✓/);
  console.log(inference.out.trim(), inference.err.trim());
  assert.ok(calls.some(call => call.path.endsWith('/chat/completions')));
  // CLI owns a short-lived host; its child must stop after each invocation.
  const deadline = Date.now() + 7000;
  while (fs.existsSync(path.join(dataDir, 'service.lock')) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(fs.existsSync(path.join(dataDir, 'service.lock')), false);
  console.log('Child service exits with the host; no lock or background service remains.');
} finally {
  upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
  fs.rmSync(scratch, { recursive: true, force: true });
}
