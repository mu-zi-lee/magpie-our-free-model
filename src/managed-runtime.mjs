import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { resolveNodeRuntime } from './node-runtime.mjs';
import { registerInstallation, withInstallationLock, validateDataDir } from './installation-state.mjs';
import { attachLiveService } from './live-service.mjs';

const instances = new Map();
const runner = fileURLToPath(new URL('./managed-runner.mjs', import.meta.url));
const LOCK_PRODUCT = 'our-free-model-standalone';
const environment = () => {
  const env = { ...process.env };
  // Never inject another runtime's loaders or reuse DSH's configuration.
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  delete env.DSH_HOME;
  delete env.OFM_HOME;
  return env;
};

/** Is another process still holding the standalone service's lock? */
function liveLockOwner(dataDir) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(dataDir, 'service.lock'), 'utf8'));
    if (lock?.product !== LOCK_PRODUCT || !Number.isInteger(lock.pid) || lock.pid <= 0) return undefined;
    try { process.kill(lock.pid, 0); } catch (error) { return error.code === 'ESRCH' ? undefined : lock.pid; }
    return lock.pid;
  } catch { return undefined; }
}

export function getManagedRuntime(input = {}, options = {}) {
  const directory = input.directory || input.worktree || path.join(os.homedir(), '.config', 'magpie');
  const dataDir = path.resolve(options.dataDir || path.join(directory, 'our-free-model'));
  validateDataDir(dataDir, directory);
  const nodePath = options.nodePath;
  const port = options.port;
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error('managed.port 必须为 0 到 65535 的整数');
  const eacSourceDir = options.eacSourceDir ? path.resolve(options.eacSourceDir) : undefined;
  const autoInstallChannels = options.autoInstallChannels !== false;
  if (options.autoInstallChannels !== undefined && typeof options.autoInstallChannels !== 'boolean') throw new Error('managed.autoInstallChannels 必须为布尔值');
  const autoInstallEac = options.autoInstallEac !== false;
  if (options.autoInstallEac !== undefined && typeof options.autoInstallEac !== 'boolean') throw new Error('managed.autoInstallEac 必须为布尔值');
  const consolePort = options.consolePort;
  if (consolePort !== undefined && (!Number.isInteger(consolePort) || consolePort < 0 || consolePort > 65535 || consolePort !== 0 && consolePort === port)) throw new Error('managed.consolePort 必须为独立的 0 到 65535 整数端口');
  // Migrate the old saved mode; no Tailscale code or login is retained.
  const consoleAccess = options.consoleAccess === 'tailscale' ? 'cloudflare' : options.consoleAccess ?? 'auto';
  const remote = { consoleAccess, cloudflaredPath: options.cloudflaredPath, autoInstallCloudflared: options.autoInstallCloudflared !== false };
  if (!['auto', 'local', 'cloudflare'].includes(remote.consoleAccess)) throw new Error('managed.consoleAccess 必须为 auto、local 或 cloudflare');
  if (options.autoInstallCloudflared !== undefined && typeof options.autoInstallCloudflared !== 'boolean') throw new Error('managed.autoInstallCloudflared 必须为布尔值');
  if (remote.cloudflaredPath !== undefined && (typeof remote.cloudflaredPath !== 'string' || !remote.cloudflaredPath.trim())) throw new Error('managed.cloudflaredPath 必须为非空路径');
  const identity = JSON.stringify([dataDir, nodePath, port, options.refresh !== false, eacSourceDir, autoInstallEac, autoInstallChannels, options.autoInstallNode !== false, consolePort, remote]);
  if (instances.has(dataDir)) {
    const entry = instances.get(dataDir);
    if (entry.identity !== identity) throw new Error('同一数据目录使用了不同服务设置；重启 Magpie 后再应用配置');
    return entry;
  }
  let child;
  let state;
  let pending;
  let closing;
  let sequence = 0;
  let disposed = false;
  const calls = new Map();
  const runtime = {
    dataDir, identity,
    async ensure() {
      if (disposed) throw new Error('本插件正在卸载，不能重新启动服务');
      if (closing) {
        await closing; closing = undefined;
        if (disposed) throw new Error('本插件正在卸载，不能重新启动服务');
      }
      if (state && child?.exitCode === null && !child.killed) return state;
      if (pending) return pending;
      // Another host (the desktop app, or a Magpie web/tui process) already owns
      // this data directory. Reuse its service instead of racing it for the lock:
      // both entries are legitimate, and a CLI run must not fail the way a
      // duplicate service always would.
      if (liveLockOwner(dataDir) !== undefined) {
        state = { type: 'attached', ...await attachLiveService(dataDir) };
        return state;
      }
      pending = (async () => {
        await registerInstallation(directory, dataDir);
        return withInstallationLock(dataDir, async () => {
          if (disposed) throw new Error('本插件正在卸载，不能重新启动服务');
          if (liveLockOwner(dataDir) !== undefined) {
            return { type: 'attached', ...await attachLiveService(dataDir) };
          }
          const resolvedNode = await resolveNodeRuntime(options, dataDir, environment());
          const processHandle = spawn(resolvedNode, [runner], { env: environment(), stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
          child = processHandle;
          processHandle.stdin.on('error', () => {});
          const exit = new Promise(resolve => processHandle.once('exit', resolve));
          processHandle.once('exit', () => {
            if (child === processHandle) state = undefined;
            for (const call of calls.values()) call.reject(new Error('内置服务已退出'));
            calls.clear();
          });
          runtime.exited = exit;
          const ready = await new Promise((resolve, reject) => {
            const lines = createInterface({ input: processHandle.stdout });
            const timer = setTimeout(() => { processHandle.kill('SIGKILL'); finish(new Error('内置服务启动超时')); }, 45000);
            const finish = (error, value) => {
              clearTimeout(timer);
              if (error) lines.close();
              processHandle.off('error', onError);
              processHandle.off('exit', onExit);
              if (error) { processHandle.stdin.end(); reject(error); } else resolve(value);
            };
            const onError = () => finish(new Error('无法启动 Node 内置服务'));
            const onExit = () => finish(new Error('内置服务在启动时退出'));
            processHandle.once('error', onError);
            processHandle.once('exit', onExit);
            lines.on('line', line => {
              try {
                const reply = JSON.parse(line);
                if (reply.type === 'ready') finish(null, reply);
                if (reply.type === 'error') finish(new Error(reply.message));
                if (reply.id && calls.has(reply.id)) {
                  const call = calls.get(reply.id);
                  calls.delete(reply.id);
                  if (reply.error) call.reject(new Error(reply.error)); else call.resolve(reply.value);
                }
              } catch { finish(new Error('内置服务返回了无效启动信息')); }
            });
            processHandle.stdin.write(JSON.stringify({ dataDir, port, consolePort, ...remote, refresh: options.refresh !== false, eacSourceDir, autoInstallEac, autoInstallChannels, parentPid: process.pid }) + '\n');
          });
          state = ready;
          // Pipes carry ownership: host exit closes stdin and the child shuts down.
          processHandle.unref();
          processHandle.stdin.unref?.();
          processHandle.stdout.unref?.();
          return state;
        });
      })().finally(() => { pending = undefined; });
      return pending;
    },
    async connection() {
      const current = await runtime.ensure();
      const settings = JSON.parse(fs.readFileSync(current.keyFile, 'utf8'));
      if (typeof settings.forwardKey !== 'string' || !settings.forwardKey) throw new Error('内置服务密钥不可用');
      return { base: `${current.url}/v1`, key: settings.forwardKey };
    },
    async command(type, payload = {}, signal) {
      const current = await runtime.ensure();
      signal?.throwIfAborted();
      if (current.type === 'attached') {
        return attachedCommand(current, type, payload, signal);
      }
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); calls.delete(id); };
        const abort = () => { cleanup(); reject(signal.reason); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('内置服务管理请求超时')); }, type === 'console' ? 180000 : 5000);
        calls.set(id, { resolve(value) { cleanup(); resolve(value); }, reject(error) { cleanup(); reject(error); } });
        signal?.addEventListener('abort', abort, { once: true });
        child.stdin.write(JSON.stringify({ ...payload, type, id }) + '\n');
      });
    },
    async close() {
      if (closing) return closing;
      closing = (async () => {
        if (pending) { try { await pending; } catch {} }
        // An attached service belongs to the other host; this runtime never
        // started it and must not stop it on dispose.
        if (!child || child.exitCode !== null || state?.type === 'attached') return;
        const current = child;
        current.stdin.end();
        const timer = setTimeout(() => current.kill('SIGKILL'), 5000);
        await runtime.exited;
        clearTimeout(timer);
        state = undefined;
      })();
      return closing;
    },
    async dispose() { disposed = true; await runtime.close(); },
  };
  instances.set(dataDir, runtime);
  return runtime;
}

async function attachedCommand(state, type, payload, signal) {
  signal?.throwIfAborted();
  const session = await state.managementSession();
  const call = async (method, body) => {
    const response = await fetch(`${state.managementBase}/api/management/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: state.base, cookie: session },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(type === 'console' ? 180000 : 20000)]),
    });
    if (!response.ok) throw new Error(`内置服务管理请求失败（HTTP ${response.status}）`);
    return response;
  };
  if (type === 'console') {
    // The one-use browser handoff is minted by the process that started the
    // service, so an attached host hands the user to that host's own entry
    // point instead of racing it for a second ticket.
    throw Object.assign(new Error('内置服务正由另一个 Magpie 进程运行：请在那个 Magpie 窗口里打开 Our Free Model 管理页面'), {
      signIn: 'host-owns-service',
    });
  }
  if (type === 'admit') {
    const model = payload?.model;
    if (typeof model !== 'string') throw new Error('Missing model');
    if (!model.includes('/')) return session.routable.has(model);
    const provider = model.slice(0, model.indexOf('/'));
    const [models, accounts] = await Promise.all([
      (await call('channels/rpc', { method: 'model.list', payload: { provider } })).json(),
      (await call('channels/rpc', { method: 'account.list', payload: { provider } })).json(),
    ]);
    const rows = models?.value?.models ?? [];
    return accounts?.value?.accounts?.some(account => account.enabled !== false) === true
      && rows.some(row => row.id === model && !row.disabled && !row.dead);
  }
  if (type === 'models') return session.models();
  throw new Error('Unknown managed command');
}
