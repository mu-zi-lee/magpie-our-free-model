// Copy a pinned upstream runtime without changing its authentication or business logic.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeEmbeddedOAuthDefaults, externalizeEacCredentials } from './ofm-google-config-patch.mjs';

const pin = 'f8974369c5904858c696b520d8b9b82ad4425f78';
const root = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node scripts/vendor-ofm.mjs /path/to/upstream');
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== pin) throw new Error(`Expected upstream ${pin}`);
const dest = fileURLToPath(new URL('../vendor/ofm/', import.meta.url));
if (fs.existsSync(dest)) throw new Error('Snapshot already exists; review changes before replacing it');
const files = new Set(['LICENSE', 'package.json', 'packages/standalone/package.json', 'packages/standalone/README.md',
  'scripts/standalone-third-party.txt', 'vendor/channel-pack/LICENSE', 'vendor/channel-pack/NOTICE.md',
  'vendor/channel-pack/qoder-auth-wasm.wasm']);
for (const dir of ['src', 'packages/standalone/channels', 'packages/standalone/web']) {
  const walk = base => {
    for (const entry of fs.readdirSync(path.join(root, base), { withFileTypes: true })) {
      const name = `${base}/${entry.name}`;
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile() && !name.includes('.test.') && !name.includes('/test/')) files.add(name);
    }
  };
  walk(dir);
}
for (const name of ['cli', 'service', 'management', 'login-terminal', 'eac']) files.add(`packages/standalone/${name}.mjs`);
const manifest = [];
for (const name of [...files].sort()) {
  const source = path.join(root, name);
  if (!fs.lstatSync(source).isFile()) throw new Error(`Not a regular file: ${name}`);
  const bytes = fs.readFileSync(source);
  const target = path.join(dest, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  manifest.push({ path: name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
}
const adaptation = removeEmbeddedOAuthDefaults(dest);
const eacAdaptations = externalizeEacCredentials(dest);
const omitted = ['src/vault-data.js', 'src/vault-anchor.js'];
fs.writeFileSync(path.join(dest, 'UPSTREAM.json'), JSON.stringify({ repository: 'https://github.com/Ebony-Vinyl/dsh-our-free-model', commit: pin,
  files: manifest.filter(file => !omitted.includes(file.path)), omitted, adaptations: [adaptation, ...eacAdaptations] }, null, 2) + '\n');
console.log('Copied runtime without embedded OAuth/EAC defaults; recorded all adaptations');
