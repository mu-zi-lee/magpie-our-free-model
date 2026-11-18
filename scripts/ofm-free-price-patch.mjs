// Admit free-lane models on the gateway's own prices instead of the id spelling.
//
// The Zen listing already carries `cost` per row (nested: text.input.price,
// text.input.cache.read, text.output.price, …). The vendored snapshot read only
// `id`, so admission was a name test: an id ending in `-free` was taken as free
// forever, and an id without that suffix was dropped even when the gateway
// priced it at zero (`big-pickle` is the live example).
//
// This patch keeps the name test as the fallback for rows that disclose no
// prices, and adds three rules from the upstream free-gateway implementations:
// a priced row is dropped whatever its name says; an unpriced row needs the
// suffix or the ALWAYS_FREE list; and an id once seen priced stays out until a
// later refresh prices it at zero, so a catalog that stops disclosing prices
// cannot re-admit something that was charged.
//
// The catalog store persists ids, not prices, so the zero-price evidence is
// persisted alongside them: without it a restart would drop every admitted id
// whose name carries no `-free` suffix.

const CRLF = /\r\n/g;

function transform(source, edits) {
  const crlf = source.includes('\r\n');
  let text = crlf ? source.replace(CRLF, '\n') : source;
  for (const [from, to] of edits) {
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`anchor matched ${count} times: ${from.slice(0, 70)}`);
    text = text.replace(from, () => to);
  }
  return crlf ? text.replace(/\n/g, '\r\n') : text;
}

const FREE_LANE_BLOCK = `export function isFreeLane(modelId) {
  const base = baseModelId(modelId)
  if (ALWAYS_FREE.has(base)) return true
  return /(?:^|[-_])free(?:$|[-_.])/.test(base)
}`;

const PRICE_HELPERS = `
/**
 * A listing row's cost verdict, read from the gateway's own \`cost\` object.
 *
 * Prices arrive as a nested map and the set of priced dimensions changes, so
 * every number below the object counts instead of a fixed key list: a new
 * dimension must not stay invisible. \`unknown\` means the row disclosed no
 * numbers at all — the caller decides whether the id's own name is evidence.
 *
 * @param {unknown} cost
 * @returns {'zero'|'paid'|'unknown'}
 */
export function costVerdict(cost) {
  let seen = 0
  let zero = true
  const walk = value => {
    if (value === null || value === undefined || value === '') return
    if (typeof value === 'object') { for (const item of Object.values(value)) walk(item); return }
    const number = Number(value)
    if (!Number.isFinite(number)) { zero = false; return }
    seen += 1
    if (number !== 0) zero = false
  }
  walk(cost)
  return seen === 0 ? 'unknown' : zero ? 'zero' : 'paid'
}`;

const BUILD_HEAD_OLD = `/**
 * Merge the upstream listing with the local capability table.
 *
 * @param {string[]} ids - raw upstream model ids
 * @returns {Array<object>} catalog entries in listing order
 */
export function buildCatalog(ids) {
  const seen = new Set()
  const entries = []
  for (const raw of ids) {
    const id = String(raw ?? '').trim()
    if (id === '' || !isFreeLane(id)) continue
    const base = baseModelId(id)
    if (seen.has(base)) continue
    seen.add(base)`;

const BUILD_HEAD_NEW = `/**
 * Merge the upstream listing with the local capability table.
 *
 * Admission follows the listing's prices, not the id's spelling: a row priced
 * above zero is dropped even when its id still ends in \`-free\`, and an id
 * without that suffix is kept only when a refresh carries a zero-price record
 * for it. \`charged\` holds ids an earlier refresh priced above zero; they stay
 * out while the price is unstated, and a zero-price row readmits them because
 * the fresh record beats the stale one. \`admitted\` holds the ids a past refresh
 * priced at zero — a restart that only has ids cached (no prices) would
 * otherwise drop them.
 *
 * @param {Array<string|{id: string, cost?: unknown}>} rows - listing rows, or ids alone
 * @param {Set<string>} charged - ids priced above zero by an earlier refresh
 * @param {Set<string>} admitted - ids with earlier zero-price evidence
 * @returns {Array<object>} catalog entries in listing order
 */
export function buildCatalog(rows, charged = new Set(), admitted = new Set()) {
  const seen = new Set()
  const entries = []
  for (const raw of rows) {
    const row = typeof raw === 'string' ? { id: raw } : raw
    const id = String(row?.id ?? '').trim()
    if (id === '') continue
    const base = baseModelId(id)
    const verdict = costVerdict(row?.cost)
    if (verdict === 'paid') continue
    if (verdict !== 'zero' && charged.has(base)) continue
    if (verdict === 'unknown' && !isFreeLane(id) && !admitted.has(base)) continue
    if (seen.has(base)) continue
    seen.add(base)`;

const PARSE_LISTING_BLOCK = `/** Parse the gateway's \`{"data":[{"id":…}]}\` listing. */
export function parseListing(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : Array.isArray(payload) ? payload : []
  return rows.map(row => (typeof row === 'string' ? row : row?.id)).filter(id => typeof id === 'string' && id !== '')
}`;

const PARSE_ROWS = `
/**
 * Parse the same listing while keeping each row's prices.
 *
 * \`parseListing\` throws the price away, which is what made admission a name
 * test; the refresh path uses this instead and hands the rows to buildCatalog.
 */
export function parseListingRows(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : Array.isArray(payload) ? payload : []
  return rows
    .map(row => (typeof row === 'string' ? { id: row } : row !== null && typeof row === 'object' ? { id: row.id, cost: row.cost } : null))
    .filter(row => row !== null && typeof row.id === 'string' && row.id !== '')
}`;

const IMPORT_OLD = "import { buildCatalog, buildEacCatalog, buildKiloCatalog, isEacEntry, isKiloEntry, parseListing, reviveKiloCatalog } from '../catalog.js'";
const IMPORT_NEW = "import { buildCatalog, buildEacCatalog, buildKiloCatalog, costVerdict, isEacEntry, isKiloEntry, parseListing, parseListingRows, reviveKiloCatalog } from '../catalog.js'";

const UPSTREAM_IMPORT_OLD = "import { mintRequestId, sessionForConversation } from '../upstream.js'";
const UPSTREAM_IMPORT_NEW = "import { baseModelId, mintRequestId, sessionForConversation } from '../upstream.js'";

const CATALOG_INIT_OLD = `  let catalog = materializeCatalog(catalogStore.get().entries ?? [])
  let sealedCatalog =`;
const CATALOG_INIT_NEW = `  /** Ids a refresh priced above zero; kept out until a refresh prices them at zero. */
  const chargedIds = new Set(catalogStore.get().chargedIds ?? [])
  /** Ids a refresh priced at zero. Only ids are cached between runs, not prices,
   *  so this is what keeps a suffix-less free id admitted while the listing is
   *  unreachable. */
  const zeroIds = new Set(catalogStore.get().zeroIds ?? [])
  let catalog = materializeCatalog(catalogStore.get().entries ?? [], chargedIds, zeroIds)
  let sealedCatalog =`;

const REFRESH_OLD = `    let ids = []
    try {
      ids = parseListing(await fetchListing())
    } catch (error) {
      if (!disposed) logger.warn?.(\`our-free-model: model listing refresh failed (\${error?.message ?? error}); keeping the cached catalog\`)
    }
    if (disposed) return catalog
    if (ids.length > 0) {
      freeCatalog = buildCatalog(ids)
      catalogStore.update({ at: Date.now(), entries: freeCatalog.map(entry => entry.id) })
      catalogStore.flush()
      settings.update({ catalogSyncedAt: Date.now() })
    } else {
      freeCatalog = materializeCatalog(catalogStore.get().entries ?? [])
    }`;
const REFRESH_NEW = `    let rows = []
    try {
      rows = parseListingRows(await fetchListing())
    } catch (error) {
      if (!disposed) logger.warn?.(\`our-free-model: model listing refresh failed (\${error?.message ?? error}); keeping the cached catalog\`)
    }
    if (disposed) return catalog
    if (rows.length > 0) {
      for (const row of rows) {
        const base = baseModelId(row.id)
        const verdict = costVerdict(row.cost)
        if (verdict === 'paid') { chargedIds.add(base); zeroIds.delete(base) }
        else if (verdict === 'zero') { chargedIds.delete(base); zeroIds.add(base) }
      }
      freeCatalog = buildCatalog(rows, chargedIds, zeroIds)
      catalogStore.update({ at: Date.now(), entries: freeCatalog.map(entry => entry.id), chargedIds: [...chargedIds], zeroIds: [...zeroIds] })
      catalogStore.flush()
      settings.update({ catalogSyncedAt: Date.now() })
    } else {
      freeCatalog = materializeCatalog(catalogStore.get().entries ?? [], chargedIds, zeroIds)
    }`;

const MATERIALIZE_OLD = `function materializeCatalog(ids) {
  const rebuilt = buildCatalog(ids)
  return rebuilt.length > 0 ? rebuilt : FALLBACK_CATALOG
}`;
const MATERIALIZE_NEW = `function materializeCatalog(ids, charged = new Set(), admitted = new Set()) {
  const rebuilt = buildCatalog(ids, charged, admitted)
  return rebuilt.length > 0 ? rebuilt : FALLBACK_CATALOG
}`;

export function patchFreeLaneCatalog(source) {
  return transform(source, [
    [FREE_LANE_BLOCK, FREE_LANE_BLOCK + '\n' + PRICE_HELPERS],
    [BUILD_HEAD_OLD, BUILD_HEAD_NEW],
    [PARSE_LISTING_BLOCK, PARSE_LISTING_BLOCK + '\n' + PARSE_ROWS],
  ]);
}

export function patchFreeLaneRuntime(source) {
  return transform(source, [
    [IMPORT_OLD, IMPORT_NEW],
    [UPSTREAM_IMPORT_OLD, UPSTREAM_IMPORT_NEW],
    [CATALOG_INIT_OLD, CATALOG_INIT_NEW],
    [REFRESH_OLD, REFRESH_NEW],
    [MATERIALIZE_OLD, MATERIALIZE_NEW],
  ]);
}
