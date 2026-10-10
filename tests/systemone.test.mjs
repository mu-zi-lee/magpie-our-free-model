// The decision models (Jev) are part of the provider the plugin already
// serves, not a second one: magpie asks them through this plugin's own
// fetch, at the provider's base /systemone, and this plugin forwards that
// to Zen unchanged. These check the route test and the forward, which is
// what that path is; the whole path is proven against a real magpie.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createManagedPlugin } from '../src/managed.mjs';
import { isSystemOne, forwardSystemOne } from '../src/systemone.mjs';

test('a system one path is the provider route, not its chat one', () => {
  // magpie posts at <base>/systemone, and its own gateway serves
  // /v1/systemone too, so both spellings land here
  assert.equal(isSystemOne('/v1/systemone'), true);
  assert.equal(isSystemOne('/systemone'), true);
  assert.equal(isSystemOne('/v1/systemone/'), true);
  // the provider's other route must never be taken for it
  assert.equal(isSystemOne('/v1/chat/completions'), false);
  assert.equal(isSystemOne('/v1/models'), false);
  assert.equal(isSystemOne('/systemones'), false);
  assert.equal(isSystemOne('/'), false);
});

test('a question is forwarded to Zen and its answer comes back whole', async () => {
  const answer = { model: 'jev-1.13-free', answers: { task: { type: 'choice', choice: 'code', confidence: 0.93 } } };
  const seen = [];
  const question = { model: 'jev-1.13-free', state: 'give users.email an index', questions: { task: { type: 'choice' } } };
  const res = await forwardSystemOne({ signal: undefined }, JSON.stringify(question), {
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(seen.length, 1);
  // Zen's decision route, with the free pool's own anonymous credential
  assert.equal(seen[0].url, 'https://opencode.ai/zen/v1/systemone');
  assert.equal(seen[0].init.method, 'POST');
  assert.deepEqual(seen[0].init.headers, { 'content-type': 'application/json', authorization: 'Bearer public', 'x-opencode-client': 'cli' });
  assert.deepEqual(JSON.parse(seen[0].init.body), question);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.deepEqual(await res.json(), answer);
});

test('the vendor boundary is kept: its status and error are passed through', async () => {
  const failure = { error: { message: 'FreeTierError', type: 'invalid_request_error' } };
  const res = await forwardSystemOne({ signal: undefined }, '{}', {
    fetchImpl: async () => new Response(JSON.stringify(failure), { status: 403, headers: { 'content-type': 'application/json' } }),
  });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), failure);
});

test('the provider declares the decision API it serves', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-decide-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const plugin = await createManagedPlugin({ directory: dir }, { dataDir: path.join(dir, 'data') });
  const cfg = { provider: {} };
  await plugin.config(cfg);
  // This is what magpie reads: without it, the decision models would have
  // to be registered as a provider of their own
  assert.equal(cfg.provider['our-free-model'].decide, true);
});
