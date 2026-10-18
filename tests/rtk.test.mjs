import assert from 'node:assert/strict';
import test from 'node:test';
import { compressRequest } from '../vendor/ofm/src/token-saver/rtk/index.js';
import { DETECT_WINDOW } from '../vendor/ofm/src/token-saver/rtk/constants.js';

const wires = {
  chat: text => ({ messages: [{ role: 'tool', tool_call_id: 'fixture', content: text }] }),
  messages: text => ({ messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'fixture', content: text }] }] }),
  responses: text => ({ input: [{ type: 'function_call_output', call_id: 'fixture', output: text }] }),
};

function compress(text, wire) {
  const payload = wires[wire](text);
  const { stats } = compressRequest(payload, wire);
  const output = wire === 'chat' ? payload.messages[0].content
    : wire === 'messages' ? payload.messages[0].content[0].content : payload.input[0].output;
  return { output, stats };
}

for (const wire of Object.keys(wires)) {
  test(`RTK ${wire}: timestamps, citations and prose after the sampling window remain intact`, () => {
    const prose = 'Important webpage content must remain visible to the model. '.repeat(24);
    for (const text of [
      ['title: Python.org', 'Python.org:2026: a source timestamp', prose].join('\n'),
      ['api.example.com:8080: listening', prose].join('\n'),
      ['src/main.js:12: example()', ...Array(12).fill(prose)].join('\n'),
      ['src/main.js:12: ' + 'x'.repeat(DETECT_WINDOW + 10), prose].join('\n'),
      ['src/main.js:12: match', '--', prose].join('\n'),
    ]) {
      const { output, stats } = compress(text, wire);
      assert.equal(output, text);
      assert.equal(stats.saved, 0);
    }
  });

  test(`RTK ${wire}: genuine search output retains Windows paths and mixed filenames`, () => {
    const files = ['src/a.js', 'src/my file.js', 'README', 'C:\\project folder\\b.js', 'C:/project folder/c.js'];
    const text = files.flatMap(file => Array.from({ length: 6 }, (_, i) =>
      `${file}:${i + 1}: UNIQUE_${i} ${'search result content '.repeat(8)}`)).join('\r\n');
    const { output, stats } = compress(text, wire);
    assert.ok(stats.saved > 0);
    assert.ok(output.startsWith('30 matches in 5F:'));
    for (const file of files) assert.ok(output.includes(`[file] ${file} (6):`), file);
    for (let i = 0; i < 6; i++) assert.equal(output.split(`UNIQUE_${i}`).length - 1, 5);
  });

  test(`RTK ${wire}: a sixth-row filename cannot trigger lossy search detection`, () => {
    const text = [...Array(5).fill('README'), 'src/a.js'].map(file =>
      `${file}:12: ${'search content '.repeat(20)}`).join('\r\n \t\r\n');
    assert.equal(compress(text, wire).output, text);
  });
}
