import test from 'node:test';
import assert from 'node:assert/strict';
import { checkpointFits } from '../vendor/ofm/src/recovery.js';

const entry = { contextWindow: 6000 };
const fits = payload => checkpointFits(payload, entry, 'reasoning', 4096);

for (const name of ['data', 'image_url']) {
  test(`continuation estimate counts the full ${name} tool-schema subtree`, () => {
    const payload = { tools: [{ type: 'function', parameters: { type: 'object', properties: {
      [name]: { type: 'string', description: 'x'.repeat(5000) },
    } } }] };
    assert.equal(fits(payload), false);
  });
}

test('ordinary data and blob URL values are counted', () => {
  assert.equal(fits({ meta: { data: 'x'.repeat(5000) } }), false);
  assert.equal(fits({ image_url: { url: 'blob:http://localhost/' + 'x'.repeat(5000) } }), false);
});

for (const [name, content] of [
  ['Chat', { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(100000) } }],
  ['Responses', { type: 'input_image', image_url: 'data:image/png;base64,' + 'A'.repeat(100000) }],
  ['Messages', { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(100000) } }],
]) {
  test(`${name} inline image bytes remain discounted`, () => {
    assert.equal(fits({ messages: [{ role: 'user', content: [content] }] }), true);
  });
}

test('budget equality and oversized checkpoints retain conservative rejection', () => {
  const payload = { text: 'hello' };
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  assert.equal(checkpointFits(payload, { contextWindow: bytes + 4096 }, '', 4096), false);
  assert.equal(checkpointFits({}, entry, 'x'.repeat(1000), 4096), false);
});

test('unknown context sizes retain the existing fallback behavior', () => {
  for (const contextWindow of [undefined, Number.NaN, Infinity, 0]) {
    assert.equal(checkpointFits({}, { contextWindow }, 'reasoning', 4096), true);
  }
});
