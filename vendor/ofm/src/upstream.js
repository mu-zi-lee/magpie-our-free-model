/**
 * Upstream wire for the免密 free lane.
 *
 * Every fact encoded here was verified against the live gateway on 2026-09-24
 * by direct request: the public pooled
 * credential, the client fingerprint headers, the per-model endpoint split, the
 * free-tier tool-fingerprint gate (403 FreeTierError without it), the
 * per-session quota accounting (429 FreeUsageLimitError when a fresh session is
 * minted per request), and the regional gate (403 RegionError).
 *
 * Re-verified 2026-10-14 after the lane moved: the free models now answer on
 * `/inference/v1` (the old `/zen/v1` chat path answers 403 FreeTierError for
 * every one of them), a request must send `x-opencode-session-id` next to
 * `x-opencode-session`, the session id has to be minted rather than derived,
 * the tool gate is `bash` + `read` declared with a non-empty parameter schema,
 * and a User-Agent containing `deepseek-harness` is refused by name. Details and
 * the measurements: docs/free-lane-wire.md.
 *
 * @module src/upstream.js
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR_NAME, resolveDshHome } from './store.js'

/**
 * Overridable so the selftest can point the adapter at a dead port and exercise
 * the transport-failure path without touching the real free lane's quota.
 */
export const UPSTREAM_BASE = process.env.OUR_FREE_MODEL_BASE ?? 'https://opencode.ai'

/** A version >= 1.17 is required by the gateway's User-Agent check. */
export const CLIENT_UA = 'opencode/1.18.31'
const MAX_SESSION_LENGTH = 256
const MAX_TOOL_NAME_LEN = 128
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * The lowercase tool names the free tier requires to be declared. The gate as
 * measured on 2026-10-14 is `bash` **and** `read` present, each carrying a
 * parameter schema with at least one declared property (names with an empty
 * `properties: {}` are refused, as is either name on its own); `glob`/`grep` are
 * kept because the real client declares all four and dropping them buys nothing.
 */
export const FINGERPRINT_TOOLS = ['bash', 'glob', 'grep', 'read']

/** Property stamped into a fingerprint slot that would otherwise declare none. */
const FINGERPRINT_PROPERTY = { type: 'string', description: 'This tool is currently unavailable and must not be used.' }

/**
 * Quartet slots that a tool the caller already has can answer for, keyed by the
 * required spelling. dsh names its shell tool `pwsh` on Windows
 * (`packages/shell/tool-pwsh`) and `bash` elsewhere (`packages/shell/tool-bash`),
 * so the same plugin must fill the slot from whichever the kernel mounted.
 */
const QUARTET_DONORS = { bash: ['pwsh'] }

/** Models served by /responses instead of /chat/completions. */
const RESPONSES_MODELS = new Set(['muse-spark-1.2-contributor-free', 'muse-spark-1.3-contributor-free'])
/** Models served by the Anthropic-shaped /messages endpoint. */
const MESSAGES_MODELS = new Set(['union-alpha'])

export const SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/
export const REQUEST_RE = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/

const ANTHROPIC_API_VERSION = '2023-06-01'

function base62From(bytes) {
  let out = ''
  for (const byte of bytes) out += BASE62[byte % 62]
  return out
}

let lastStamp = 0
let seq = 0

/** Mint a gateway-shaped canonical session id (time-prefixed, monotonic counter). */
export function mintSessionId(timestamp = Date.now()) {
  if (timestamp !== lastStamp) { lastStamp = timestamp; seq = 0 }
  seq += 1
  const value = ~(BigInt(timestamp) * 0x1000n + BigInt(seq))
  let hex = ''
  for (let i = 0; i < 6; i += 1) hex += Number((value >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, '0')
  return `ses_${hex}${base62From(crypto.randomBytes(14))}`
}

/** Mint a gateway-shaped request id for one turn. */
export function mintRequestId(timestamp = Date.now()) {
  const value = BigInt(timestamp) * 0x1000n + 1n
  let hex = ''
  for (let i = 0; i < 6; i += 1) hex += Number((value >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, '0')
  return `msg_${hex}${base62From(crypto.randomBytes(14))}`
}

const SESSION_MAP_FILE = 'session-map.json'
let sessions

let sessionRoot
export function setSessionStoreRoot(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new TypeError('session store root must be an absolute path')
  if (sessionRoot === dir) return
  sessionRoot = dir
  sessions = undefined
}

function sessionStorePath() {
  try {
    const root = sessionRoot
      ?? (typeof process.env.OFM_HOME === 'string' && process.env.OFM_HOME.trim() !== '' ? process.env.OFM_HOME.trim() : undefined)
    if (root) return path.join(path.resolve(root), SESSION_MAP_FILE)
    return path.join(path.resolve(resolveDshHome(), DATA_DIR_NAME), SESSION_MAP_FILE)
  } catch { return undefined }
}

function loadSessions() {
  if (sessions !== undefined) return sessions
  sessions = new Map()
  try {
    const file = sessionStorePath()
    if (file === undefined) return sessions
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const [seed, id] of Object.entries(parsed?.sessions ?? {})) {
      if (typeof id === 'string' && SESSION_RE.test(id)) sessions.set(seed, id)
    }
  } catch { /* first run or unreadable store: start empty */ }
  return sessions
}

function rememberSession(seed, id) {
  loadSessions().set(seed, id)
  try {
    const file = sessionStorePath()
    if (file === undefined) return
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temp = `${file}.tmp`
    fs.writeFileSync(temp, JSON.stringify({ version: 1, at: Date.now(), sessions: Object.fromEntries(sessions) }, undefined, 2))
    fs.renameSync(temp, file)
  } catch { /* non-fatal: the id still works, it just will not survive a restart */ }
}

/**
 * Map one downstream conversation onto one stable upstream session.
 *
 * Free-tier quota is accounted per session, so a fresh id per request exhausts
 * it and surfaces as 429 with growing retry-after. The gateway also checks the
 * id's *shape*: the twelve hex digits must be the time encoding that
 * `mintSessionId()` produces. A sha256 digest, or any other random hex, is
 * refused with 403 FreeTierError even when every other header is right
 * (measured 2026-10-14). Mint once per conversation and cache it, which keeps
 * both properties: one stable session per conversation, and the canonical shape.
 */
export function sessionForConversation(sessionId) {
  if (typeof sessionId === 'string' && SESSION_RE.test(sessionId.trim())) return sessionId.trim()
  const seed = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : 'global'
  const remembered = loadSessions().get(seed)
  if (remembered !== undefined) return remembered
  const minted = mintSessionId()
  rememberSession(seed, minted)
  return minted
}

/** Stable per-turn request id: retries of the same turn share it. */
export function requestIdFor(sessionId, turnSeed) {
  if (typeof turnSeed !== 'string' || turnSeed === '') return mintRequestId()
  const digest = crypto.createHash('sha256').update(`our-free-model-req\0${sessionId}\0${turnSeed}`).digest()
  const id = `msg_${digest.subarray(0, 6).toString('hex')}${base62From(digest.subarray(6, 20))}`
  return REQUEST_RE.test(id) ? id : mintRequestId()
}

/** Strip a trailing "(level)" thinking suffix so lookups hit the base id. */
export function baseModelId(model) {
  return String(model ?? '').replace(/\([^()]+\)\s*$/, '').trim()
}

function isMuseSpark(modelId) {
  const clean = baseModelId(modelId)
  const base = clean.includes('/') ? clean.split('/').pop() : clean
  return /^muse[-_]?spark(?:$|[-_:.\s])/i.test(base)
}

export function isResponsesModel(modelId) {
  return RESPONSES_MODELS.has(baseModelId(modelId)) || isMuseSpark(modelId)
}

export function isMessagesModel(modelId) {
  return MESSAGES_MODELS.has(baseModelId(modelId))
}

/**
 * Which upstream path serves this model. The free lane lives under
 * `/inference/v1` (measured 2026-10-14, and the shape the console's model table
 * documents); `/zen/v1` chat completions answer 403 FreeTierError for free ids.
 */
export function endpointFor(modelId) {
  if (isResponsesModel(modelId)) return '/inference/v1/responses'
  if (isMessagesModel(modelId)) return '/inference/v1/messages'
  return '/inference/v1/chat/completions'
}

/** The wire shape one endpoint speaks; drives request encoding and response parsing. */
export function wireFor(modelId) {
  const path = endpointFor(modelId)
  if (path === '/inference/v1/responses') return 'responses'
  if (path === '/inference/v1/messages') return 'messages'
  return 'chat'
}

/**
 * The headers the gateway fingerprints a genuine client by.
 * `Authorization: Bearer public` is the pooled免密 credential — there is no
 * per-user secret on this lane.
 *
 * `x-opencode-session-id` carries the same value as `x-opencode-session`; the
 * gateway refuses a request that omits it (403 FreeTierError, measured
 * 2026-10-14) even when every other header matches. `x-opencode-client` is
 * reported as `cli` because that is what the real client sends.
 */
export function gatewayHeaders({ session, requestId, stream, accept }) {
  const headers = {
    'content-type': 'application/json',
    'authorization': 'Bearer public',
    'user-agent': CLIENT_UA,
    'x-opencode-client': 'cli',
    'x-opencode-session': session,
    'x-opencode-session-id': session,
    'x-opencode-request': requestId,
    'x-opencode-project': 'global',
    'accept': accept ?? (stream ? 'text/event-stream' : '*/*'),
  }
  return headers
}

function toolNameOf(tool) {
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return ''
  if (typeof tool.name === 'string' && tool.name.trim()) return tool.name.trim()
  const fn = tool.function
  if (fn && typeof fn === 'object' && !Array.isArray(fn) && typeof fn.name === 'string') return fn.name.trim()
  return ''
}

function quartetKey(name) {
  const lower = String(name ?? '').trim().toLowerCase()
  return FINGERPRINT_TOOLS.includes(lower) ? lower : ''
}

/** The Chat-shape `{function:{…}}` wrapper, or null for the flat Responses one. */
function functionOf(tool) {
  return tool.function && typeof tool.function === 'object' && !Array.isArray(tool.function) ? tool.function : null
}

/**
 * Give a declared fingerprint slot a non-empty parameter schema.
 *
 * The gate refuses `bash`/`read` that carry `properties: {}` (measured
 * 2026-10-14), so a slot declared with an empty schema — a decoy, or a caller
 * tool that means something else by the name — gets one harmless placeholder
 * property. Only the entry's schema is touched; its name and description stay as
 * the caller wrote them.
 */
function withDeclaredProperty(tool, { claude, flat }) {
  const wrapper = claude || flat ? tool : functionOf(tool)
  if (wrapper === null || wrapper === undefined) return tool
  const key = claude ? 'input_schema' : 'parameters'
  const schema = wrapper[key]
  const properties = schema !== null && typeof schema === 'object' ? schema.properties : undefined
  if (properties !== null && typeof properties === 'object' && Object.keys(properties).length > 0) return tool
  const next = { ...(schema ?? {}), type: 'object', properties: { input: FINGERPRINT_PROPERTY } }
  if (wrapper === tool) return { ...tool, [key]: next }
  return { ...tool, function: { ...wrapper, [key]: next } }
}

/**
 * Satisfy the free-tier fingerprint gate on `body.tools`.
 *
 * The gate demands `bash` and `read` be declared, each with a parameter schema
 * that declares at least one property; the other two quartet names are kept
 * because the real client sends all four. dsh's own shell/filesystem tools
 * already answer to `bash`/`glob`/`grep`/`read` on the lane that names its shell
 * `bash`, so a normal agent turn declares them for real; a slot the caller does
 * not field is filled by promoting a tool that can genuinely answer for it (see
 * {@link QUARTET_DONORS}) before it is faked, and only a slot with nothing to
 * promote gets a self-disabling decoy. Case variants are canonicalised rather
 * than duplicated (upstream rejects `Bash` + `bash` as a duplicate), the rename
 * map lets the response side restore the caller's spelling — which is what makes
 * a promoted tool callable — and any slot left with an empty schema is stamped
 * with one placeholder property so the gate does not read it as undeclared.
 *
 * @param {object} body - request body, mutated in place
 * @param {boolean|'claude'} style - true 为 Responses，false 为 Chat，claude 为 Messages
 * @returns {Map<string, string>} sent spelling -> caller spelling
 */
export function applyFingerprint(body, style) {
  const flat = style === true
  const claude = style === 'claude'
  const map = new Map()
  const tools = Array.isArray(body.tools) ? body.tools : []
  const hadClientTools = tools.length > 0
  const seen = new Set()
  const out = []

  for (const tool of tools) {
    const current = toolNameOf(tool)
    const key = quartetKey(current)
    if (!key) { out.push(tool); continue }
    if (seen.has(key)) continue
    seen.add(key)
    if (current !== key) {
      map.set(key, current)
      const fn = functionOf(tool)
      out.push(fn ? { ...tool, function: { ...fn, name: key } } : { ...tool, name: key })
    } else {
      out.push(tool)
    }
  }

  // A decoy is a name the model will call: with only `pwsh` on the session, the
  // `bash` decoy was recorded being invoked 24 times in one run, every one of
  // them an unknown tool. Promoting the real shell into the slot costs the gate
  // nothing — it fingerprints the declared names — and the call comes back
  // executable.
  const promoted = new Set()
  for (const name of FINGERPRINT_TOOLS) {
    if (seen.has(name)) continue
    const donors = QUARTET_DONORS[name] ?? []
    const index = out.findIndex(tool => {
      const original = toolNameOf(tool)
      if (original === '' || quartetKey(original) !== '') return false
      const lower = original.toLowerCase()
      return !promoted.has(lower) && donors.includes(lower)
    })
    if (index === -1) continue
    const tool = out[index]
    const original = toolNameOf(tool)
    promoted.add(original.toLowerCase())
    map.set(name, original)
    const fn = functionOf(tool)
    out[index] = fn ? { ...tool, function: { ...fn, name } } : { ...tool, name }
    seen.add(name)
  }

  for (const name of FINGERPRINT_TOOLS) {
    if (seen.has(name)) continue
    const properties = { input: FINGERPRINT_PROPERTY }
    out.push(claude
      ? { name, description: 'This tool is currently unavailable and must not be used.', input_schema: { type: 'object', properties } }
      : flat
        ? { type: 'function', name, description: 'This tool is currently unavailable and must not be used.', parameters: { type: 'object', properties } }
        : { type: 'function', function: { name, description: 'This tool is currently unavailable and must not be used.', parameters: { type: 'object', properties } } })
  }

  body.tools = out.map(tool => {
    const name = toolNameOf(tool)
    return name === 'bash' || name === 'read' ? withDeclaredProperty(tool, { claude, flat }) : tool
  })
  if (!body.tool_choice) {
    if (flat) body.tool_choice = 'auto'
    else if (!hadClientTools) body.tool_choice = claude ? { type: 'none' } : 'none'
  }
  return map
}

/** Restore the caller's tool spelling in a streaming delta or a final payload. */
export function restoreToolName(name, map) {
  if (!map || map.size === 0) return name
  return map.get(name) ?? name
}

/** Session-scoped identity used to pick a decoy out of a real tool call. */
export function declaredToolNames(body) {
  const names = new Set()
  for (const tool of Array.isArray(body.tools) ? body.tools : []) {
    const n = toolNameOf(tool)
    if (n) names.add(n)
  }
  return names
}

function truncateSession(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > MAX_SESSION_LENGTH ? trimmed.slice(0, MAX_SESSION_LENGTH) : trimmed
}

export { truncateSession, ANTHROPIC_API_VERSION, MAX_TOOL_NAME_LEN }
