// WorkBuddy (INTL) gateway conversation-gate patch.
//
// The upstream channel bundle (vendor/channel-pack, mirrored into
// packages/standalone/channels/business.mjs) does not satisfy the two AND-ed
// gates www.workbuddy.ai enforces on POST /v2/chat/completions:
//   1. all three X-Conversation-* headers must be present (else 400 code 11128
//      `conversation id missing`);
//   2. the first message must be a system prompt (else 400
//      `first message is not system prompt`).
// Both are fixed upstream in Ebony-Vinyl/dsh-our-free-model#377, which is still
// open. Until the snapshot pin moves past that merge, this transform closes the
// gap on the bundle Magpie actually loads.
//
// Anchors are matched line-ending agnostically: the repository stores LF, but a
// Windows checkout with core.autocrlf=true yields CRLF, and a naive literal
// match over a multi-line anchor silently finds nothing. Inserted text reuses
// the newline style already present in the source.
//
// See issue #6 and upstream PR #377 for the single-variable evidence.

const HEADERS_ANCHOR = [
  'headers.set("User-Agent", resolveUserAgent(this.product, options.model));',
]
const HEADERS_INSERT = [
  '    if (this.product.id === "workbuddy") {',
  '      headers.set("X-Conversation-ID", this.sessionId);',
  '      headers.set("X-Conversation-Message-ID", crypto.randomUUID());',
  '      headers.set("X-Conversation-Request-ID", crypto.randomUUID());',
  '    }',
]

const SYSTEM_ANCHOR = [
  'const messages = serializeMessages2(options.messages, imageUrls);',
  '    if (options.system !== void 0 && options.system.length > 0) {',
  '      messages.unshift({ role: "system", content: options.system });',
  '    }',
]
const SYSTEM_INSERT = [
  '    if (this.product.id === "workbuddy" && (messages.length === 0 || messages[0].role !== "system")) {',
  '      messages.unshift({ role: "system", content: "You are a helpful assistant." });',
  '    }',
]

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Build a line-ending-agnostic matcher plus the replacement text for an anchor. */
function anchorFor(source, lines, insert) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const pattern = new RegExp(lines.map(escapeRegExp).join('\\r?\\n'), 'g')
  return { pattern, replacement: [...lines, ...insert].join(newline) }
}

function matchesOf(source, pattern) {
  const hits = [...source.matchAll(pattern)]
  return hits
}

/** True when the bundle already carries the fix (upstream merged / pin bumped). */
export function workbuddyConversationPatched(source) {
  return source.includes('X-Conversation-ID')
}

/**
 * Apply the two AND-ed gateway fixes to a channel bundle.
 *
 * Idempotent: a bundle that already carries the fix is returned unchanged, so
 * bumping `CHANNEL_COMMIT` past upstream PR #377 needs no coordinated edit here.
 *
 * @param {string} source the verified-unchanged business.mjs text
 * @returns {string} the patched text, or `source` when already fixed
 * @throws when an anchor is not uniquely present and the bundle is not fixed
 */
export function applyWorkbuddyConversationPatch(source) {
  if (workbuddyConversationPatched(source)) return source
  let out = source
  for (const [name, lines, insert] of [
    ['X-Conversation headers', HEADERS_ANCHOR, HEADERS_INSERT],
    ['system-message fallback', SYSTEM_ANCHOR, SYSTEM_INSERT],
  ]) {
    const { pattern, replacement } = anchorFor(out, lines, insert)
    const hits = matchesOf(out, pattern)
    // The upstream bundle carries three `messages.unshift({ role: "system" … })`
    // sites across its adapters; only one matches the full BuddyAdapter anchor
    // block. Anything other than exactly one match means the bundle shape moved.
    if (hits.length !== 1) {
      throw new Error(`workbuddy conversation patch: ${name} anchor matched ${hits.length} time(s), expected exactly 1; upstream bundle shape changed`)
    }
    out = out.replace(pattern, replacement)
  }
  if (!workbuddyConversationPatched(out)) throw new Error('workbuddy conversation patch: anchors matched but the fix did not apply')
  return out
}
