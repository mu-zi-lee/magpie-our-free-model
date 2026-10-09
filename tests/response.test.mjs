import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeResponse } from '../src/response.mjs';

function fragmented(parts, onCancel = () => {}) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index === parts.length) controller.close();
      else controller.enqueue(new TextEncoder().encode(parts[index++]));
    },
    cancel: onCancel,
  }, { highWaterMark: 0 });
}

test('prefix detection handles fragmented SSE names and replays UTF-8 and BOM without loss', async () => {
  const parts = ['\uFEFF ', 'd', 'at', 'a:', ' {"text":"你好"}\n\n'];
  const response = await normalizeResponse(new Response(fragmented(parts), { headers: { 'content-type': 'application/json', 'content-length': '12' } }));
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('content-length'), null);
  // Response.text() strips a UTF-8 BOM by platform convention.
  assert.equal(await response.text(), parts.join('').replace(/^\uFEFF/, ''));
});

test('prefix detection corrects JSON wrongly marked SSE', async () => {
  const response = await normalizeResponse(new Response(fragmented(['  ', '{"ok":true}']), { headers: { 'content-type': 'text/event-stream' } }));
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.deepEqual(await response.json(), { ok: true });
});

test('replayed stream cancellation reaches the upstream source', async () => {
  let cancelled = false;
  const response = await normalizeResponse(new Response(fragmented(['data: ', 'next'], () => { cancelled = true; })));
  await response.body.cancel();
  assert.equal(cancelled, true);
});

test('HTTP errors pass through unchanged and unread', async () => {
  const original = new Response('{"error":"limited"}', { status: 429 });
  assert.equal(await normalizeResponse(original), original);
  assert.equal(original.bodyUsed, false);
});
