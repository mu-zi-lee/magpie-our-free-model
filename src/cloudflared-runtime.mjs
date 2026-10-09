import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const CLOUDFLARED_VERSION = '2026.10.0';
// GitHub's official release asset SHA-256 values; Darwin executable hashes were
// computed only after verifying those official archives. Never run before hashing.
const releases = {
  'linux-x64': ['linux-amd64', 'd33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db', 40129756],
  'linux-arm64': ['linux-arm64', 'e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08', 37687584],
  'darwin-x64': ['darwin-amd64.tgz', '903845b81828c8cb3c5d13d816a2de71c06a3da5785469df8eb0e1b736d92f9f', 21741581, '0560c9ab7281ac3f746055323623ed23bc0405b6dab9400474020cba33a978da'],
  'darwin-arm64': ['darwin-arm64.tgz', 'a2f79ff7b9420aa537d74af239f376da170bbabeb529aec416002adac6a72e70', 19809074, '72edfd3eea463aef4d5cb89e2e209cecb048cc756c2b01915de2e0ad7cb39830'],
  'win32-x64': ['windows-amd64.exe', '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c', 55365048],
};
const installs = new Map();
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function cloudflaredRelease(platform = process.platform, arch = process.arch) {
  const release = releases[`${platform}-${arch}`];
  if (!release) throw new Error(`Cloudflare 自动下载不支持 ${platform}/${arch}；请安装官方 cloudflared 并设置 managed.cloudflaredPath`);
  const [asset, hash, bytes, binaryHash = hash] = release;
  return { target: `${platform}-${arch}`, hash, bytes, binaryHash, archive: asset.endsWith('.tgz'),
    executable: platform === 'win32' ? 'cloudflared.exe' : 'cloudflared',
    url: `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-${asset}` };
}

async function safeParents(directory, boundary) {
  let current = path.resolve(directory);
  while (true) {
    try { if (!(await fs.lstat(current)).isDirectory()) throw new Error('Cloudflare 缓存路径不能是符号链接或文件'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (current === boundary || parent === current) return;
    current = parent;
  }
}

export async function probeCloudflared(binary, run = execute) {
  try {
    const { stdout } = await run(binary, ['--version'], { timeout: 5000, maxBuffer: 16384, windowsHide: true });
    const version = stdout.match(/cloudflared version (\d{4}\.\d+\.\d+)\b/)?.[1];
    return version && Number(version.split('.')[0]) >= 2024 ? version : undefined;
  } catch { return undefined; }
}

async function download(release, fetcher) {
  let url = release.url;
  const signal = AbortSignal.timeout(90000);
  // GitHub assets redirect to its signed release-assets host. Bound redirects
  // and validate every hop; the pinned digest remains authoritative.
  for (let hop = 0; hop < 4; hop++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
        !(url === release.url || parsed.hostname === 'release-assets.githubusercontent.com')) throw new Error('Cloudflare 下载返回了非官方地址');
    let response;
    try { response = await fetcher(url, { redirect: 'manual', signal }); }
    catch { throw new Error('Cloudflare 下载失败，请检查服务器能否访问 GitHub 发行文件'); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw new Error('Cloudflare 下载重定向无效');
      url = new URL(location, url).href; continue;
    }
    if (!response.ok || !response.body) throw new Error(`Cloudflare 下载失败（HTTP ${response.status}）`);
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > release.bytes) throw new Error('Cloudflare 下载超过固定大小限制');
        chunks.push(Buffer.from(value));
      }
      const bytes = Buffer.concat(chunks);
      if (size !== release.bytes || digest(bytes) !== release.hash) throw new Error('Cloudflare SHA-256 校验失败，未执行下载文件');
      return bytes;
    } finally { await reader.cancel().catch(() => {}); }
  }
  throw new Error('Cloudflare 下载重定向过多');
}

export async function installCloudflared(dataDir, dependencies = {}) {
  const release = dependencies.release ?? cloudflaredRelease();
  const run = dependencies.execute ?? execute;
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const cache = path.join(dataDir, 'runtime');
  const destination = path.join(cache, `cloudflared-${CLOUDFLARED_VERSION}-${release.target}`);
  const binary = directory => path.join(directory, release.executable);
  const usable = async directory => {
    try {
      await safeParents(directory, path.resolve(dataDir));
      const stat = await fs.lstat(binary(directory));
      return stat.isFile() && stat.size <= 100 * 1024 * 1024 && digest(await fs.readFile(binary(directory))) === release.binaryHash &&
        await probeCloudflared(binary(directory), run) === CLOUDFLARED_VERSION;
    } catch { return false; }
  };
  if (installs.has(destination)) return installs.get(destination);
  const promise = (async () => {
    if (await usable(destination)) return binary(destination);
    await safeParents(cache, path.resolve(dataDir));
    await fs.mkdir(cache, { recursive: true, mode: 0o700 });
    const stage = await fs.mkdtemp(path.join(cache, '.cloudflared-install-'));
    try {
      const bytes = await download(release, fetcher);
      const extracted = path.join(stage, 'extracted'); await fs.mkdir(extracted, { mode: 0o700 });
      if (release.archive) {
        const archive = path.join(stage, 'release.tgz'); await fs.writeFile(archive, bytes, { mode: 0o600 });
        try { await run('tar', ['-xzf', archive, '--no-same-owner', '--no-same-permissions', '-C', extracted, 'cloudflared'], { timeout: 30000, maxBuffer: 16384 }); }
        catch { throw new Error('Cloudflare 解压失败，请检查 tar 和数据目录权限'); }
      } else await fs.writeFile(binary(extracted), bytes, { mode: 0o700 });
      await fs.chmod(binary(extracted), 0o700);
      if (!await usable(extracted)) throw new Error('下载的 Cloudflare 客户端无法运行或完整性校验失败');
      await fs.copyFile(new URL('../vendor/cloudflared/LICENSE', import.meta.url), path.join(extracted, 'LICENSE'));
      await fs.chmod(path.join(extracted, 'LICENSE'), 0o600);
      if (!await usable(destination)) {
        await fs.rm(destination, { recursive: true, force: true });
        try { await fs.rename(extracted, destination); }
        catch { if (!await usable(destination)) throw new Error('Cloudflare 缓存无法写入，请检查数据目录权限'); }
      }
      return binary(destination);
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
  })().finally(() => installs.delete(destination));
  installs.set(destination, promise);
  return promise;
}

export async function resolveCloudflared(options, dataDir, dependencies = {}) {
  const binary = options.cloudflaredPath || 'cloudflared';
  if (await probeCloudflared(binary, dependencies.execute ?? execute)) return binary;
  if (options.cloudflaredPath) throw new Error('指定的 managed.cloudflaredPath 不可用；需要官方 cloudflared 2024+');
  if (options.autoInstallCloudflared === false) throw new Error('未找到 cloudflared，请安装客户端或启用 managed.autoInstallCloudflared');
  return installCloudflared(dataDir, dependencies);
}
