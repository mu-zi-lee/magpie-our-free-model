import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installCloudflared, resolveCloudflared, cloudflaredRelease, CLOUDFLARED_VERSION } from '../src/cloudflared-runtime.mjs';
import { createCloudflareConsole, quickTunnelOrigin } from '../src/cloudflare-console.mjs';
import { remoteByDefault } from '../src/cloudflare-console.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 100; i++) { if (await fn()) return; await pause(30); } throw new Error('fixture timed out'); }
async function scratch(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ofm-cloudflare-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }

test('Cloudflare platform pins, explicit binary validation and remote mode', async () => {
  for (const [platform, arch] of [['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'x64'], ['darwin', 'arm64'], ['win32', 'x64']]) {
    const release = cloudflaredRelease(platform, arch); assert.match(release.hash, /^[a-f0-9]{64}$/); assert.match(release.binaryHash, /^[a-f0-9]{64}$/);
    assert.ok(release.url.startsWith(`https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/`));
  }
  assert.throws(() => cloudflaredRelease('win32', 'arm64'), /cloudflaredPath/);
  assert.equal(remoteByDefault({ consoleAccess: 'cloudflare' }, {}, 'darwin'), true);
  const execute = async () => { throw new Error('private failure'); };
  await assert.rejects(resolveCloudflared({ cloudflaredPath: '/missing' }, '/unused', { execute }), /cloudflaredPath/);
  await assert.rejects(resolveCloudflared({ autoInstallCloudflared: false }, '/unused', { execute }), /autoInstallCloudflared/);
});

test('verified cloudflared binary: concurrent install, cache integrity, offline reuse and failure before execution', { skip: process.platform === 'win32' }, async t => {
  const dir = await scratch(t);
  const bytes = Buffer.from(`#!/bin/sh\nprintf 'cloudflared version ${CLOUDFLARED_VERSION}\\n'\n`);
  const release = { ...cloudflaredRelease('linux', 'x64'), hash: hash(bytes), binaryHash: hash(bytes), bytes: bytes.length };
  let downloads = 0;
  const dependencies = { release, fetch: async (url, options) => { downloads++; assert.equal(url, release.url); assert.equal(options.redirect, 'manual'); return new Response(bytes); } };
  const data = path.join(dir, 'data');
  const [first, second] = await Promise.all([installCloudflared(data, dependencies), installCloudflared(data, dependencies)]);
  assert.equal(first, second); assert.equal(downloads, 1);
  assert.equal(await installCloudflared(data, { ...dependencies, fetch() { throw new Error('offline'); } }), first);
  await fs.writeFile(first, 'tampered'); await installCloudflared(data, dependencies); assert.equal(downloads, 2);
  assert.deepEqual(await fs.readFile(first), bytes);
  assert.equal((await fs.stat(first)).mode & 0o777, 0o700);
  assert.ok((await fs.readFile(path.join(path.dirname(first), 'LICENSE'), 'utf8')).includes('Apache License'));
  let executions = 0;
  await assert.rejects(installCloudflared(path.join(dir, 'bad'), { ...dependencies,
    release: { ...release, hash: '0'.repeat(64) }, execute: async () => { executions++; throw new Error(); } }), /SHA-256/);
  assert.equal(executions, 0); assert.deepEqual(await fs.readdir(path.join(dir, 'bad/runtime')), []);
  const outside = path.join(dir, 'outside'); await fs.mkdir(outside);
  const linked = path.join(dir, 'linked'); await fs.mkdir(linked); await fs.symlink(outside, path.join(linked, 'runtime'));
  await assert.rejects(installCloudflared(linked, dependencies), /符号链接/); assert.deepEqual(await fs.readdir(outside), []);
});

test('Darwin archive is verified before unpacking and executable is independently verified', { skip: process.platform === 'win32' }, async t => {
  const dir = await scratch(t);
  const source = path.join(dir, 'source'); await fs.mkdir(source);
  const bytes = Buffer.from(`#!/bin/sh\nprintf 'cloudflared version ${CLOUDFLARED_VERSION}\\n'\n`);
  await fs.writeFile(path.join(source, 'cloudflared'), bytes, { mode: 0o700 });
  const archive = path.join(dir, 'release.tgz'); execFileSync('tar', ['-czf', archive, '-C', source, 'cloudflared']);
  const compressed = await fs.readFile(archive);
  const release = { ...cloudflaredRelease('darwin', 'arm64'), hash: hash(compressed), binaryHash: hash(bytes), bytes: compressed.length };
  const deps = { release, fetch: async () => new Response(compressed) };
  assert.ok(await installCloudflared(path.join(dir, 'data'), deps));
  await assert.rejects(installCloudflared(path.join(dir, 'bad'), { ...deps, release: { ...release, binaryHash: '0'.repeat(64) } }), /完整性/);
});

test('GitHub asset redirects must remain on official release-assets host', async t => {
  const dir = await scratch(t);
  await assert.rejects(installCloudflared(dir, { fetch: async () => new Response(null, { status: 302, headers: { location: 'https://evil.invalid/file' } }) }), /非官方/);
  assert.deepEqual(await fs.readdir(path.join(dir, 'runtime')), []);
});

async function fixture(t, { sessionMs, fail = false, registered = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ofm-cf-manager-'));
  const log = path.join(dir, 'log.json'); const pidFile = path.join(dir, 'pid'); const script = path.join(dir, 'fixture.mjs');
  await fs.writeFile(script, `import fs from 'node:fs';
    fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({args:process.argv.slice(2),env:Object.keys(process.env).filter(k=>/^(TUNNEL_|CLOUDFLARED_)/.test(k)),config:fs.readFileSync(process.argv[process.argv.indexOf('--config')+1],'utf8')}));
    fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
    console.log('https://fixture-console.trycloudflare.com');
    ${registered ? "console.log('Registered tunnel connection');" : ''}
    ${fail ? 'process.exit(1);' : 'setInterval(()=>{},1000);'}
  `);
  const binary = path.join(dir, 'cloudflared'); await fs.writeFile(binary, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`, { mode: 0o700 });
  let origin, closed = 0;
  const manager = createCloudflareConsole({}, {}, dir, { sessionMs, attempts: registered ? 100 : 20, pollMs: 10,
    resolve: async () => binary, createGateway: async options => ({ target: 'http://127.0.0.1:32100',
      setOrigin: value => { origin = value; }, ticket: () => `${origin}/open/fixture`, close: async () => { closed++; } }) });
  t.after(async () => { await manager.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { dir, manager, log, pidFile, closed: () => closed };
}

test('accountless tunnel shares repeated opens, isolates configuration and cleans all session resources', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  const before = process.env.TUNNEL_TOKEN; process.env.TUNNEL_TOKEN = 'do-not-use-existing-token';
  try {
    const [a, b] = await Promise.all([f.manager.open(), f.manager.open()]); assert.deepEqual(a, b);
    assert.equal(a.setup, false); assert.equal(a.url, 'https://fixture-console.trycloudflare.com/open/fixture');
    const log = JSON.parse(await fs.readFile(f.log)); assert.deepEqual(log.env, []); assert.equal(log.config, '{}\n');
    assert.ok(log.args.includes('--no-autoupdate')); assert.ok(!log.args.some(arg => ['login', 'service', '--token'].includes(arg)));
    const config = log.args[log.args.indexOf('--config') + 1];
    const pid = Number(await fs.readFile(f.pidFile));
    await f.manager.close(); assert.equal(f.closed(), 1);
    await assert.rejects(fs.stat(config), { code: 'ENOENT' });
    await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
    await assert.rejects(f.manager.open(), /已关闭/);
  } finally { if (before === undefined) delete process.env.TUNNEL_TOKEN; else process.env.TUNNEL_TOKEN = before; }
});

test('Quick Tunnel failure and timeout close the gateway and temporary configuration', { skip: process.platform === 'win32' }, async t => {
  for (const options of [{ fail: true, registered: false }, { registered: false }]) {
    const f = await fixture(t, options);
    await assert.rejects(f.manager.open(), /启动失败|连接超时|已关闭/); assert.equal(f.closed(), 1);
    assert.deepEqual(await fs.readdir(path.join(f.dir, 'temporary')), []);
  }
});

test('Quick Tunnel expires without extending on repeated opens', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t, { sessionMs: 400 }); await f.manager.open(); await f.manager.open();
  await until(() => f.manager.closed); await f.manager.close(); assert.equal(f.closed(), 1);
});

test('closing during binary resolution cannot start a new tunnel', async () => {
  let finish, gateway = 0;
  const manager = createCloudflareConsole({}, {}, '/unused', { resolve: () => new Promise(resolve => { finish = resolve; }), createGateway: () => { gateway++; } });
  const opening = manager.open(); await manager.close(); finish('/unused');
  await assert.rejects(opening, /已关闭/); assert.equal(gateway, 0);
  assert.equal(quickTunnelOrigin('https://evil.invalid'), undefined);
  assert.equal(quickTunnelOrigin('https://fixture.trycloudflare.com.evil.invalid'), undefined);
  assert.equal(quickTunnelOrigin('https://fixture.trycloudflare.com:8443'), undefined);
});

test('process supervision closes workers even when the owning runner is SIGKILLed', { skip: process.platform === 'win32' }, async t => {
  const dir = syncFs.mkdtempSync(path.join(os.tmpdir(), 'ofm-owner-'));
  const workerFile = path.join(dir, 'worker.pid');
  const supervisor = fileURLToPath(new URL('../src/owned-process.mjs', import.meta.url));
  const workerCode = 'console.log(process.pid); setInterval(()=>{}, 1000);';
  const owner = spawn(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs'; import { spawn } from 'node:child_process';
    const child = spawn(process.execPath, [${JSON.stringify(supervisor)}, String(process.pid), process.execPath, '-e', ${JSON.stringify(workerCode)}], { stdio: ['pipe','pipe','ignore'] });
    child.stdout.on('data', data=>fs.writeFileSync(${JSON.stringify(workerFile)}, data.toString().trim()));
    setInterval(()=>{}, 1000);
  `], { stdio: 'ignore' });
  t.after(() => { owner.kill('SIGKILL'); syncFs.rmSync(dir, { recursive: true, force: true }); });
  await until(() => syncFs.existsSync(workerFile));
  const pid = Number(syncFs.readFileSync(workerFile, 'utf8')); assert.ok(pid > 0);
  owner.kill('SIGKILL');
  await until(() => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } });
});

test('remote mode detects SSH/headless Linux and respects local choice', () => {
  assert.equal(remoteByDefault({}, {}, 'darwin'), false);
  assert.equal(remoteByDefault({}, { SSH_CONNECTION: 'fixture' }, 'darwin'), true);
  assert.equal(remoteByDefault({}, {}, 'linux'), true);
  assert.equal(remoteByDefault({}, { DISPLAY: ':0' }, 'linux'), false);
  assert.equal(remoteByDefault({ consoleAccess: 'local' }, { SSH_TTY: 'fixture' }, 'linux'), false);
});
