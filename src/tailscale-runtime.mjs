import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const TAILSCALE_VERSION = '1.102.4';
// Official static Linux releases, verified against dl.tailscale.com/stable/*.sha256.
const releases = {
  x64: ['amd64', '50748df1045e60b5b695f19f4c56b0da36c019948b440fb456b6584a50f0d8b9'],
  arm64: ['arm64', '9dd1e6a592a014bbaea0103167ffe299adeda4ba14e078ce9c2895364f6c4c3f'],
};
const installs = new Map();

export function tailscaleRelease(platform = process.platform, arch = process.arch) {
  if (platform !== 'linux' || !releases[arch]) {
    throw new Error(`Tailscale 自动下载支持 Linux x64/arm64；当前为 ${platform}/${arch}，请先安装官方 Tailscale 客户端`);
  }
  const [target, hash] = releases[arch];
  return { target, hash, url: `https://dl.tailscale.com/stable/tailscale_${TAILSCALE_VERSION}_${target}.tgz` };
}

export async function probeTailscale(binary, run = execute) {
  try {
    const { stdout } = await run(binary, ['version'], { timeout: 5000, maxBuffer: 16384, windowsHide: true });
    const version = stdout.trim().split(/\s/)[0];
    const [major, minor] = version.split('.').map(Number);
    return major > 1 || major === 1 && minor >= 52 ? version : undefined;
  } catch { return undefined; }
}

export async function installTailscale(dataDir, dependencies = {}) {
  const release = dependencies.release ?? tailscaleRelease();
  const run = dependencies.execute ?? execute;
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const cache = path.join(dataDir, 'runtime');
  const destination = path.join(cache, `tailscale-${TAILSCALE_VERSION}-${release.target}`);
  const pair = directory => ({ cli: path.join(directory, 'tailscale'), daemon: path.join(directory, 'tailscaled') });
  const usable = async directory => {
    const binaries = pair(directory);
    if (await probeTailscale(binaries.cli, run) !== TAILSCALE_VERSION) return false;
    try {
      const { stdout } = await run(binaries.daemon, ['--version'], { timeout: 5000, maxBuffer: 16384 });
      return stdout.trim().split(/\s/)[0] === TAILSCALE_VERSION;
    } catch { return false; }
  };
  if (await usable(destination)) return pair(destination);
  if (installs.has(destination)) return installs.get(destination);
  const pending = (async () => {
    await fs.promises.mkdir(cache, { recursive: true, mode: 0o700 });
    const stage = await fs.promises.mkdtemp(path.join(cache, '.tailscale-install-'));
    try {
      const response = await fetcher(release.url, { redirect: 'error', signal: AbortSignal.timeout(90000) });
      if (!response.ok || !response.body) throw new Error(`Tailscale 下载失败（HTTP ${response.status}）`);
      const reader = response.body.getReader();
      const archive = path.join(stage, 'tailscale.tgz');
      const file = await fs.promises.open(archive, 'wx', 0o600);
      const hash = crypto.createHash('sha256');
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 150 * 1024 * 1024) throw new Error('Tailscale 下载超出大小限制');
          hash.update(value);
          let offset = 0;
          while (offset < value.byteLength) offset += (await file.write(value, offset, value.byteLength - offset)).bytesWritten;
        }
        if (hash.digest('hex') !== release.hash) throw new Error('Tailscale SHA-256 校验失败，未执行下载文件');
      } finally { await reader.cancel().catch(() => {}); await file.close(); }
      const extracted = path.join(stage, 'extracted');
      await fs.promises.mkdir(extracted, { mode: 0o700 });
      try {
        await run('tar', ['-xzf', archive, '--no-same-owner', '--no-same-permissions', '--strip-components=1', '-C', extracted],
          { timeout: 60000, maxBuffer: 256 * 1024 });
      } catch { throw new Error('Tailscale 解压失败；请检查 tar 和数据目录权限'); }
      if (!await usable(extracted)) throw new Error('下载的 Tailscale 无法在当前系统运行');
      if (!await usable(destination)) {
        try { await fs.promises.rename(extracted, destination); }
        catch (error) { if (!await usable(destination)) throw new Error(`Tailscale 缓存无法写入（${error.code ?? 'unknown'}）`); }
      }
      return pair(destination);
    } finally { await fs.promises.rm(stage, { recursive: true, force: true }); }
  })().finally(() => installs.delete(destination));
  installs.set(destination, pending);
  return pending;
}

export async function resolveTailscale(options, dataDir, dependencies = {}) {
  const run = dependencies.execute ?? execute;
  const platform = dependencies.platform ?? process.platform;
  const cli = options.tailscalePath || 'tailscale';
  if (await probeTailscale(cli, run)) {
    try {
      const { stdout } = await run(cli, ['status', '--json'], { timeout: 5000, maxBuffer: 1024 * 1024 });
      if (JSON.parse(stdout).BackendState === 'Running') return { cli, isolated: false };
    } catch { /* An installed CLI may have no daemon. Linux uses its own daemon. */ }
    if (platform === 'linux') {
      const daemon = options.tailscaledPath || (path.isAbsolute(cli) ? path.join(path.dirname(cli), 'tailscaled') : 'tailscaled');
      try {
        await run(daemon, ['--version'], { timeout: 5000, maxBuffer: 16384 });
        return { cli, daemon, isolated: true };
      } catch {
        if (options.tailscaledPath) throw new Error('指定的 managed.tailscaledPath 不可用');
        /* Download a matched pair below. */
      }
    }
    if (platform !== 'linux') throw new Error('请先在 Tailscale 客户端登录并连接，再重新打开远程控制台');
  } else if (options.tailscalePath) throw new Error('指定的 managed.tailscalePath 不可用；需要 Tailscale 1.52+');
  if (options.autoInstallTailscale === false) throw new Error('未找到可用 Tailscale；请安装客户端，或启用 managed.autoInstallTailscale');
  return { ...await installTailscale(dataDir, dependencies), isolated: true };
}
