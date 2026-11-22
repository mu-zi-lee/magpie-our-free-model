import test from 'node:test';
import assert from 'node:assert/strict';
import { startForwardServer } from '../vendor/ofm/src/forward.js';

async function run(t, chunks, calls, tools = []) {
  const service = await startForwardServer({
    config: () => ({ host: '127.0.0.1', port: 0, enabled: true, key: 'fixture-key' }),
    modelRows: () => [],
    complete: async (_request, emit) => {
      for (const chunk of chunks) emit(chunk);
      return { text: 'preamble', toolCalls: calls };
    },
  });
  t.after(() => service.close());
  const response = await fetch(`http://127.0.0.1:${service.port}/v1/chat/completions`, {
    method: 'POST', headers: { authorization: 'Bearer fixture-key', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'fixture', stream: true, messages: [], tools }),
  });
  const text = await response.text();
  const events = text.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
  return { text, frames: events.flatMap(e => e.choices?.[0]?.delta?.tool_calls ?? []) };
}

const call = { id: 'call_fixture', name: 'lookup', arguments: '{"x":1}' };
const block = (index, value = call) => ({ type: 'block-end', index, block: { type: 'tool-call', ...value } });

test('block-only tool calls emit complete frames at sequential indices', async t => {
  const { text, frames } = await run(t, [block(5), block(8, { ...call, id: 'call_second' })], [call, call]);
  assert.deepEqual(frames.filter(f => f.id).map(f => f.index), [0, 1]);
  assert.equal(frames.map(f => f.function.arguments).join(''), call.arguments.repeat(2));
  assert.match(text, /"finish_reason":"tool_calls"/);
});

test('completed blocks never duplicate streamed identity or arguments', async t => {
  const { frames } = await run(t, [
    { type: 'tool-call-delta', index: 2, ...call, argumentsDelta: '{"x":' },
    { type: 'tool-call-delta', index: 2, argumentsDelta: '1}' }, block(2), block(2),
  ], [call]);
  assert.equal(frames.filter(f => f.id).length, 1);
  assert.equal(frames.map(f => f.function.arguments).join(''), call.arguments);
});

test('arguments held before the block name are emitted once, from the complete block', async t => {
  const { frames } = await run(t, [
    { type: 'tool-call-delta', index: 1, argumentsDelta: '{"x":' }, block(1),
  ], [call]);
  assert.equal(frames.map(f => f.function.arguments).join(''), call.arguments);
});

test('undeclared fingerprint tools stay suppressed at block end', async t => {
  const decoy = { ...call, name: 'bash' };
  const { frames } = await run(t, [block(0, decoy)], [decoy]);
  assert.deepEqual(frames, []);
});

test('declared fingerprint tools can still execute', async t => {
  const declared = { ...call, name: 'bash' };
  const { frames } = await run(t, [block(0, declared)], [declared], [{ type: 'function', function: { name: 'bash', parameters: {} } }]);
  assert.equal(frames[0].function.name, 'bash');
});

test('a rejected decoy slot cannot reopen with a different name', async t => {
  const { frames } = await run(t, [
    { type: 'tool-call-delta', index: 0, name: 'bash', argumentsDelta: '{' }, block(0),
  ], [call]);
  assert.deepEqual(frames, []);
});

test('block-end retains an identity received before the name', async t => {
  const { frames } = await run(t, [
    { type: 'tool-call-delta', index: 0, id: call.id }, block(0, { ...call, id: undefined }),
  ], [call]);
  assert.equal(frames[0].id, call.id);
});
