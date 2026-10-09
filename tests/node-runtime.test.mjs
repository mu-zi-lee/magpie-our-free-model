import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NODE_VERSION, nodeRelease, installNode, resolveNodeRuntime, probeNode } from '../src/node-runtime.mjs';
import { removeEmbeddedWechatDefault, removeEmbeddedOAuthDefaults } from '../scripts/ofm-google-config-patch.mjs';

const execute = promisify(execFile);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-node-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'node-fixture');
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bin/node'), `#!/bin/sh\nprintf '%s\\n' '{"version":"${NODE_VERSION}","bun":false}'\n`, { mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'LICENSE'), 'fixture license');
  const archive = path.join(root, 'fixture.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', root, 'node-fixture']);
  const bytes = fs.readFileSync(archive);
  const release = { ...nodeRelease('linux', 'x64', false), hash: crypto.createHash('sha256').update(bytes).digest('hex') };
  let downloads = 0;
  const dependencies = { release, fetch: async (url, options) => {
    assert.equal(url, release.url);
    assert.equal(options.redirect, 'error');
    downloads++;
    return new Response(bytes);
  } };
  return { root, bytes, dependencies, downloads: () => downloads };
}

test('official pinned releases support server/desktop targets and reject unknown targets', () => {
  for (const platform of ['linux', 'darwin', 'win32']) for (const arch of ['x64', 'arm64']) {
    const release = nodeRelease(platform, arch, false);
    assert.match(release.url, /^https:\/\/nodejs\.org\/download\/release\/v24\.21\.0\//);
    assert.match(release.hash, /^[a-f0-9]{64}$/);
  }
  assert.match(nodeRelease('linux', 'x64', true).name, /musl/);
  assert.throws(() => nodeRelease('linux', 'arm64', true), /不支持/);
  assert.throws(() => nodeRelease('linux', 'mips', false), /不支持/);
});

test('automatic installation verifies, extracts, shares concurrent downloads and reuses cache', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  const data = path.join(f.root, 'data');
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'accounts.json'), 'keep me');
  const [first, second] = await Promise.all([installNode(data, process.env, f.dependencies), installNode(data, process.env, f.dependencies)]);
  assert.equal(first, second);
  assert.equal(await probeNode(first, process.env), NODE_VERSION);
  assert.equal(await installNode(data, process.env, f.dependencies), first);
  assert.equal(f.downloads(), 1);
  assert.equal(fs.readFileSync(path.resolve(first, '../../LICENSE'), 'utf8'), 'fixture license');
  assert.equal(fs.readFileSync(path.join(data, 'accounts.json'), 'utf8'), 'keep me');
  assert.equal(fs.readdirSync(path.join(data, 'runtime')).some(name => name.startsWith('.node-install-')), false);
});

test('checksum mismatch never extracts or executes download; staging is cleaned and retry works', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  const data = path.join(f.root, 'data');
  let unpacked = false;
  const bad = { ...f.dependencies, release: { ...f.dependencies.release, hash: '0'.repeat(64) }, execute: async (binary, args, options) => {
    if (binary === 'tar') unpacked = true;
    return execute(binary, args, options);
  } };
  await assert.rejects(installNode(data, process.env, bad), /SHA-256/);
  assert.equal(unpacked, false);
  assert.deepEqual(fs.readdirSync(path.join(data, 'runtime')), []);
  assert.ok(await installNode(data, process.env, f.dependencies));
});

test('missing system Node triggers installation; explicit paths and opt-out do not download', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  const systemCandidate = process.versions.bun ? 'node' : process.execPath;
  const dependencies = { ...f.dependencies, execute: async (binary, args, options) => {
    if (binary === systemCandidate) throw new Error('missing system Node');
    return execute(binary, args, options);
  } };
  await assert.rejects(resolveNodeRuntime({ autoInstallNode: false }, f.root, process.env, dependencies), /autoInstallNode/);
  await assert.rejects(resolveNodeRuntime({ nodePath: '/missing/node' }, f.root, process.env, dependencies), /nodePath/);
  assert.equal(f.downloads(), 0);
  const binary = await resolveNodeRuntime({}, f.root, process.env, dependencies);
  assert.equal(await probeNode(binary, process.env), NODE_VERSION);
  assert.equal(f.downloads(), 1);
});

test('available system Node is preferred without contacting a download server', async () => {
  const run = async () => ({ stdout: '{"version":"24.21.0","bun":false}' });
  const binary = await resolveNodeRuntime({ nodePath: 'configured-node' }, '/unused', {}, { execute: run,
    fetch() { throw new Error('must not download'); } });
  assert.equal(binary, 'configured-node');
  assert.equal(await probeNode('bun', {}, async () => ({ stdout: '{"version":"24.0.0","bun":true}' })), undefined);
  assert.equal(await probeNode('old-node', {}, async () => ({ stdout: '{"version":"22.18.0","bun":false}' })), undefined);
});

test('WeChat patch removes the embedded default, requires local config and preserves callback', () => {
  const input = 'var LOOMY_WECHAT_APP_ID = "fixture-public-app";\nfunction buildLoomyWechatAuthUrl(state) {\nreturn encodeURIComponent(LOOMY_WECHAT_APP_ID);\n}';
  const patched = removeEmbeddedWechatDefault(input);
  assert.ok(!patched.includes('fixture-public-app'));
  const build = new Function('process', `${patched}; return buildLoomyWechatAuthUrl;`);
  assert.throws(() => build({ env: {} })('fixture-state'), /本机 App ID/);
  assert.equal(build({ env: { OFM_LOOMY_WECHAT_APP_ID: ' configured-app ' } })('state'), 'configured-app');
  assert.throws(() => removeEmbeddedWechatDefault('upstream changed'), /definition changed/);
  assert.equal(typeof removeEmbeddedOAuthDefaults, 'function');
});
