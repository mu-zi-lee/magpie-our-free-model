import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const NODE_VERSION = '24.21.0';
// Pinned to the official release SHASUMS256.txt; no mirrors or install scripts.
// https://nodejs.org/download/release/v24.21.0/SHASUMS256.txt
const hashes = {
  'linux-x64': '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff',
  'linux-x64-musl': '3d63405fc65a0d2d2976c1f0bc2fd27bb0bd07212469e705aac3f03ae5ab4c9c',
  'linux-arm64': '724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5',
  'darwin-x64': '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097',
  'darwin-arm64': 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057',
  'win32-x64': 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32',
  'win32-arm64': 'dff59da18b6ffe1bf1ca99e1d2af4906080c481740619f5b5098c0fca28bd9b7',
};
const installs = new Map();

export function nodeRelease(platform = process.platform, arch = process.arch,
  musl = platform === 'linux' && fs.existsSync('/etc/alpine-release')) {
  const target = `${platform}-${arch}${musl ? '-musl' : ''}`;
  if (!hashes[target]) throw new Error(`暂不支持自动安装 Node：${target}；请设置 managed.nodePath`);
  const name = platform === 'win32' ? `win-${arch}/node.exe` : `node-v${NODE_VERSION}-${target}.tar.gz`;
  return { target, name, hash: hashes[target], windows: platform === 'win32',
    url: `https://nodejs.org/download/release/v${NODE_VERSION}/${name}` };
}

export async function probeNode(binary, env, run = execute) {
  try {
    const result = await run(binary, ['-p', 'JSON.stringify({version:process.versions.node,bun:!!process.versions.bun})'],
      { env, timeout: 5000, windowsHide: true });
    const value = JSON.parse(result.stdout);
    const [major, minor] = String(value.version).split('.').map(Number);
    return !value.bun && (major === 22 && minor >= 19 || major >= 24) ? value.version : undefined;
  } catch { return undefined; }
}

async function download(release, filename, fetcher) {
  const response = await fetcher(release.url, { redirect: 'error', signal: AbortSignal.timeout(90000) });
  if (!response.ok || !response.body) throw new Error(`Node 下载失败（HTTP ${response.status}）`);
  const reader = response.body.getReader();
  const file = await fs.promises.open(filename, 'wx', 0o600);
  const hash = crypto.createHash('sha256');
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 120 * 1024 * 1024) throw new Error('Node 下载超出大小限制');
      hash.update(value);
      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await file.write(value, offset, value.byteLength - offset);
        offset += bytesWritten;
      }
    }
    if (hash.digest('hex') !== release.hash) throw new Error('Node SHA-256 校验失败，未执行下载文件');
  } finally {
    await reader.cancel().catch(() => {});
    await file.close();
  }
}

// Dependencies are injected only by tests, never from a plugin URL/config option.
export async function installNode(dataDir, env, dependencies = {}) {
  const release = dependencies.release ?? nodeRelease();
  const run = dependencies.execute ?? execute;
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const cache = path.join(dataDir, 'runtime');
  const destination = path.join(cache, `node-v${NODE_VERSION}-${release.target}`);
  const binary = path.join(destination, release.windows ? 'node.exe' : 'bin/node');
  if (await probeNode(binary, env, run) === NODE_VERSION) return binary;
  if (installs.has(destination)) return installs.get(destination);
  const promise = (async () => {
    await fs.promises.mkdir(cache, { recursive: true, mode: 0o700 });
    const stage = await fs.promises.mkdtemp(path.join(cache, '.node-install-'));
    try {
      const archive = path.join(stage, release.windows ? 'node.exe' : 'node.tar.gz');
      await download(release, archive, fetcher);
      const extracted = path.join(stage, 'extracted');
      await fs.promises.mkdir(extracted, { mode: 0o700 });
      if (release.windows) await fs.promises.rename(archive, path.join(extracted, 'node.exe'));
      else {
        // Retain the official LICENSE and third-party notices in the archive.
        try {
          await run('tar', ['-xzf', archive, '--no-same-owner', '--no-same-permissions', '--strip-components=1', '-C', extracted],
            { env, timeout: 60000, maxBuffer: 256 * 1024, windowsHide: true });
        } catch {
          throw new Error('Node 解压失败；请检查 tar 支持 .tar.gz 且数据目录可写');
        }
      }
      const stagedBinary = path.join(extracted, release.windows ? 'node.exe' : 'bin/node');
      if (await probeNode(stagedBinary, env, run) !== NODE_VERSION) {
        throw new Error('下载的 Node 无法在当前系统运行；请检查系统架构/libc 或设置 managed.nodePath');
      }
      // Another host may have completed the same installation meanwhile.
      if (await probeNode(binary, env, run) === NODE_VERSION) return binary;
      try { await fs.promises.rename(extracted, destination); }
      catch (error) {
        if (await probeNode(binary, env, run) !== NODE_VERSION) {
          throw new Error(`Node 缓存无法写入；请检查或清理 ${destination} 后重试（${error.code ?? 'unknown'}）`);
        }
      }
      return binary;
    } finally { await fs.promises.rm(stage, { recursive: true, force: true }); }
  })().finally(() => installs.delete(destination));
  installs.set(destination, promise);
  return promise;
}

export async function resolveNodeRuntime(options, dataDir, env, dependencies = {}) {
  const run = dependencies.execute ?? execute;
  const candidate = options.nodePath || (process.versions.bun ? 'node' : process.execPath);
  if (await probeNode(candidate, env, run)) return candidate;
  if (options.nodePath || options.autoInstallNode === false) {
    throw new Error('需要 Node.js 22.19+ 或 24+；请检查 managed.nodePath，或启用 managed.autoInstallNode 自动安装');
  }
  try { return await installNode(dataDir, env, dependencies); }
  catch (error) {
    throw new Error(`自动安装 Node 失败：${error.message}。请确认能访问 nodejs.org、数据目录可写及系统有 tar；修复后重试，或设置 managed.nodePath。`);
  }
}
