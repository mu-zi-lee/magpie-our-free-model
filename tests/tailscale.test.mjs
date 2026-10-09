import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installTailscale, probeTailscale, resolveTailscale, tailscaleRelease, TAILSCALE_VERSION } from '../src/tailscale-runtime.mjs';
import { createTailscaleConsole, remoteByDefault } from '../src/tailscale-console.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 100; i++) { if (await fn()) return; await delay(50); } throw new Error('Fixture timed out'); }
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

test('automatic remote mode detects SSH/headless Linux and respects explicit local choice', () => {
  assert.equal(remoteByDefault({}, {}, 'darwin'), false);
  assert.equal(remoteByDefault({}, { SSH_CONNECTION: 'fixture' }, 'darwin'), true);
  assert.equal(remoteByDefault({}, {}, 'linux'), true);
  assert.equal(remoteByDefault({}, { DISPLAY: ':0' }, 'linux'), false);
  assert.equal(remoteByDefault({ consoleAccess: 'local' }, { SSH_TTY: '/dev/pts/0' }, 'linux'), false);
  assert.equal(remoteByDefault({ consoleAccess: 'tailscale' }, {}, 'win32'), true);
});

test('pinned Linux releases, minimum CLI version and explicit path errors', async () => {
  for (const arch of ['x64', 'arm64']) assert.match(tailscaleRelease('linux', arch).hash, /^[a-f0-9]{64}$/);
  assert.throws(() => tailscaleRelease('darwin', 'arm64'), /请先安装/);
  assert.equal(await probeTailscale('fixture', async () => ({ stdout: '1.50.0' })), undefined);
  await assert.rejects(resolveTailscale({ tailscalePath: '/missing' }, '/unused', { execute: async () => { throw new Error(); } }), /tailscalePath/);
  await assert.rejects(resolveTailscale({ autoInstallTailscale: false }, '/unused', { execute: async () => { throw new Error(); } }), /autoInstallTailscale/);
});

test('missing Tailscale downloads and verifies a matched pair, caches it and rejects bad checksum before execution', { skip: process.platform === 'win32' }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-ts-install-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixture = path.join(dir, 'release'); fs.mkdirSync(fixture);
  for (const name of ['tailscale', 'tailscaled']) fs.writeFileSync(path.join(fixture, name), `#!/bin/sh\nprintf '%s\\n' '${TAILSCALE_VERSION}'\n`, { mode: 0o700 });
  const archive = path.join(dir, 'fixture.tgz'); execFileSync('tar', ['-czf', archive, '-C', dir, 'release']);
  const bytes = fs.readFileSync(archive); const release = { ...tailscaleRelease('linux', 'x64'), hash: crypto.createHash('sha256').update(bytes).digest('hex') };
  let downloads = 0;
  const deps = { release, fetch: async (url, options) => { assert.equal(url, release.url); assert.equal(options.redirect, 'error'); downloads++; return new Response(bytes); } };
  const data = path.join(dir, 'data');
  const [a, b] = await Promise.all([installTailscale(data, deps), installTailscale(data, deps)]);
  assert.deepEqual(a, b); assert.equal(downloads, 1);
  assert.equal(await probeTailscale(a.cli), TAILSCALE_VERSION);
  assert.deepEqual(await installTailscale(data, deps), a); assert.equal(downloads, 1);
  const missing = async (binary) => { if (binary === 'tailscale') throw new Error(); return { stdout: TAILSCALE_VERSION }; };
  assert.equal((await resolveTailscale({}, data, { ...deps, execute: missing })).isolated, true);
  let extracted = false;
  await assert.rejects(installTailscale(path.join(dir, 'bad'), { ...deps, release: { ...release, hash: '0'.repeat(64) }, execute: async binary => { if (binary === 'tar' || binary.includes('.tailscale-install-')) extracted = true; throw new Error(); } }), /SHA-256/);
  assert.equal(extracted, false);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'bad/runtime')), []);
});

function fixture(t, isolated, state = 'Running', sessionMs, approval = false, deepDataDir = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-ts-cli-'));
  const stateFile = path.join(dir, 'state.json'); const logFile = path.join(dir, 'commands.jsonl');
  fs.writeFileSync(stateFile, JSON.stringify({ BackendState: state, approval, Self: { DNSName: 'fixture.tailnet.ts.net.' } }));
  const script = path.join(dir, 'cli.mjs');
  fs.writeFileSync(script, `import fs from 'node:fs'; import net from 'node:net';
const stateFile = ${JSON.stringify(stateFile)}, logFile = ${JSON.stringify(logFile)};
const args = process.argv.slice(2); fs.appendFileSync(logFile, JSON.stringify(args)+'\\n');
const cmd = args.filter(x=>!x.startsWith('--socket='));
const socket = args.find(x=>x.startsWith('--socket='))?.slice('--socket='.length);
if(cmd.some(x=>x.startsWith('--tun='))) net.createServer().listen(socket);
const read=()=>JSON.parse(fs.readFileSync(stateFile,'utf8'));
if(cmd[0]==='status') { if(socket && !fs.existsSync(socket)) process.exit(1); const s=read(); console.log(JSON.stringify(s)); process.exit(s.BackendState==='Running'?0:1); }
if(cmd[0]==='funnel' && cmd[1]==='status') { console.log(JSON.stringify({TCP:{'443':{HTTPS:true}}})); process.exit(0); }
if(cmd[0]==='logout') process.exit(0);
if(cmd[0]==='up') { const s=read(); s.AuthURL='https://login.tailscale.com/a/fixture'; fs.writeFileSync(stateFile,JSON.stringify(s)); }
if(cmd[0]==='funnel') {
  console.log('https://login.tailscale.com/f/fixture');
  if(read().approval) process.exit(1);
  console.log('Available on the internet:\\nhttps://fixture.tailnet.ts.net:8443');
}
setInterval(()=>{},1000); process.once('SIGTERM',()=>process.exit(0));
`);
  const cli = path.join(dir, 'tailscale');
  fs.writeFileSync(cli, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`, { mode: 0o700 });
  let origin, closed = 0;
  const dataDir = deepDataDir ? path.join(dir, 'nested-'.repeat(25)) : dir;
  const manager = createTailscaleConsole({}, {}, dataDir, { sessionMs, resolve: async () => ({ cli, daemon: cli, isolated }),
    createGateway: async () => ({ target: 'http://127.0.0.1:32100', setOrigin: value => { origin = value; }, ticket: () => `${origin}/open/fixture`, close: async () => { closed++; } }) });
  t.after(async () => { await manager.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { manager, stateFile, log: () => fs.readFileSync(logFile, 'utf8').trim().split('\n').map(x => JSON.parse(x)), closed: () => closed };
}

test('existing node uses an unoccupied foreground Funnel and never resets or logs out the system node', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t, false);
  const [a, b] = await Promise.all([f.manager.open(), f.manager.open()]);
  assert.equal(a.url, 'https://fixture.tailnet.ts.net:8443/open/fixture'); assert.deepEqual(a, b);
  assert.equal(a.setup, false);
  await f.manager.close(); assert.equal(f.closed(), 1);
  const log = f.log(); assert.ok(log.some(args => args.includes('--https=8443')));
  assert.ok(!log.some(args => args.includes('logout') || args.includes('reset') || args.includes('--bg')));
});

test('isolated daemon returns browser authorization, then opens Funnel and logs out only its private socket', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t, true, 'NeedsLogin');
  const first = await f.manager.open(); assert.equal(first.setup, true); assert.equal(first.url, 'https://login.tailscale.com/a/fixture');
  fs.writeFileSync(f.stateFile, JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'fixture.tailnet.ts.net.' } }));
  assert.equal((await f.manager.open()).setup, false);
  await f.manager.close();
  const log = f.log();
  assert.ok(log.some(args => args.includes('--state=mem:') && args.includes('--tun=userspace-networking') && args.some(x => x.startsWith('--statedir='))));
  const directory = log.find(args => args.some(arg => arg.startsWith('--statedir='))).find(arg => arg.startsWith('--statedir=')).slice('--statedir='.length);
  assert.equal(path.basename(path.dirname(directory)), 'temporary');
  assert.equal(fs.existsSync(directory), false);
  assert.ok(log.some(args => args.includes('logout') && args.some(x => x.startsWith('--socket='))));
  await assert.rejects(f.manager.open(), /已关闭/);
});

test('deadline shuts the gateway and Funnel down without extending on repeated opens', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t, false, 'Running', 1500);
  await f.manager.open(); await f.manager.open();
  await until(() => f.manager.closed);
  await f.manager.close(); assert.equal(f.closed(), 1);
});

test('private socket binds under a long data directory and all workers share its relative path', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t, true, 'Running', undefined, false, true);
  assert.equal((await f.manager.open()).setup, false);
  await f.manager.close();
  const log = f.log();
  const daemon = log.find(args => args.some(arg => arg.startsWith('--statedir=')));
  assert.ok(daemon.find(arg => arg.startsWith('--statedir=')).length > 108);
  for (const args of log) assert.ok(args.includes('--socket=tailscaled.sock'));
});

test('Funnel policy authorization may exit the CLI; the next click resumes without closing the node', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t, false, 'Running', undefined, true);
  const setup = await f.manager.open(); assert.equal(setup.setup, true); assert.equal(setup.url, 'https://login.tailscale.com/f/fixture');
  assert.equal(f.manager.closed, false);
  const state = JSON.parse(fs.readFileSync(f.stateFile, 'utf8')); state.approval = false;
  fs.writeFileSync(f.stateFile, JSON.stringify(state));
  assert.equal((await f.manager.open()).setup, false);
});

test('process supervision closes workers even when the owning runner is SIGKILLed', { skip: process.platform === 'win32' }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-owner-'));
  const workerFile = path.join(dir, 'worker.pid');
  const supervisor = fileURLToPath(new URL('../src/owned-process.mjs', import.meta.url));
  const workerCode = 'console.log(process.pid); setInterval(()=>{}, 1000);';
  const owner = spawn(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs'; import { spawn } from 'node:child_process';
    const child = spawn(process.execPath, [${JSON.stringify(supervisor)}, String(process.pid), process.execPath, '-e', ${JSON.stringify(workerCode)}], { stdio: ['pipe','pipe','ignore'] });
    child.stdout.on('data', data=>fs.writeFileSync(${JSON.stringify(workerFile)}, data.toString().trim()));
    setInterval(()=>{}, 1000);
  `], { stdio: 'ignore' });
  t.after(() => { owner.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); });
  await until(() => fs.existsSync(workerFile));
  const pid = Number(fs.readFileSync(workerFile, 'utf8')); assert.ok(pid > 0);
  owner.kill('SIGKILL');
  await until(() => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } });
});
