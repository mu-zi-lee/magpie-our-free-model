import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { applyWorkbuddyConversationPatch, workbuddyConversationPatched } from './workbuddy-conversation-patch.mjs';

export const CHANNEL_COMMIT = 'e9c4b70d913116284692d7b206a63f39ad6fe8cc';
// Load the complete upstream channel bundle unchanged, including native login
// defaults. Downloaded modules stay outside the public plugin distribution.
export const CHANNEL_FILES = Object.freeze([
  { path: 'LICENSE', bytes: 1068, sha256: '4d5f97c83545b2159926df06d3210a266d2b7f900e27f7b3e8e576caf753e828' },
  { path: 'packages/standalone/channels/business.mjs', bytes: 2881152, sha256: '9793bea5c4ce51fb93fbba2dfe3691588ac050ed4727646c99d11977d2a8b457' },
  { path: 'packages/standalone/channels/contracts.mjs', bytes: 1598, sha256: '999c203ac49b2d77a4dcff750476f3977615ef208ffc3d4d073caea39c72dd33' },
  { path: 'vendor/channel-pack/LICENSE', bytes: 1060, sha256: '0f62f49c7c75f82fe6d88eebfbdd1b647a89e42ab765ee470d0496af40ec0b25' },
  { path: 'vendor/channel-pack/NOTICE.md', bytes: 3542, sha256: 'a6cad78e702a992511f24863350eef53bda78773c868d933f3dc44dbb5931ab9' },
  { path: 'vendor/channel-pack/qoder-auth-wasm.wasm', bytes: 298606, sha256: '6419471effa631519def7797d76d7ede38b9fcfa9a83c2148c8ef5d43355b43d' },
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

// Refuse symlinked cache parents before reading, writing or importing code.
async function regularParents(directory, boundary) {
  let current = path.resolve(directory);
  while (true) {
    try { if (!(await fs.lstat(current)).isDirectory()) throw failure('path', '原渠道包缓存路径不能是符号链接或文件。'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current || current === boundary) return;
    current = parent;
  }
}

async function valid(directory, files, boundary) {
  try {
    if (!(await fs.lstat(directory)).isDirectory()) return false;

    for (const file of [...files, { path: 'package.json', sha256: digest(PACKAGE) }]) {
      const target = path.join(directory, file.path);
      await regularParents(path.dirname(target), boundary);
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.size !== (file.bytes ?? Buffer.byteLength(PACKAGE)) || digest(await fs.readFile(target)) !== file.sha256) return false;
    }
    return true;
  } catch { return false; }
}

async function download(file, fetcher, signal) {
  const url = `https://raw.githubusercontent.com/Ebony-Vinyl/dsh-our-free-model/${CHANNEL_COMMIT}/${file.path}`;
  let response;
  try { response = await fetcher(url, { redirect: 'error', signal }); }
  catch { throw failure('download', '原渠道包下载失败；请确认服务器能访问 raw.githubusercontent.com，修复后重启 Magpie。'); }
  if (!response.ok || !response.body) throw failure('download', `原渠道包下载失败（HTTP ${response.status}）；修复网络后重启 Magpie。`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > file.bytes) throw failure('integrity', '原渠道包超过大小限制，未加载下载模块。');
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw failure('integrity', '原渠道包 SHA-256 校验失败，未加载下载模块；请检查网络后重启 Magpie。');
    return bytes;
  } catch (error) {
    if (['integrity', 'download'].includes(error.code)) throw error;
    throw failure('download', '原渠道包下载中断；修复网络后重启 Magpie。');
  } finally { await reader.cancel().catch(() => {}); }
}

// Tests may inject files/fetch; plugin configuration cannot change the origin,
// commit or hashes. Native login defaults stay inside the unchanged source.
export async function installChannelSource(dataDir, dependencies = {}) {
  const files = dependencies.files ?? CHANNEL_FILES;
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const cache = path.join(dataDir, 'runtime');
  const destination = path.join(cache, `channels-${CHANNEL_COMMIT}`);
  if (installs.has(destination)) return installs.get(destination);
  const promise = (async () => {
    if (await valid(destination, files, path.resolve(dataDir))) return destination;
    await regularParents(cache, path.resolve(dataDir));
    await fs.mkdir(cache, { recursive: true, mode: 0o700 });
    await regularParents(cache, path.resolve(dataDir));
    const stage = await fs.mkdtemp(path.join(cache, '.channels-install-'));
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
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
      if (!await valid(stage, files, path.resolve(dataDir))) throw failure('integrity', '原渠道包缓存校验失败，未加载下载模块。');
      if (await valid(destination, files, path.resolve(dataDir))) return destination;
      // Only repair this installer's versioned cache, never a selected source.
      await fs.rm(destination, { recursive: true, force: true });
      try { await fs.rename(stage, destination); }
      catch (error) { if (!await valid(destination, files, path.resolve(dataDir))) throw error; }
      return destination;
    } finally { controller.abort(); await fs.rm(stage, { recursive: true, force: true }); }
  })().finally(() => installs.delete(destination));
  installs.set(destination, promise);
  return promise;
}

// The verified cache keeps `business.mjs` byte-for-byte pristine so the
// download SHA-256 pin in CHANNEL_FILES still proves what was fetched from the
// pinned upstream commit. When that bundle predates the WorkBuddy INTL
// conversation-gate fix (upstream PR #377), the runtime loads a patched sibling
// written into the SAME directory, so the bundle's `import.meta.url`-relative
// lookups (notably qoder-auth-wasm.wasm) resolve exactly as they do for the
// pristine file. Once the pin moves past the merge, the bundle already carries
// the fix and the pristine path is used unchanged — no coordinated revert here.
//
// A bundle whose anchors no longer match falls back to the pristine file rather
// than throwing: one lane's optional repair must not take down the other twelve.
// WorkBuddy then stays exactly as broken as before this patch. The warning goes
// to stderr because the managed runner's stdout carries the JSON ready protocol;
// `dependencies.logger` lets callers and tests capture it.
const GATED_BASENAME = 'business.workbuddy-gated.mjs';

async function gatedBusinessPath(directory, logger) {
  const channelsDir = path.join(directory, 'packages', 'standalone', 'channels');
  const pristine = path.join(channelsDir, 'business.mjs');
  const warn = message => (logger?.warn ? logger.warn(message) : process.stderr.write(`[magpie-our-free-model] ${message}\n`));
  let patched;
  try {
    const source = await fs.readFile(pristine, 'utf8');
    if (workbuddyConversationPatched(source)) return pristine;
    patched = applyWorkbuddyConversationPatch(source);
  } catch (error) {
    warn(`WorkBuddy 会话头补丁未应用，渠道包按原样加载：${error?.message ?? error}`);
    return pristine;
  }
  await regularParents(channelsDir, path.resolve(directory));
  const target = path.join(channelsDir, GATED_BASENAME);
  const bytes = Buffer.from(patched, 'utf8');
  let current;
  try { current = await fs.readFile(target); } catch { current = undefined; }
  if (current === undefined || !current.equals(bytes)) {
    const stage = `${target}.${process.pid}.tmp`;
    try { await fs.writeFile(stage, bytes, { flag: 'wx', mode: 0o600 }); await fs.rename(stage, target); }
    catch (error) {
      await fs.rm(stage, { force: true }).catch(() => {});
      logger?.warn?.(`WorkBuddy 会话头补丁写入失败，渠道包按原样加载：${error?.message ?? error}`);
      return pristine;
    }
  }
  return target;
}

export async function channelBusinessUrl(settings, dependencies = {}) {
  // Explicit offline/test mode uses the packaged bundle without login defaults.
  if (settings.autoInstallChannels === false) return undefined;
  try {
    const directory = await installChannelSource(settings.dataDir, dependencies);
    return pathToFileURL(await gatedBusinessPath(directory, dependencies.logger)).href;
  } catch (error) {
    throw new Error(trustedFailures.has(error) ? error.message : '原渠道包安装失败；请检查数据目录权限与网络，然后重启 Magpie。');
  }
}
