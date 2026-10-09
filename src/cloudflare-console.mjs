import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveCloudflared } from './cloudflared-runtime.mjs';
import { createRemoteConsole } from './remote-console.mjs';

const supervisor = fileURLToPath(new URL('./owned-process.mjs', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function remoteByDefault(options = {}, env = process.env, platform = process.platform) {
  const mode = options.consoleAccess ?? 'auto';
  return mode === 'cloudflare' || mode === 'auto' && (Boolean(env.SSH_CONNECTION || env.SSH_TTY) || platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY);
}

export function quickTunnelOrigin(output) {
  for (const candidate of String(output).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com(?=$|[\s|])/g) ?? []) {
    const url = new URL(candidate);
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(url.hostname)) return url.origin;
  }
}

// Own only a foreground Quick Tunnel, with no account, token or service install.
export function createCloudflareConsole(service, options, dataDir, dependencies = {}) {
  const launch = dependencies.spawn ?? spawn;
  const resolve = dependencies.resolve ?? resolveCloudflared;
  const makeGateway = dependencies.createGateway ?? createRemoteConsole;
  let gateway, child, directory, expiry, opening, closing;
  let disposed = false;
  let publicOrigin, registered = false;
  const alive = () => child && child.exitCode === null && child.signalCode === null && !child.failure;
  const checkOpen = () => { if (disposed) throw new Error('临时通道已关闭，请重新打开远程控制台'); };
  const manager = {
    get closed() { return disposed; },
    async open() {
      checkOpen();
      if (opening) return opening;
      opening = (async () => {
        if (!child) {
          let binary = await resolve(options, dataDir, dependencies);
          if (!path.isAbsolute(binary) && (binary.includes('/') || binary.includes('\\'))) binary = path.resolve(binary);
          checkOpen();
          const temporary = path.join(dataDir, 'temporary');
          await fs.mkdir(temporary, { recursive: true, mode: 0o700 });
          directory = await fs.mkdtemp(path.join(temporary, 'cloudflare-'));
          if (disposed) await fs.rm(directory, { recursive: true, force: true });
          checkOpen();
          const config = path.join(directory, 'config.yaml');
          await fs.writeFile(config, '{}\n', { mode: 0o600 });
          checkOpen();
          gateway = await makeGateway(service, { onClose: () => manager.close() });
          if (disposed) await gateway.close();
          checkOpen();
          const env = { ...process.env };
          // Existing named-tunnel tokens/configuration must not change the target.
          for (const key of Object.keys(env)) if (/^(TUNNEL_|CLOUDFLARED_)/.test(key)) delete env[key];
          child = launch(process.execPath, [supervisor, String(process.pid), binary, 'tunnel', '--config', config,
            '--no-autoupdate', '--url', gateway.target, '--protocol', 'http2', '--edge-ip-version', '4', '--metrics', '127.0.0.1:0'],
          { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
          child.output = '';
          const collect = chunk => {
            child.output = (child.output + chunk.toString()).slice(-32768);
            publicOrigin ??= quickTunnelOrigin(child.output);
            registered ||= /Registered tunnel connection/.test(child.output);
          };
          child.stdout.on('data', collect); child.stderr.on('data', collect); child.stdin.on('error', () => {});
          child.on('error', () => { child.failure = true; });
          child.once('close', () => { if (!disposed) void manager.close(); });
          expiry = setTimeout(() => { void manager.close(); }, dependencies.sessionMs ?? 30 * 60_000); expiry.unref?.();
        }
        for (let i = 0; i < (dependencies.attempts ?? 180); i++) {
          checkOpen();
          if (!alive()) throw new Error('Cloudflare 临时穿透启动失败；请检查服务器网络或 managed.cloudflaredPath');
          if (publicOrigin && registered) {
            gateway.setOrigin(publicOrigin);
            return { url: gateway.ticket(), setup: false,
              instructions: '免登录临时 HTTPS 控制台已开启，最多保留 30 分钟。完成账号管理后点击“结束远程访问”；一次性链接十分钟有效。临时地址可能需要片刻才能访问。' };
          }
          await pause(dependencies.pollMs ?? 250);
        }
        throw new Error('Cloudflare 临时穿透连接超时；请检查到 Cloudflare 的出站网络后重试，或使用本机控制台和 SSH 转发');
      })().catch(async error => { await manager.close(); throw error; }).finally(() => { opening = undefined; });
      return opening;
    },
    close() {
      if (closing) return closing;
      disposed = true; clearTimeout(expiry);
      closing = (async () => {
        await gateway?.close();
        if (alive()) await new Promise(resolve => {
          child.once('close', resolve);
          const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
          child.once('close', () => clearTimeout(timer));
          child.stdin.end(); child.kill('SIGTERM');
        });
        if (directory) await fs.rm(directory, { recursive: true, force: true });
      })();
      return closing;
    },
  };
  return manager;
}
