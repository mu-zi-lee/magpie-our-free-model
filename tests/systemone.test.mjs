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
import { isSystemOne, forwardSystemOne, serveSystemOne } from '../src/systemone.mjs';

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

// The route serves this provider's decision models alone, and they are
// admitted exactly as a chat request's model is: a model that never existed,
// was switched off in the console, or does not answer System One must be
// refused here, not forwarded for Zen to refuse. This is the check the chat
// route already had and the decision branch did not.
test('a system one request is admitted before it is forwarded', async () => {
  const sent = [];
  const admitted = new Set(['jev-1.13-free']);
  // The vendor transport, stubbed at the same seam the forward itself uses
  // (fetch): it answers what Zen would and remembers what left the plugin.
  const fetchImpl = async (url, init) => {
    sent.push({ url, body: init.body });
    return Response.json({ model: 'jev-1.13-free', answers: {} });
  };
  const serve = (body, { admit = model => Promise.resolve(admitted.has(model)) } = {}) => {
    const request = new Request('http://127.0.0.1/v1/systemone', { method: 'POST', body });
    return serveSystemOne(request, body, { admit, fetchImpl });
  };

  // the one this provider serves and the service admits: forwarded unchanged
  const question = JSON.stringify({ model: 'jev-1.13-free', state: { text: 'ping' }, questions: {} });
  const answer = await serve(question);
  assert.equal(answer.status, 200);
  assert.deepEqual(sent, [{ url: 'https://opencode.ai/zen/v1/systemone', body: question }]);

  // one that never existed, one switched off (admit says no), and a chat
  // model of the same provider: all refused, nothing forwarded
  for (const model of ['jev-9.9-free', 'mimo-v2.6-flash-free']) {
    const refused = await serve(JSON.stringify({ model, state: { text: 'ping' }, questions: {} }));
    assert.equal(refused.status, 404);
    assert.equal((await refused.json()).error.type, 'invalid_request_error');
  }
  assert.deepEqual(sent.map(entry => entry.body), [question]);

  // a chat model of this provider is no decision model even where the
  // service's catalog would admit the id
  const chatModel = await serve(JSON.stringify({ model: 'mimo-v2.6-flash-free', questions: {} }),
    { admit: () => Promise.resolve(true) });
  assert.equal(chatModel.status, 404);
  assert.deepEqual(sent.map(entry => entry.body), [question]);

  // a body that is no System One request names no model to admit
  for (const body of ['not json', '[]', 'null', JSON.stringify({ questions: {} }), JSON.stringify({ model: '__proto__' })]) {
    const refused = await serve(body, { admit: () => Promise.resolve(true) });
    assert.equal(refused.status, 404, body);
  }
  assert.deepEqual(sent.map(entry => entry.body), [question]);
});

// The admission call is the request's own: a caller who gives up while the
// service is being asked must not have the question forwarded anyway.
test('an aborted system one request is not forwarded', async () => {
  const controller = new AbortController();
  const request = new Request('http://127.0.0.1/v1/systemone', { method: 'POST', signal: controller.signal,
    body: JSON.stringify({ model: 'jev-1.13-free', questions: {} }) });
  controller.abort();
  const sent = [];
  await assert.rejects(serveSystemOne(request, JSON.stringify({ model: 'jev-1.13-free', questions: {} }), {
    admit: model => Promise.resolve(model === 'jev-1.13-free'),
    fetchImpl: async () => { sent.push('must not run'); return Response.json({}); },
  }));
  assert.deepEqual(sent, []);
});
