import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function removeEmbeddedOAuthDefaults(directory) {
  const file = 'packages/standalone/channels/business.mjs';
  const target = path.join(directory, file);
  const original = fs.readFileSync(target, 'utf8');
  let updated = original;
  for (const name of ['ID', 'SECRET']) {
    const definition = new RegExp(`var GEMINI_DEFAULT_CLIENT_${name} = "[^"\\n]*";`, 'g');
    if ((updated.match(definition) ?? []).length !== 1) throw new Error('Upstream Google definition changed; review the patch');
    updated = updated.replace(definition, `var GEMINI_DEFAULT_CLIENT_${name} = "";`);
    const existing = `return fromEnv !== void 0 && fromEnv !== "" ? fromEnv : GEMINI_DEFAULT_CLIENT_${name};`;
    if (!updated.includes(existing)) throw new Error('Upstream Google override changed; review the patch');
    updated = updated.replace(existing, `if (!fromEnv) throw new Error("Gemini 需要自己的 Google OAuth 客户端配置；请参考本插件 README 的 Gemini 配置说明。");\n  return fromEnv;`);
  }
  updated = removeEmbeddedWechatDefault(updated);
  fs.writeFileSync(target, updated);
  const digest = content => crypto.createHash('sha256').update(content).digest('hex');
  return { path: file, originalSha256: digest(original), sha256: digest(updated),
    reason: 'Remove bundled Google OAuth defaults and Loomy WeChat App ID; require private local configuration. Google uses existing environment overrides; Loomy uses OFM_LOOMY_WECHAT_APP_ID.' };
}

export function removeEmbeddedWechatDefault(source) {
  const definition = /var LOOMY_WECHAT_APP_ID = "[^"\n]*";/g;
  if ((source.match(definition) ?? []).length !== 1) throw new Error('Upstream WeChat definition changed; review the patch');
  const start = 'function buildLoomyWechatAuthUrl(state) {';
  if (!source.includes(start)) throw new Error('Upstream WeChat URL builder changed; review the patch');
  return source.replace(definition, 'var LOOMY_WECHAT_APP_ID = "";')
    .replace(start, `${start}\n  const appId = process.env.OFM_LOOMY_WECHAT_APP_ID?.trim();\n  if (!appId) throw new Error("Loomy 微信扫码需要本机 App ID 配置；请参考 Magpie 插件 README 的 Loomy 配置说明。");`)
    .replace('encodeURIComponent(LOOMY_WECHAT_APP_ID)', 'encodeURIComponent(appId)');
}

export function externalizeEacCredentials(directory) {
  const adaptations = [];
  const digest = content => crypto.createHash('sha256').update(content).digest('hex');
  const replace = (file, content, reason) => {
    const target = path.join(directory, file);
    const original = fs.readFileSync(target);
    fs.writeFileSync(target, content);
    adaptations.push({ path: file, originalSha256: digest(original), sha256: digest(content), reason });
  };
  replace('src/vault.js', '// Magpie distribution: no EAC credential material is shipped.\nexport function openSeal() { return null; }\nexport function unlockSealedLane() { return null; }\n',
    'Replace the upstream vault with an empty stub; EAC material is supplied locally by the user only.');
  for (const file of ['src/vault-data.js', 'src/vault-anchor.js']) fs.unlinkSync(path.join(directory, file));
  const serviceFile = 'packages/standalone/service.mjs';
  const original = fs.readFileSync(path.join(directory, serviceFile), 'utf8');
  const updated = original.replace('logger = console, refresh = true, probe,', 'logger = console, refresh = true, probe, eacCredential,')
    .replace('dataDir,\n      onSaved:', 'dataDir, credentialOf: eacCredential,\n      onSaved:');
  if (updated === original || !updated.includes('credentialOf: eacCredential')) throw new Error('Standalone EAC integration point changed');
  replace(serviceFile, updated, 'Allow a user-selected local upstream EAC credential function; preserve server authorization and login flow.');
  return adaptations;
}
