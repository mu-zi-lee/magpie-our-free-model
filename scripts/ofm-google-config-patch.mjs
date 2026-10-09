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
    updated = updated.replace(existing, `if (!fromEnv) throw new Error("Gemini 原渠道包未加载；请启用 managed.autoInstallChannels 后重启 Magpie。");\n  return fromEnv;`);
  }
  updated = removeEmbeddedWechatDefault(updated);
  fs.writeFileSync(target, updated);
  const digest = content => crypto.createHash('sha256').update(content).digest('hex');
  return { path: file, originalSha256: digest(original), sha256: digest(updated),
    reason: 'Distribution-only fallback omits upstream Google/WeChat defaults. Normal startup loads the verified original complete bundle unchanged; no custom local OAuth/App ID configuration is added.' };
}

export function removeEmbeddedWechatDefault(source) {
  const definition = /var LOOMY_WECHAT_APP_ID = "[^"\n]*";/g;
  if ((source.match(definition) ?? []).length !== 1) throw new Error('Upstream WeChat definition changed; review the patch');
  const start = 'function buildLoomyWechatAuthUrl(state) {';
  if (!source.includes(start)) throw new Error('Upstream WeChat URL builder changed; review the patch');
  return source.replace(definition, 'var LOOMY_WECHAT_APP_ID = "";')
    .replace(start, `${start}\n  throw new Error("Loomy 原渠道包未加载；请启用 managed.autoInstallChannels 后重启 Magpie。");`);
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
    'Replace the packaged vault with an empty stub; original EAC source is installed in a private runtime cache or selected locally.');
  for (const file of ['src/vault-data.js', 'src/vault-anchor.js']) fs.unlinkSync(path.join(directory, file));
  const serviceFile = 'packages/standalone/service.mjs';
  const original = fs.readFileSync(path.join(directory, serviceFile), 'utf8');
  const updated = original.replace('logger = console, refresh = true, probe,', 'logger = console, refresh = true, probe, eacCredential, eacSetup,')
    .replace('dataDir,\n      onSaved:', 'dataDir, credentialOf: eacCredential, setup: eacSetup,\n      onSaved:');
  if (updated === original || !updated.includes('credentialOf: eacCredential')) throw new Error('Standalone EAC integration point changed');
  replace(serviceFile, updated, 'Accept an original EAC credential function and safe setup diagnostics; preserve server authorization and login flow.');
  return adaptations;
}
