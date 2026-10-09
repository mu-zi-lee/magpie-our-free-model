import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { installEacSource, loadEacSource, EAC_COMMIT, EAC_FILES } from '../src/eac-source.mjs';
import { createStandaloneEac } from '../vendor/ofm/packages/standalone/eac.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ofm-eac-test-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const contents = {
    'src/vault.js': `import { value } from './vault-data.js'; export function openSeal() { return { mode: 'worker', base: 'https://fixture.invalid/v1', signingSecret: value }; }`,
    'src/vault-data.js': `export const value = 'fixture-signing-value-for-tests-only';`,
    'src/vault-anchor.js': '// fixture anchor', LICENSE: 'fixture license',
  };
  const requests = [];
  const dependencies = { files: EAC_FILES.map(file => ({ path: file.path, sha256: sha(contents[file.path]) })),
    async fetch(url, options) {
      requests.push({ url, options });
      const file = EAC_FILES.find(file => url.endsWith('/' + file.path));
      return new Response(contents[file.path]);
    } };
  return { dataDir, dependencies, requests, contents };
}

test('automatic EAC source: pinned official origin, all hashes, private cache and offline reuse', async t => {
  const f = await fixture(t);
  const loaded = await loadEacSource({ dataDir: f.dataDir }, f.dependencies);
  assert.deepEqual(loaded.setup, { state: 'ready', source: 'download', commit: EAC_COMMIT });
  assert.equal(loaded.credentialOf().mode, 'worker');
  assert.equal(f.requests.length, EAC_FILES.length);
  for (const request of f.requests) {
    assert.ok(request.url.startsWith(`https://raw.githubusercontent.com/Ebony-Vinyl/dsh-our-free-model/${EAC_COMMIT}/`));
    assert.equal(request.options.redirect, 'error');
    assert.ok(request.options.signal instanceof AbortSignal);
  }
  const directory = await installEacSource(f.dataDir, f.dependencies);
  assert.equal(await fs.readFile(path.join(directory, 'LICENSE'), 'utf8'), f.contents.LICENSE);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(directory, 'src/vault-data.js'))).mode & 0o777, 0o600);
  }
  const offline = await loadEacSource({ dataDir: f.dataDir }, { ...f.dependencies, fetch() { throw new Error('offline'); } });
  assert.equal(offline.setup.state, 'ready');
});

test('corrupted dependency is repaired before any automatic module is imported', async t => {
  const f = await fixture(t);
  const directory = await installEacSource(f.dataDir, f.dependencies);
  await fs.writeFile(path.join(directory, 'src/vault-anchor.js'), 'tampered');
  let imports = 0;
  const loaded = await loadEacSource({ dataDir: f.dataDir }, { ...f.dependencies, async importModule() {
    imports++;
    assert.equal(await fs.readFile(path.join(directory, 'src/vault-anchor.js'), 'utf8'), f.contents['src/vault-anchor.js']);
    return { openSeal: () => ({ mode: 'worker', base: 'https://fixture.invalid/v1', signingSecret: 'fixture-signing-value-for-tests-only' }) };
  } });
  assert.equal(loaded.setup.state, 'ready');
  assert.equal(imports, 1);
  assert.equal(f.requests.length, EAC_FILES.length * 2);
});

test('bad downloads never execute modules, clean staging and keep EAC optional', async t => {
  const f = await fixture(t);
  let imports = 0;
  const loaded = await loadEacSource({ dataDir: f.dataDir }, { ...f.dependencies,
    fetch: async () => new Response('bad hash'), importModule() { imports++; } });
  assert.equal(loaded.setup.state, 'failed');
  assert.match(loaded.setup.message, /SHA-256/);
  assert.equal(loaded.credentialOf(), null);
  assert.equal(imports, 0);
  assert.deepEqual(await fs.readdir(path.join(f.dataDir, 'runtime')), []);
  const eac = createStandaloneEac({ dataDir: f.dataDir, credentialOf: loaded.credentialOf, setup: loaded.setup });
  t.after(() => eac.dispose());
  const status = await eac.status();
  assert.equal(status.available, false);
  assert.match(status.setup.message, /SHA-256/);
});

test('oversized or redirected EAC downloads are rejected without publishing a cache', async t => {
  for (const fetch of [async () => new Response('x'.repeat(32769)), async () => { throw new Error('redirect containing secret'); }]) {
    const f = await fixture(t);
    const loaded = await loadEacSource({ dataDir: f.dataDir }, { ...f.dependencies, fetch });
    assert.equal(loaded.setup.state, 'failed');
    assert.doesNotMatch(loaded.setup.message, /containing secret/);
    assert.deepEqual(await fs.readdir(path.join(f.dataDir, 'runtime')), []);
  }
});

test('concurrent EAC installs share one atomic download', async t => {
  const f = await fixture(t);
  const directories = await Promise.all(Array.from({ length: 4 }, () => installEacSource(f.dataDir, f.dependencies)));
  assert.equal(new Set(directories).size, 1);
  assert.equal(f.requests.length, EAC_FILES.length);
  assert.equal((await fs.readdir(path.join(f.dataDir, 'runtime'))).length, 1);
});

test('automatic install can be disabled; an explicit local source takes precedence', async t => {
  const f = await fixture(t);
  const disabled = await loadEacSource({ dataDir: f.dataDir, autoInstallEac: false }, f.dependencies);
  assert.equal(disabled.setup.state, 'disabled');
  assert.equal(disabled.credentialOf(), null);
  assert.equal(f.requests.length, 0);
  const eacSourceDir = await installEacSource(f.dataDir, f.dependencies);
  f.requests.length = 0;
  const local = await loadEacSource({ dataDir: f.dataDir, eacSourceDir, autoInstallEac: false }, f.dependencies);
  assert.equal(local.setup.source, 'local');
  assert.equal(local.setup.state, 'ready');
  assert.equal(f.requests.length, 0);
});

test('untrusted local module errors cannot leak into console diagnostics', async t => {
  const f = await fixture(t);
  const loaded = await loadEacSource({ dataDir: f.dataDir, eacSourceDir: f.dataDir }, { importModule() {
    throw Object.assign(new Error('private-api-key-from-module'), { code: 'integrity' });
  } });
  assert.equal(loaded.setup.state, 'failed');
  assert.doesNotMatch(JSON.stringify(loaded.setup), /private-api-key/);
  assert.equal(loaded.credentialOf(), null);
});

test('installed source does not authorize a user or fetch EAC models before login', async t => {
  const f = await fixture(t);
  const loaded = await loadEacSource({ dataDir: f.dataDir }, f.dependencies);
  const eac = createStandaloneEac({ dataDir: f.dataDir, credentialOf: loaded.credentialOf, setup: loaded.setup,
    fetch: async () => new Response(JSON.stringify({ required: true, configured: true, authorized: false, repo: 'Ebony-Vinyl/dsh-our-free-model' })) });
  t.after(() => eac.dispose());
  assert.equal(eac.credential(), null);
  const status = await eac.status();
  assert.equal(status.available, true);
  assert.equal(status.authorized, false);
  assert.equal(status.setup.state, 'ready');
  assert.doesNotMatch(JSON.stringify(status), /signingSecret|fixture-signing/);
});
