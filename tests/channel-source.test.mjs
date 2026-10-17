import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { CHANNEL_FILES, CHANNEL_COMMIT, installChannelSource, channelBusinessUrl } from '../src/channel-source.mjs';

async function fixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ofm-channels-test-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const contents = Object.fromEntries(CHANNEL_FILES.map(file => [file.path, Buffer.from(`fixture ${file.path}`)]));
  const requests = [];
  const dependencies = { files: CHANNEL_FILES.map(file => ({ ...file, bytes: contents[file.path].length,
    sha256: crypto.createHash('sha256').update(contents[file.path]).digest('hex') })),
    async fetch(url, options) {
      requests.push({ url, options });
      const file = CHANNEL_FILES.find(file => url === `https://raw.githubusercontent.com/Ebony-Vinyl/dsh-our-free-model/${CHANNEL_COMMIT}/${file.path}`);
      return new Response(contents[file.path]);
    }, logger: { warn() {} } };
  return { dataDir, contents, dependencies, requests };
}

test('original channel bundle: pinned origin, unchanged complete files, private cache and offline reuse', async t => {
  const f = await fixture(t);
  const [first, second] = await Promise.all([installChannelSource(f.dataDir, f.dependencies), installChannelSource(f.dataDir, f.dependencies)]);
  assert.equal(first, second); assert.equal(f.requests.length, CHANNEL_FILES.length);
  for (const { url, options } of f.requests) {
    assert.ok(url.startsWith(`https://raw.githubusercontent.com/Ebony-Vinyl/dsh-our-free-model/${CHANNEL_COMMIT}/`));
    assert.equal(options.redirect, 'error');
  }
  for (const file of CHANNEL_FILES) assert.deepEqual(await fs.readFile(path.join(first, file.path)), f.contents[file.path]);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(first)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(first, CHANNEL_FILES[1].path))).mode & 0o777, 0o600);
  }
  const url = await channelBusinessUrl({ dataDir: f.dataDir }, { ...f.dependencies, fetch() { throw new Error('offline'); } });
  assert.ok(url.endsWith('/packages/standalone/channels/business.mjs'));
});

// The WorkBuddy INTL conversation-gate repair (issue #6 / upstream PR #377) is
// applied as a patched sibling so the download SHA-256 pin in CHANNEL_FILES
// keeps proving the pristine upstream bytes — the report's proposed approach of
// rewriting that hash would fail integrity on every fresh install.
const GATED_BUSINESS = `async send() {
    headers.set("User-Agent", resolveUserAgent(this.product, options.model));
    try {
    }
  }
  async prepareCall() {
    const messages = serializeMessages2(options.messages, imageUrls);
    if (options.system !== void 0 && options.system.length > 0) {
      messages.unshift({ role: "system", content: options.system });
    }
  }`;

test('anchor-bearing bundle: runtime loads a patched sibling and the pristine pin stays intact', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ofm-channels-gated-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const businessPath = 'packages/standalone/channels/business.mjs';
  const pristine = Buffer.from(GATED_BUSINESS);
  const contents = Object.fromEntries(CHANNEL_FILES.map(file => [file.path,
    file.path === businessPath ? pristine : Buffer.from(`fixture ${file.path}`)]));
  const dependencies = {
    files: CHANNEL_FILES.map(file => ({ ...file, bytes: contents[file.path].length,
      sha256: crypto.createHash('sha256').update(contents[file.path]).digest('hex') })),
    async fetch(url) {
      const file = CHANNEL_FILES.find(file => url === `https://raw.githubusercontent.com/Ebony-Vinyl/dsh-our-free-model/${CHANNEL_COMMIT}/${file.path}`);
      return new Response(contents[file.path]);
    },
  };
  const url = await channelBusinessUrl({ dataDir }, dependencies);
  assert.ok(url.endsWith('/packages/standalone/channels/business.workbuddy-gated.mjs'), `expected gated sibling, got ${url}`);
  const directory = path.join(dataDir, 'runtime', `channels-${CHANNEL_COMMIT}`);
  // The loaded sibling carries both gates.
  const gated = await fs.readFile(path.join(directory, 'packages/standalone/channels/business.workbuddy-gated.mjs'), 'utf8');
  assert.match(gated, /X-Conversation-ID/);
  assert.match(gated, /You are a helpful assistant\./);
  // The pinned pristine file is byte-for-byte the downloaded upstream bundle.
  assert.deepEqual(await fs.readFile(path.join(directory, businessPath)), pristine);
  // Re-invocation reuses the sibling without re-downloading or rewriting it.
  const again = await channelBusinessUrl({ dataDir }, { ...dependencies, fetch() { throw new Error('must reuse cache'); } });
  assert.equal(again, url);
});


test('channel cache corruption is repaired; wrong size/hash never produces a loadable module', async t => {
  const f = await fixture(t);
  const directory = await installChannelSource(f.dataDir, f.dependencies);
  await fs.writeFile(path.join(directory, CHANNEL_FILES[1].path), 'tampered');
  await channelBusinessUrl({ dataDir: f.dataDir }, f.dependencies);
  assert.deepEqual(await fs.readFile(path.join(directory, CHANNEL_FILES[1].path)), f.contents[CHANNEL_FILES[1].path]);
  await fs.rm(directory, { recursive: true });
  await assert.rejects(channelBusinessUrl({ dataDir: f.dataDir }, { ...f.dependencies, fetch: async () => new Response('incorrect') }), /SHA-256|大小/);
  assert.deepEqual(await fs.readdir(path.join(f.dataDir, 'runtime')), []);
});

test('channel source rejects symlinked cache parents and does not disclose download errors', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  const outside = path.join(f.dataDir, 'outside'); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(f.dataDir, 'runtime'));
  await assert.rejects(channelBusinessUrl({ dataDir: f.dataDir }, f.dependencies), /符号链接/);
  assert.deepEqual(await fs.readdir(outside), []);
  await fs.unlink(path.join(f.dataDir, 'runtime'));
  await assert.rejects(channelBusinessUrl({ dataDir: f.dataDir }, { ...f.dependencies, fetch() { throw new Error('secret-value'); } }), error => {
    assert.doesNotMatch(error.message, /secret-value/); return /下载失败/.test(error.message);
  });
});
