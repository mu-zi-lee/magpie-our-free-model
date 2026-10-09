// Runs in Node, not in Magpie's Bun host. The upstream Worker needs Node APIs.
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { startStandalone } from '../vendor/ofm/packages/standalone/service.mjs';
import { effortsFor } from '../vendor/ofm/src/effort.js';
import { createConsoleHandoff } from './managed-console.mjs';
import { loadEacSource } from './eac-source.mjs';
import { channelBusinessUrl } from './channel-source.mjs';
import { createCloudflareConsole, remoteByDefault } from './cloudflare-console.mjs';

let service;
let stopping;
let stopped = false;
let parentWatch;
let consoleHandoff;
let remoteConsole;
let consoleRequests = Promise.resolve();
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
    const [eacSource, channelBusiness] = await Promise.all([loadEacSource(settings), channelBusinessUrl(settings)]);
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
      channelBusiness, refresh: settings.refresh !== false, eacCredential: eacSource.credentialOf, eacSetup: eacSource.setup,
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
      value = await (consoleRequests = consoleRequests.catch(() => {}).then(async () => {
        if (stopping) throw new Error('内置服务正在关闭');
        const access = command.access ?? runnerSettings.consoleAccess;
        if (!['auto', 'local', 'cloudflare'].includes(access)) throw new Error('无效控制台访问方式');
        const remote = remoteByDefault({ ...runnerSettings, consoleAccess: access });
        if (remote) {
          const previous = remoteConsole;
          if (previous?.closed) { await previous.close(); remoteConsole = undefined; }
          if (stopping) throw new Error('内置服务正在关闭');
          remoteConsole ??= createCloudflareConsole(service, runnerSettings, runnerSettings.dataDir);
          return remoteConsole.open();
        }
        return consoleHandoff.ticket();
      }));
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
