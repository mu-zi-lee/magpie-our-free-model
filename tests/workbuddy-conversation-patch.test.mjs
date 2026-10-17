import assert from 'node:assert/strict';
import test from 'node:test';
import { applyWorkbuddyConversationPatch, workbuddyConversationPatched } from '../src/workbuddy-conversation-patch.mjs';

// Minimal stand-ins for the two BuddyAdapter regions the patch targets, using
// the exact upstream text so a shape change here fails loudly.
const HEADERS = 'headers.set("User-Agent", resolveUserAgent(this.product, options.model));'
const SYSTEM = `const messages = serializeMessages2(options.messages, imageUrls);
    if (options.system !== void 0 && options.system.length > 0) {
      messages.unshift({ role: "system", content: options.system });
    }`
const bundle = () => `async send() {\n    ${HEADERS}\n    try {\n    }\n  }\n  async prepareCall() {\n    ${SYSTEM}\n  }\n`

const HEADER_BLOCK = `if (this.product.id === "workbuddy") {
      headers.set("X-Conversation-ID", this.sessionId);
      headers.set("X-Conversation-Message-ID", crypto.randomUUID());
      headers.set("X-Conversation-Request-ID", crypto.randomUUID());
    }`
const SYSTEM_BLOCK = `if (this.product.id === "workbuddy" && (messages.length === 0 || messages[0].role !== "system")) {
      messages.unshift({ role: "system", content: "You are a helpful assistant." });
    }`

test('workbuddy patch adds the three conversation headers and a system fallback', () => {
  const out = applyWorkbuddyConversationPatch(bundle());
  assert.ok(out.includes(HEADER_BLOCK), 'missing the X-Conversation-* block');
  assert.ok(out.includes(SYSTEM_BLOCK), 'missing the system fallback block');
  assert.equal(workbuddyConversationPatched(out), true);
});

test('workbuddy patch is idempotent and preserves everything around the anchors', () => {
  const once = applyWorkbuddyConversationPatch(bundle());
  assert.equal(applyWorkbuddyConversationPatch(once), once);
  // Both insertions sit immediately after their anchor, before the original code.
  assert.ok(once.includes(`${HEADERS}\n    ${HEADER_BLOCK}\n    try {`), 'header block misplaced relative to anchor');
  assert.ok(once.includes(`${SYSTEM}\n    ${SYSTEM_BLOCK}\n  }`), 'system block misplaced relative to anchor');
});

test('workbuddy patch matches line-ending agnostic (autocrlf checkouts)', () => {
  const out = applyWorkbuddyConversationPatch(bundle().replaceAll('\n', '\r\n'));
  assert.equal(workbuddyConversationPatched(out), true);
  assert.ok(out.includes(HEADER_BLOCK.replaceAll('\n', '\r\n')), 'inserted lines must reuse the CRLF style');
});

test('workbuddy patch refuses a bundle whose anchor shape changed', () => {
  // Two User-Agent sites: the header anchor is no longer unique.
  assert.throws(() => applyWorkbuddyConversationPatch(`${HEADERS}\n${bundle()}`), /X-Conversation headers anchor matched 2 time\(s\), expected exactly 1/);
  // System anchor absent entirely.
  assert.throws(() => applyWorkbuddyConversationPatch(`async send() {\n    ${HEADERS}\n  }`), /system-message fallback anchor matched 0 time\(s\)/);
});

test('a bundle already fixed upstream is returned unchanged', () => {
  const fixed = `${bundle()}\n// upstream now emits X-Conversation-ID`;
  assert.equal(applyWorkbuddyConversationPatch(fixed), fixed);
});
