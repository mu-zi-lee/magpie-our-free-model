import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const EAC_COMMIT = 'f8974369c5904858c696b520d8b9b82ad4425f78';
// Original standalone entry point and its dependencies, unchanged. The shared
// gateway material stays in the user's private runtime cache, outside the package.
export const EAC_FILES = Object.freeze([
  { path: 'src/vault.js', sha256: '6f9d5dce4af5dc504991af32b46cd3b76dd0c587fcacb35cc6245a518201c021' },
  { path: 'src/vault-data.js', sha256: '4db83a43440a0bddb27e5dd0ef9ecd911ed24d96b7e29f9f940ee20a55cd1147' },
  { path: 'src/vault-anchor.js', sha256: '28a156e0da6853e9b72b840637f79ea1a8e005bf7e432878a98ee8cb3eefe897' },
  { path: 'LICENSE', sha256: '4d5f97c83545b2159926df06d3210a266d2b7f900e27f7b3e8e576caf753e828' },
].map(Object.freeze));
const PACKAGE = '{"private":true,"type":"module"}\n';
const installs = new Map();
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const trustedFailures = new WeakSet();
const failure = (code, message) => {
  const error = Object.assign(new Error(message), { code });
  trustedFailures.add(error);
  return error;
};

async function valid(directory, files) {
  try {
    if (!(await fs.lstat(directory)).isDirectory()) return false;
    if ((await fs.lstat(path.join(directory, 'src'))).isSymbolicLink()) return false;
    for (const file of [...files, { path: 'package.json', sha256: digest(PACKAGE) }]) {
      const target = path.join(directory, file.path);
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.size > 32768 || digest(await fs.readFile(target)) !== file.sha256) return false;
    }
    return true;
  } catch { return false; }
}

async function download(file, fetcher, signal) {
  const url = `https://raw.githubusercontent.com/Ebony-Vinyl/dsh-our-free-model/${EAC_COMMIT}/${file.path}`;
  let response;
  try { response = await fetcher(url, { redirect: 'error', signal }); }
  catch { throw failure('download', 'EAC 来源下载失败；请确认服务器能访问 raw.githubusercontent.com，修复后重启 Magpie。'); }
  if (!response.ok || !response.body) throw failure('download', `EAC 来源下载失败（HTTP ${response.status}）；修复网络后重启 Magpie。`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) throw failure('integrity', 'EAC 来源超过大小限制，未加载下载模块。');
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks);
    if (digest(bytes) !== file.sha256) throw failure('integrity', 'EAC 来源 SHA-256 校验失败，未加载下载模块；请检查网络后重启 Magpie。');
    return bytes;
  } catch (error) {
    if (['integrity', 'download'].includes(error.code)) throw error;
    throw failure('download', 'EAC 来源下载中断；修复网络后重启 Magpie。');
  } finally { await reader.cancel().catch(() => {}); }
}

// Tests may inject files/fetch; plugin configuration cannot change the origin,
// commit, hashes or importer. No decrypted credential is written to disk.
export async function installEacSource(dataDir, dependencies = {}) {
  const files = dependencies.files ?? EAC_FILES;
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const cache = path.join(dataDir, 'runtime');
  const destination = path.join(cache, `eac-${EAC_COMMIT}`);
  if (installs.has(destination)) return installs.get(destination);
  const promise = (async () => {
    if (await valid(destination, files)) return destination;
    await fs.mkdir(cache, { recursive: true, mode: 0o700 });
    const stage = await fs.mkdtemp(path.join(cache, '.eac-install-'));
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
    try {
      const results = await Promise.allSettled(files.map(async file => {
        try {
          const bytes = await download(file, fetcher, signal);
          const target = path.join(stage, file.path);
          await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
          await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
        } catch (error) { controller.abort(); throw error; }
      }));
      // Wait for every writer before removing the stage, including aborted ones.
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw errors.find(error => error.code === 'integrity') ?? errors[0];
      await fs.writeFile(path.join(stage, 'package.json'), PACKAGE, { mode: 0o600 });
      if (!await valid(stage, files)) throw failure('integrity', 'EAC 来源缓存校验失败，未加载下载模块。');
      if (await valid(destination, files)) return destination;
      // Only repair this installer's versioned cache, never a selected source.
      await fs.rm(destination, { recursive: true, force: true });
      try { await fs.rename(stage, destination); }
      catch (error) { if (!await valid(destination, files)) throw error; }
      return destination;
    } finally { controller.abort(); await fs.rm(stage, { recursive: true, force: true }); }
  })().finally(() => installs.delete(destination));
  installs.set(destination, promise);
  return promise;
}

export async function loadEacSource(settings, dependencies = {}) {
  const source = settings.eacSourceDir ? 'local' : 'download';
  if (!settings.eacSourceDir && settings.autoInstallEac === false) {
    return { credentialOf: () => null, setup: { state: 'disabled', message: 'EAC 自动安装已关闭；启用 managed.autoInstallEac 或配置 managed.eacSourceDir 后重启 Magpie。' } };
  }
  try {
    const directory = settings.eacSourceDir ?? await installEacSource(settings.dataDir, dependencies);
    const original = await (dependencies.importModule ?? (url => import(url)))(pathToFileURL(path.join(directory, 'src/vault.js')).href);
    if (typeof original.openSeal !== 'function') throw failure('module', 'EAC 来源缺少原项目的 openSeal 入口。');
    // Use the same entry point as upstream standalone, without impersonating a
    // DSH host. GitHub login, Star checks and request signing stay upstream-owned.
    const lane = original.openSeal();
    const url = new URL(lane?.base);
    const validMode = lane?.mode === 'worker' && typeof lane.signingSecret === 'string' && lane.signingSecret.length >= 32 ||
      source === 'local' && lane?.mode === 'direct' && typeof lane.apiKey === 'string' && lane.apiKey.length >= 20;
    const validUrl = url.protocol === 'https:' || source === 'local' && url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
    if (!validMode || !validUrl || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/v1')) {
      throw failure('module', 'EAC 来源未提供有效的原项目签名网关；请检查来源版本后重启 Magpie。');
    }
    return { credentialOf: original.openSeal, setup: { state: 'ready', source, ...source === 'download' ? { commit: EAC_COMMIT } : {} } };
  } catch (error) {
    // Imported user modules may throw secrets in their messages. Never echo them
    // into RPC, browser responses or logs; optional EAC failure keeps free pools up.
    const message = trustedFailures.has(error) ? error.message
      : source === 'local' ? 'EAC 本机来源加载失败；请检查 managed.eacSourceDir 下的完整原项目模块与依赖，然后重启 Magpie。'
      : 'EAC 来源安装或加载失败；请检查数据目录权限与网络，然后重启 Magpie。';
    return { credentialOf: () => null, setup: { state: 'failed', source, message } };
  }
}
