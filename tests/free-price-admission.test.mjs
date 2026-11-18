import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildCatalog, costVerdict, isFreeLane, parseListingRows } from '../vendor/ofm/src/catalog.js';
import { createModelRuntime, createRuntimeStores } from '../vendor/ofm/src/core/runtime.js';

// The gateway's `cost` object is nested and gains dimensions over time; the
// fixture mirrors the live Zen shape (text/cache/output prices) rather than a
// flat map, because a fixed key list is what the admission rule must not need.
const zero = { text: { input: { price: 0, cache: { read: 0, write: 0 } }, output: { price: 0 } } };
const paid = { text: { input: { price: 0.15, cache: { read: 0.03 } }, output: { price: 0.6 } } };

const ids = rows => rows.map(entry => entry.id);

test('costVerdict reads nested prices, not a fixed key list', () => {
  assert.equal(costVerdict(zero), 'zero');
  assert.equal(costVerdict(paid), 'paid');
  assert.equal(costVerdict({ text: { input: { price: 0 }, output: { price: 0, extra: { nested: 0 } } } }), 'zero');
  assert.equal(costVerdict({ text: { input: { price: 0 }, output: { price: 0.000001 } } }), 'paid');
  assert.equal(costVerdict(undefined), 'unknown');
  assert.equal(costVerdict({}), 'unknown');
  assert.equal(costVerdict(null), 'unknown');
  assert.equal(costVerdict({ price: '0e-999' }), 'zero');
  assert.equal(costVerdict({ price: '1e-999' }), 'paid');
  assert.equal(costVerdict({ price: false }), 'paid');
  assert.equal(costVerdict({ price: ' ' }), 'paid');
});

test('parseListingRows keeps ids and prices and drops junk rows', () => {
  const payload = { data: [{ id: 'a-free', cost: zero }, { id: 'b' }, 'c', { id: '' }, null, { cost: paid }] };
  assert.deepEqual(parseListingRows(payload), [{ id: 'a-free', cost: zero }, { id: 'b', cost: undefined }, { id: 'c' }]);
  assert.deepEqual(parseListingRows({ models: [{ id: 'm' }] }), [{ id: 'm', cost: undefined }]);
  assert.deepEqual(parseListingRows([]), []);
  assert.equal(parseListingRows({ error: 'unavailable' }), null);
  assert.equal(parseListingRows({ data: [null] }), null);
});

test('admission follows the price, not the id spelling', () => {
  const catalog = buildCatalog([
    { id: 'mimo-v2.6-flash-free', cost: zero },
    { id: 'big-pickle', cost: zero },
    { id: 'priced-but-named-free', cost: paid },
    { id: 'opus-4', cost: paid },
    { id: 'mystery-nosuffix' },
    { id: 'mystery-free' },
  ]);
  assert.deepEqual(ids(catalog), ['mimo-v2.6-flash-free', 'big-pickle', 'mystery-free']);
});

test('a previously charged id stays out until a zero-price row readmits it', () => {
  const charged = new Set(['big-pickle', 'legacy-free']);
  assert.deepEqual(ids(buildCatalog([{ id: 'big-pickle' }], charged)), []);
  assert.deepEqual(ids(buildCatalog([{ id: 'legacy-free', cost: zero }], charged)), ['legacy-free']);
  assert.deepEqual(ids(buildCatalog([{ id: 'big-pickle', cost: paid }], charged)), []);
});

test('persisted zero-price evidence keeps a suffix-less id after a restart', () => {
  // The catalog store caches ids only; without `admitted` every suffix-less id
  // would fall back to the name test and disappear while offline.
  const rows = ['mimo-v2.6-flash-free', 'big-pickle'];
  assert.deepEqual(ids(buildCatalog(rows)), ['mimo-v2.6-flash-free']);
  assert.deepEqual(ids(buildCatalog(rows, new Set(), new Set(['big-pickle']))), rows);
});

test('a repeated id is listed once', () => {
  const catalog = buildCatalog([
    { id: 'big-pickle', cost: zero },
    { id: 'big-pickle', cost: zero },
  ]);
  assert.deepEqual(ids(catalog), ['big-pickle']);
});

test('conflicting duplicate prices exclude the model in either order', () => {
  const rows = [{ id: 'big-pickle', cost: zero }, { id: 'big-pickle(high)', cost: paid }];
  assert.deepEqual(buildCatalog(rows), []);
  assert.deepEqual(buildCatalog(rows.toReversed()), []);
});

test('a persisted empty catalog does not restore fallback models on restart', t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ofm-catalog-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const stores = createRuntimeStores({ dataDir });
  stores.catalogStore.update({ at: 1, entries: [], chargedIds: ['mimo-v2.6-flash-free'] });
  stores.catalogStore.flush();
  stores.dispose();
  const restartedStores = createRuntimeStores({ dataDir });
  const runtime = createModelRuntime(restartedStores);
  try {
    assert.deepEqual(runtime.catalog, []);
  } finally {
    runtime.dispose();
    restartedStores.dispose();
  }
});

test('isFreeLane keeps the name test for rows that disclose no prices', () => {
  assert.equal(isFreeLane('mimo-v2.6-flash-free'), true);
  assert.equal(isFreeLane('space-bunny-free'), true);
  assert.equal(isFreeLane('big-pickle'), false);
});
