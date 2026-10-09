// Runs in Node, not in Magpie's Bun host. The upstream Worker needs Node APIs.
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { startStandalone } from '../vendor/ofm/packages/standalone/service.mjs';
import { effortsFor } from '../vendor/ofm/src/effort.js';
import { createConsoleHandoff } from './managed-console.mjs';
import { loadEacSource } from './eac-source.mjs';
import { createTailscaleConsole, remoteByDefault } from './tailscale-console.mjs';

let service;
let stopping;
let stopped = false;
let parentWatch;
let consoleHandoff;
let remoteConsole;
let runnerSettings;
const lines = createInterface({ input: process.stdin });
const stop = () => {
  if (stopped) return stopping;
  stopped = true;
  clearInterval(parentWatch);
  lines.close();
  stopping = (async () => {
    await remoteConsole?.close();
    await Promise.all([service?.close(), consoleHandoff?.close()]);
  })().finally(() => process.exit(0));
  return stopping;
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
let started = false;
lines.once('line', async line => {
  started = true;
  try {
    const settings = JSON.parse(line);
    runnerSettings = settings;
    const eacSource = await loadEacSource(settings);
    const googleFile = path.join(settings.dataDir, 'gemini-oauth.json');
    if (fs.existsSync(googleFile)) {
      const google = JSON.parse(fs.readFileSync(googleFile, 'utf8'));
      if (typeof google.clientId !== 'string' || !google.clientId.trim() ||
          typeof google.clientSecret !== 'string' || !google.clientSecret.trim()) {
        throw new Error('gemini-oauth.json 需要非空 clientId 和 clientSecret');
      }
      process.env.CMDC_PAK_GOOGLE_CLIENT_ID = google.clientId.trim();
      process.env.CMDC_PAK_GOOGLE_CLIENT_SECRET = google.clientSecret.trim();
    }
    const wechatFile = path.join(settings.dataDir, 'loomy-wechat.json');
    if (fs.existsSync(wechatFile)) {
      const wechat = JSON.parse(fs.readFileSync(wechatFile, 'utf8'));
      if (typeof wechat.appId !== 'string' || !wechat.appId.trim()) throw new Error('loomy-wechat.json 需要非空 appId');
      process.env.OFM_LOOMY_WECHAT_APP_ID = wechat.appId.trim();
    }
    const lock = path.join(settings.dataDir, 'service.lock');
    // Recover only this service's dead-process lock, never a live or unknown lock.
    if (fs.existsSync(lock)) {
      const previous = JSON.parse(fs.readFileSync(lock, 'utf8'));
      if (previous.product === 'our-free-model-standalone' && Number.isInteger(previous.pid) && previous.pid > 0) {
        try { process.kill(previous.pid, 0); }
        catch (error) { if (error.code === 'ESRCH') fs.unlinkSync(lock); }
      }
    }
    service = await startStandalone({ dataDir: settings.dataDir, port: settings.port,
      refresh: settings.refresh !== false, eacCredential: eacSource.credentialOf, eacSetup: eacSource.setup,
      logger: { info() {}, warn() {}, error() {} } });
    consoleHandoff = await createConsoleHandoff(service, settings.consolePort);
    if (process.stdin.readableEnded) return stop();
    process.stdout.write(JSON.stringify({ type: 'ready', url: service.url,
      keyFile: service.keyFile, pid: process.pid }) + '\n');
    parentWatch = setInterval(() => {
      try { process.kill(settings.parentPid, 0); }
      catch (error) { if (error.code === 'ESRCH') void stop(); }
    }, 2000);
    parentWatch.unref();
  } catch (error) {
    await Promise.allSettled([service?.close(), consoleHandoff?.close()]);
    process.stdout.write(JSON.stringify({ type: 'error', message: error.code === 'EEXIST'
      ? '数据目录已被另一个服务占用；关闭那个服务或使用另一个 managed.dataDir。'
      : `内置服务启动失败：${error.message}` }) + '\n');
    process.exit(1);
  }
});
lines.on('close', () => { if (started && service) void stop(); else if (!started) process.exit(0); });
lines.on('line', async line => {
  let command;
  try { command = JSON.parse(line); } catch { return; }
  if (!command.id || !service || stopping) return;
  try {
    let value;
    if (command.type === 'console') {
      const remote = command.access === 'tailscale' || command.access !== 'local' && remoteByDefault(runnerSettings);
      if (remote) {
        const previous = remoteConsole;
        if (previous?.closed) { await previous.close(); if (remoteConsole === previous) remoteConsole = undefined; }
        remoteConsole ??= createTailscaleConsole(service, runnerSettings, runnerSettings.dataDir);
        value = await remoteConsole.open();
      } else value = consoleHandoff.ticket();
    }
    else if (command.type === 'admit') {
      const model = command.model;
      if (typeof model !== 'string') throw new Error('Missing model');
      if (service.channels.handles(model)) {
        const slash = model.indexOf('/');
        const provider = model.slice(0, slash);
        const id = model.slice(slash + 1);
        const [models, accounts] = await Promise.all([
          service.channels.rpc({ method: 'model.list', payload: { provider } }),
          service.channels.rpc({ method: 'account.list', payload: { provider } }),
        ]);
        value = models.ok === true && accounts.ok === true &&
          accounts.value.accounts.some(account => account.enabled !== false) &&
          models.value.models.some(row => row.id === id && !row.disabled && !row.dead);
      } else value = service.runtime.publicModelRows().some(row => row.id === model);
    }
    else if (command.type === 'models') {
      const allowed = new Set(service.runtime.publicModelRows().map(row => row.id));
      value = service.runtime.catalog.filter(row => allowed.has(row.id)).map(row => ({
        id: row.id, name: row.name, vision: row.vision,
        context_window: row.contextWindow ?? row.context_window,
        max_tokens: row.maxOutput ?? row.max_tokens,
        input: row.input,
        reasoning: typeof row.reasoning === 'object' ? row.reasoning : row.reasoning === true,
        reasoning_efforts: row.reasoning && typeof row.reasoning === 'object' ? row.reasoning.efforts : effortsFor(row),
      }));
    } else throw new Error('Unknown managed command');
    process.stdout.write(JSON.stringify({ id: command.id, value }) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify({ id: command.id,
    error: command.type === 'console' ? error.message : '内置服务无法执行管理请求' }) + '\n'); }
});
