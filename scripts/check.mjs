import assert from 'node:assert/strict';
import * as module from '../index.mjs';
const cfg = {};
for (const [name, factory] of Object.entries(module)) {
  assert.equal(typeof factory, 'function');
  const hooks = await factory({ client: { auth: { set() {} }, app: { log() {} } } });
  assert.equal(typeof hooks.config, 'function');
  assert.equal(typeof hooks.auth.loader, 'function');
  assert.equal(typeof hooks.provider.models, 'function');
  assert.equal(hooks.auth.provider, hooks.provider.id);
  assert.ok(hooks.auth.methods.length);
  await hooks.config(cfg);
  console.log(`${name}: ${hooks.auth.provider} hooks OK`);
}
assert.deepEqual(Object.keys(cfg.provider).sort(), ['our-free-kilo', 'our-free-local', 'our-free-model', 'our-free-zen']);
console.log('Plugin contract check passed (no network or credentials).');
