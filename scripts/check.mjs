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
assert.deepEqual(Object.keys(module), ['OurFreeModelPlugin']);
assert.deepEqual(Object.keys(cfg.provider), ['our-free-model']);
assert.equal(cfg.provider['our-free-model'].name, 'Our Free Model');
console.log('Plugin contract check passed (no network or credentials).');
