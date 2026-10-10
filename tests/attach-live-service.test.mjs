// The desktop app and `magpie-cli` are separate hosts that share one
// `managed.dataDir`. Only one may run the standalone service, so the second
// host has to adopt the running one instead of racing it for `service.lock`.
// Driven across real processes: the in-process `instances` map cannot model
// two hosts, and that map is exactly what let both hosts through before.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getManagedRuntime } from '../src/managed-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function host(dataDir, role) {
  const script = `
    import { getManagedRuntime } from ${JSON.stringify(new URL('../src/managed-runtime.mjs', import.meta.url).href)};
    const options = { dataDir: process.argv[2], nodePath: process.execPath, consolePort: 0,
      autoInstallChannels: false, autoInstallEac: false };
    // Both hosts resolve the same Magpie config directory, as the desktop app
    // and a CLI run do; only the process differs.
    const runtime = getManagedRuntime({ directory: process.argv[4] }, options);
    const state = await runtime.ensure();
    const connection = await runtime.connection();
    const rows = await runtime.command('models');
    console.log(JSON.stringify({ type: state.type, url: state.url, base: connection.base,
      models: rows.length, admit: await runtime.command('admit', { model: 'space-bunny-free' }) }));
    if (process.argv[3] === 'peer') { await runtime.dispose(); process.exit(0); }
    // The owner must keep running while the peer attaches, like a desktop app.
    setInterval(() => {}, 1 << 30);
  `;
  const file = path.join(root, 'tests', `.attach-host-${role}-${process.pid}.mjs`);
  fs.writeFileSync(file, script);
  return { file, child: null };
}

function start(dataDir, role) {
  const { file } = host(dataDir, role);
  const child = spawn(process.execPath, [file, dataDir, role, path.dirname(dataDir)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', chunk => { out += chunk; });
  child.stderr.on('data', chunk => { err += chunk; });
  const reported = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${role} timed out: ${out}${err}`)), 60000);
    let settled = false;
    const watch = setInterval(() => {
      const line = out.trim().split('\n').findLast(candidate => candidate.startsWith('{'));
      if (!line) return;
      clearInterval(watch);
      clearTimeout(timer);
      try { settled = true; resolve(JSON.parse(line)); }
      catch { reject(new Error(`${role} returned invalid JSON: ${out}${err}`)); }
    }, 50);
    child.on('exit', code => {
      if (settled) return;
      clearInterval(watch);
      clearTimeout(timer);
      reject(new Error(`${role} exited ${code} before reporting: ${out}${err}`));
    });
  });
  return reported.then(report => ({ report, child, file }));
}

test('a second host attaches to the live service; the lock owner is unchanged', { skip: process.platform === 'win32' && !process.env.OFM_TEST_ATTACH }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-attach-'));
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(path.join(dataDir, 'channel-pack'), { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const owner = await start(dataDir, 'owner');
  t.after(() => { owner.child.kill(); try { fs.rmSync(owner.file, { force: true }); } catch {} });
  const peer = await start(dataDir, 'peer');
  t.after(() => { try { fs.rmSync(peer.file, { force: true }); } catch {} });

  assert.equal(owner.report.type, 'ready');
  assert.equal(peer.report.type, 'attached');
  assert.equal(peer.report.url, owner.report.url);
  assert.equal(peer.report.base, `${owner.report.url}/v1`);
  assert.ok(peer.report.models > 0);
  assert.equal(peer.report.models, owner.report.models);
  assert.equal(peer.report.admit, true);

  // The peer borrowed the service: disposing it must leave the owner serving.
  const rows = await getManagedRuntime({ directory: dir },
    { dataDir, nodePath: process.execPath, consolePort: 0, autoInstallChannels: false, autoInstallEac: false })
    .command('models');
  assert.ok(rows.length > 0);
});

test('a stale lock from a dead process is recovered, not adopted', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-stale-'));
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(path.join(dataDir, 'channel-pack'), { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, 'service.lock'),
    JSON.stringify({ product: 'our-free-model-standalone', pid: 0x7ffffff0 }));
  const runtime = getManagedRuntime({ directory: dir },
    { dataDir, nodePath: process.execPath, consolePort: 0, autoInstallChannels: false, autoInstallEac: false });
  t.after(() => runtime.dispose());
  const state = await runtime.ensure();
  assert.equal(state.type, 'ready');
  assert.ok(state.pid > 0);
});
