// Loaded only by the test Node wrapper; production never imports this file.
import { lane } from '../vendor/ofm/src/eac.js';
import fs from 'node:fs';
import path from 'node:path';
const original = globalThis.fetch;
const fixture = process.env.OFM_TEST_UPSTREAM;
if (!fixture || new URL(fixture).hostname !== '127.0.0.1') throw new Error('Fixture must be loopback');
globalThis.fetch = (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return original(input, { ...options, redirect: 'manual' });
  if (url.protocol !== 'https:') throw new Error('External fixture network forbidden');
  return original(`${fixture}/remote${url.pathname}${url.search}`, { ...options, redirect: 'manual' });
};
lane.fetch = globalThis.fetch;
if (process.env.OFM_TEST_EAC_SOURCE) {
  const vault = path.join(process.env.OFM_TEST_EAC_SOURCE, 'src/vault.js');
  fs.mkdirSync(path.dirname(vault), { recursive: true });
  fs.writeFileSync(vault, `export function openSeal() { return { mode: 'worker', base: '${fixture}/remote/v1', signingSecret: 'fixture-only-not-a-production-secret' }; }\n`);
}
