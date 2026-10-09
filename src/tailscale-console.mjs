import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolveTailscale } from './tailscale-runtime.mjs';
import { createRemoteConsole } from './remote-console.mjs';

const execute = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const SESSION_MS = 30 * 60_000;
const supervisor = fileURLToPath(new URL('./owned-process.mjs', import.meta.url));

export function remoteByDefault(options = {}, env = process.env, platform = process.platform) {
  const mode = options.consoleAccess ?? 'auto';
  return mode === 'tailscale' || mode === 'auto' && (Boolean(env.SSH_CONNECTION || env.SSH_TTY) || platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY);
}

function officialAuthURL(value) {
  for (const candidate of String(value).match(/https:\/\/[^\s<>"']+/g) ?? []) {
    try {
      const url = new URL(candidate.replace(/[),.;]+$/, ''));
      if (['login.tailscale.com', 'console.tailscale.com'].includes(url.hostname) && !url.username && !url.password) return url.href;
    } catch { /* Ignore incomplete output fragments. */ }
  }
}

// Foreground Funnel owns only its own session. Killing it removes that session;
// never reset all Serve/Funnel configuration or log out a user's existing node.
export function createTailscaleConsole(service, options, dataDir, dependencies = {}) {
  const run = dependencies.execute ?? execute;
  const launch = dependencies.spawn ?? spawn;
  const resolve = dependencies.resolve ?? resolveTailscale;
  const makeGateway = dependencies.createGateway ?? createRemoteConsole;
  let binaries, socketDir, daemon, login, funnel, gateway, expiry, init, opening, closing;
  let disposed = false;
  let publicOrigin;
  let port;
  // A relative socket inside our private working directory avoids Unix socket
  // path limits when the configured plugin data directory has a long name.
  const prefixes = () => binaries.isolated ? ['--socket=tailscaled.sock'] : [];
  const cli = async args => {
    try {
      const { stdout } = await run(binaries.cli, [...prefixes(), ...args], { cwd: socketDir, timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true });
      return stdout;
    } catch (error) {
      // NeedsLogin can be a nonzero exit with a valid JSON status document.
      if (args[0] === 'status') {
        try { if (JSON.parse(error.stdout).BackendState) return error.stdout; } catch {}
      }
      throw new Error('无法读取 Tailscale 状态，请检查客户端权限和服务是否运行');
    }
  };
  const alive = child => child && child.exitCode === null && child.signalCode === null && !child.failure;
  const start = (binary, args) => {
    const child = launch(process.execPath, [supervisor, String(process.pid), binary, ...args], { cwd: socketDir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, TS_NO_LOGS_NO_SUPPORT: 'true' } });
    child.output = '';
    const collect = chunk => { child.output = (child.output + chunk.toString()).slice(-16384); };
    child.stdout.on('data', collect); child.stderr.on('data', collect); child.stdin.on('error', () => {});
    child.on('error', () => { child.failure = true; });
    return child;
  };
  const checkOpen = () => { if (disposed) throw new Error('临时通道已关闭，请重新点击远程控制台'); };
  const stopChild = async child => {
    if (!alive(child)) return;
    await new Promise(resolve => {
      child.once('close', resolve);
      const kill = setTimeout(() => child.kill('SIGKILL'), 1500);
      child.once('close', () => clearTimeout(kill));
      child.kill('SIGTERM');
    });
  };
  const manager = {
    async open() {
      checkOpen();
      if (opening) return opening;
      opening = (async () => {
        if (!init) init = (async () => {
          binaries = await resolve(options, dataDir, dependencies);
          for (const key of ['cli', 'daemon']) {
            if (binaries[key] && !path.isAbsolute(binaries[key]) && (binaries[key].includes('/') || binaries[key].includes('\\'))) binaries[key] = path.resolve(binaries[key]);
          }
          checkOpen();
          expiry = setTimeout(() => { void manager.close(); }, dependencies.sessionMs ?? SESSION_MS); expiry.unref?.();
          if (binaries.isolated) {
            const temporary = path.join(dataDir, 'temporary');
            await fs.promises.mkdir(temporary, { recursive: true, mode: 0o700 });
            socketDir = await fs.promises.mkdtemp(path.join(temporary, 'tailscale-'));
            if (disposed) await fs.promises.rm(socketDir, { recursive: true, force: true });
            checkOpen();
            daemon = start(binaries.daemon, ['--tun=userspace-networking', '--state=mem:',
              `--statedir=${socketDir}`, ...prefixes(), '--port=0']);
            daemon.once('close', () => { if (!disposed) void manager.close(); });
            let ready = false;
            for (let i = 0; i < 30; i++) {
              checkOpen();
              if (!alive(daemon)) break;
              try { await cli(['status', '--json']); ready = true; break; } catch { await pause(200); }
            }
            if (!ready) throw new Error('临时 tailscaled 启动失败，请检查系统是否支持 userspace networking');
          }
          gateway = await makeGateway(service, { onClose: () => manager.close() });
          if (disposed) await gateway.close();
          checkOpen();
        })();
        await init;
        checkOpen();
        let status = JSON.parse(await cli(['status', '--json']));
        checkOpen();
        if (status.BackendState !== 'Running') {
          if (!binaries.isolated) throw new Error('现有 Tailscale 已断开，请先连接客户端');
          if (!alive(login)) {
            login = start(binaries.cli, [...prefixes(), 'up', '--accept-dns=false', '--timeout=120s',
              `--hostname=ofm-${crypto.createHash('sha256').update(dataDir).digest('hex').slice(0, 10)}`]);
          }
          for (let i = 0; i < 40; i++) {
            checkOpen();
            status = JSON.parse(await cli(['status', '--json']));
            if (status.BackendState === 'Running') break;
            const url = officialAuthURL(status.AuthURL) || officialAuthURL(login.output);
            if (url) return { url, setup: true, instructions: '请在浏览器授权这个临时 Tailscale 节点；完成后回 Magpie 再次点击“临时远程控制台”。授权过程最多保留 30 分钟。' };
            if (!alive(login)) throw new Error('Tailscale 登录未完成，请重新打开远程控制台');
            await pause(250);
          }
          if (status.BackendState !== 'Running') throw new Error('未取得 Tailscale 授权地址，请检查服务器能否访问 Tailscale');
        }
        if (!alive(funnel)) {
          const existing = JSON.parse(await cli(['funnel', 'status', '--json']));
          checkOpen();
          const occupied = JSON.stringify(existing);
          port = [443, 8443, 10000].find(value => !new RegExp(`(?:"${value}"|:${value}["]|:${value}/)`).test(occupied));
          if (!port) throw new Error('Tailscale 的三个 Funnel 端口均已使用；请先关闭不需要的转发');
          const name = String(status.Self?.DNSName ?? '').replace(/\.$/, '');
          if (!/^[a-z0-9.-]+\.ts\.net$/.test(name)) throw new Error('Tailscale 未提供可用 DNS 名称，请启用 MagicDNS');
          publicOrigin = `https://${name}${port === 443 ? '' : `:${port}`}`;
          gateway.setOrigin(publicOrigin);
          funnel = start(binaries.cli, [...prefixes(), 'funnel', `--https=${port}`, '--yes', gateway.target]);
          funnel.once('close', () => {
            if (!disposed && funnel.output.includes('Available on the internet:')) void manager.close();
          });
        }
        for (let i = 0; i < 60; i++) {
          checkOpen();
          if (alive(funnel) && funnel.output.includes('Available on the internet:')) {
            return { url: gateway.ticket(), setup: false,
              instructions: '临时 HTTPS 管理通道已开启，最多保留 30 分钟；完成渠道登录后点击页面顶部“结束远程访问”。一次性链接十分钟有效。公网 DNS 首次生效可能需要几分钟。' };
          }
          const authorization = officialAuthURL(funnel.output);
          if (authorization) return { url: authorization, setup: true,
            instructions: '请在浏览器允许 Tailscale Funnel/HTTPS；完成后回 Magpie 再次点击“临时远程控制台”。此授权由 Tailscale 处理。' };
          if (!alive(funnel)) throw new Error('Tailscale Funnel 启动失败；请检查账户权限、HTTPS 和 Funnel 设置');
          await pause(250);
        }
        throw new Error('Funnel 尚未就绪，请检查 Tailscale HTTPS/Funnel 权限后重试');
      })().catch(async error => { await manager.close(); throw error; }).finally(() => { opening = undefined; });
      return opening;
    },
    get closed() { return disposed; },
    close() {
      if (closing) return closing;
      disposed = true; clearTimeout(expiry);
      closing = (async () => {
        // Close the gateway first, so failed CLI cleanup cannot leave management reachable.
        await gateway?.close();
        await stopChild(funnel);
        await stopChild(login);
        if (binaries?.isolated && socketDir) {
          try { await run(binaries.cli, [...prefixes(), 'logout'], { timeout: 1000, maxBuffer: 16384 }); } catch {}
        }
        await stopChild(daemon);
        if (socketDir) await fs.promises.rm(socketDir, { recursive: true, force: true });
      })();
      return closing;
    },
  };
  return manager;
}
