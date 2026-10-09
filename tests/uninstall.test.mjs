import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { registerInstallation, cleanupInstallation, validateDataDir } from '../src/installation-state.mjs';
import uninstall from '../uninstall.mjs';

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ofm-cleanup-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const directory = path.join(base, 'magpie');
  const dataDir = path.join(base, 'data');
  await registerInstallation(directory, dataDir);
  return { base, directory, dataDir };
}
async function put(root, name, content = 'fixture') {
  const file = path.join(root, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}
const exists = async file => fs.stat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });

test('uninstall removes every owned runtime, account file, temporary file and historical data directory', async t => {
  const f = await fixture(t);
  const old = path.join(f.base, 'previous-data');
  await registerInstallation(f.directory, old);
  for (const dir of [f.dataDir, old]) {
    for (const file of ['settings.json', 'stats.json', 'eac-user.json', 'gemini-oauth.json', 'loomy-wechat.json',
      'channel-credentials.json', 'settings.json.123.tmp', 'channel-pack/state.json', 'temporary/tailscale-123/socket',
      '.magpie-ofm-owner.json.ofm.123.123456abcdef.tmp',
      'runtime/node-v24.21.0-linux-x64/bin/node', 'runtime/tailscale-1.102.4-amd64/tailscale',
      'runtime/eac-f8974369c5904858c696b520d8b9b82ad4425f78/src/vault.js', 'runtime/.node-install-AbC123/node.tar.gz', 'runtime/channels-f8974369c5904858c696b520d8b9b82ad4425f78/packages/standalone/channels/business.mjs', 'runtime/.channels-install-AbC123/business.mjs']) await put(dir, file);
  }
  await put(f.directory, 'plugin-auth.json', JSON.stringify({
    'our-free-model': { key: 'managed' }, 'our-free-model#abcdef': { key: 'managed' },
    'our-free-zen': { key: 'public' }, 'our-free-kilo#abc': { key: 'public' }, 'our-free-local': { key: 'private-fixture' },
    'other-provider': { key: 'keep-fixture' }, 'our-free-model-other': { key: 'keep-too' },
  }));
  await put(f.directory, 'our-free-model-owned.json.ofm.123.123456abcdef.tmp');
  await put(f.directory, 'plugin-auth.json.ofm.123.123456abcdef.tmp');
  await uninstall({ directory: f.directory }, { managed: { dataDir: f.dataDir } });
  assert.equal(await exists(f.dataDir), false);
  assert.equal(await exists(old), false);
  assert.deepEqual(await fs.readdir(f.directory), ['plugin-auth.json']);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, 'plugin-auth.json'))), {
    'other-provider': { key: 'keep-fixture' }, 'our-free-model-other': { key: 'keep-too' },
  });
  await uninstall({ directory: f.directory }, { managed: { dataDir: f.dataDir } });
});

test('custom directory preserves unrelated files, pre-existing binaries and original EAC source', async t => {
  const f = await fixture(t);
  await put(f.dataDir, 'my-notes.txt', 'keep');
  await put(f.dataDir, 'runtime/my-system-node/bin/node', 'keep-node');
  await put(f.base, 'original-eac/src/vault.js', 'keep-source');
  await put(f.base, 'system-tailscale', 'keep-cli');
  await put(f.dataDir, 'catalog.json');
  await cleanupInstallation({ directory: f.directory }, { dataDir: f.dataDir, nodePath: path.join(f.base, 'runtime/my-system-node/bin/node'), eacSourceDir: path.join(f.base, 'original-eac') });
  assert.equal(await fs.readFile(path.join(f.dataDir, 'my-notes.txt'), 'utf8'), 'keep');
  assert.equal(await fs.readFile(path.join(f.dataDir, 'runtime/my-system-node/bin/node'), 'utf8'), 'keep-node');
  assert.equal(await exists(path.join(f.base, 'original-eac/src/vault.js')), true);
  assert.equal(await exists(path.join(f.base, 'system-tailscale')), true);
  assert.equal(await exists(path.join(f.dataDir, 'catalog.json')), false);
});

test('disabled managed mode still clears its previously registered installations', async t => {
  const f = await fixture(t);
  await put(f.dataDir, 'channel-credentials.json');
  await uninstall({ directory: f.directory }, { managed: false });
  assert.equal(await exists(f.dataDir), false);
  assert.deepEqual(await fs.readdir(f.directory), []);
});

test('uninstall rejects protected paths and substituted symlink directories', async t => {
  const f = await fixture(t);
  for (const dir of [path.parse(f.dataDir).root, os.homedir(), f.directory, path.dirname(f.directory)]) {
    assert.throws(() => validateDataDir(dir, f.directory), /专用/);
  }
  await put(f.dataDir, 'stats.json', 'keep-data');
  const moved = path.join(f.base, 'moved');
  await fs.rename(f.dataDir, moved);
  await fs.symlink(moved, f.dataDir, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(cleanupInstallation({ directory: f.directory }, { dataDir: f.dataDir }), /链接/);
  assert.equal(await fs.readFile(path.join(moved, 'stats.json'), 'utf8'), 'keep-data');
});

test('uninstall waits for the service to stop before deleting credentials', async t => {
  const f = await fixture(t);
  await put(f.dataDir, 'channel-credentials.json');
  await put(f.dataDir, 'service.lock', JSON.stringify({ product: 'our-free-model-standalone', pid: process.pid }));
  const promise = cleanupInstallation({ directory: f.directory }, { dataDir: f.dataDir });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await exists(path.join(f.dataDir, 'channel-credentials.json')), true);
  await fs.rm(path.join(f.dataDir, 'service.lock'));
  await promise;
  assert.equal(await exists(f.dataDir), false);
});

test('unreadable auth or unknown service lock preserves data and cleanup registration', async t => {
  const f = await fixture(t);
  await put(f.dataDir, 'channel-credentials.json', 'keep-data');
  await put(f.directory, 'plugin-auth.json', '{broken');
  await assert.rejects(cleanupInstallation({ directory: f.directory }, { dataDir: f.dataDir }), /无法读取/);
  await fs.rm(path.join(f.directory, 'plugin-auth.json'));
  await put(f.dataDir, 'service.lock', JSON.stringify({ product: 'another-product', pid: process.pid }));
  await assert.rejects(cleanupInstallation({ directory: f.directory }, { dataDir: f.dataDir }), /归属/);
  assert.equal(await fs.readFile(path.join(f.dataDir, 'channel-credentials.json'), 'utf8'), 'keep-data');
  assert.equal(await exists(path.join(f.directory, 'our-free-model-owned.json')), true);
});

test('pre-0.6 OFM settings can be adopted for cleanup without starting services', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ofm-legacy-cleanup-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const directory = path.join(base, 'magpie');
  const dataDir = path.join(directory, 'our-free-model');
  await put(dataDir, 'settings.json', JSON.stringify({ forwardKey: 'fixture-local-key', standalonePort: 18900 }));
  await put(dataDir, 'runtime/node-v24.21.0-linux-x64/bin/node');
  await uninstall({ directory });
  assert.equal(await exists(dataDir), false);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('an interrupted cleanup journal finishes safely after its ownership marker was removed', async t => {
  const f = await fixture(t);
  await put(f.dataDir, 'my-notes.txt', 'keep');
  const file = path.join(f.directory, 'our-free-model-owned.json');
  const state = JSON.parse(await fs.readFile(file));
  state.roots[0].cleaned = true;
  await fs.writeFile(file, JSON.stringify(state));
  await fs.rm(path.join(f.dataDir, '.magpie-ofm-owner.json'));
  await uninstall({ directory: f.directory }, { managed: { dataDir: f.dataDir } });
  assert.equal(await fs.readFile(path.join(f.dataDir, 'my-notes.txt'), 'utf8'), 'keep');
  assert.equal(await exists(file), false);
});

test('restarting after partial cleanup registers new files for the next uninstall attempt', async t => {
  const f = await fixture(t);
  const file = path.join(f.directory, 'our-free-model-owned.json');
  const state = JSON.parse(await fs.readFile(file));
  state.roots[0].cleaned = true;
  await fs.writeFile(file, JSON.stringify(state));
  await fs.rm(path.join(f.dataDir, '.magpie-ofm-owner.json'));
  await registerInstallation(f.directory, f.dataDir);
  await put(f.dataDir, 'catalog.json');
  await uninstall({ directory: f.directory }, { managed: { dataDir: f.dataDir } });
  assert.equal(await exists(f.dataDir), false);
});

test('cleanup recovers an expired empty Magpie auth lock and preserves other accounts', async t => {
  const f = await fixture(t);
  await put(f.directory, 'plugin-auth.json', JSON.stringify({ 'our-free-model': {}, other: { key: 'keep' } }));
  const lock = path.join(f.directory, 'plugin-auth.json.lock');
  await fs.writeFile(lock, '');
  const old = new Date(Date.now() - 30000);
  await fs.utimes(lock, old, old);
  await uninstall({ directory: f.directory }, { managed: { dataDir: f.dataDir } });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, 'plugin-auth.json'))), { other: { key: 'keep' } });
  assert.equal(await exists(lock), false);
});
