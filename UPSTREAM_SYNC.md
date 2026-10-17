# Upstream Maintenance

Target repository: `mu-zi-lee/magpie-our-free-model`, branch `main`.
Source: `Ebony-Vinyl/dsh-our-free-model`.
The source snapshot, not this document, is authoritative: `vendor/ofm/UPSTREAM.json`.

## 0.9.0 - 2026-10-11

Reviewed the changes from `f8974369c5904858c696b520d8b9b82ad4425f78`
to `e9c4b70d913116284692d7b206a63f39ad6fe8cc`.

Adopted:

- Standalone UI bundles: themes, model batch controls and clearer channel credit
  querying/retry feedback.
- Channel business: Gemini/Cline environment and Windows system proxy handling,
  explicit Gemini quota refresh and image pricing.
- Updated model core and dependencies, including the native Anthropic Messages
  listener. Added a reproducible Magpie Worker adaptation for its harness messages
  and tools; provider/model enablement, effort normalization and token budgets
  still use the original channel logic.
- Updated channel and EAC download commit pins, verified the original downloads,
  and recorded the original and adapted hashes for every retained source file.
- Snapshot generation recognizes hashed channel UI bundles and stages all patches
  before replacing the old snapshot. A patch mismatch leaves the old snapshot
  intact; separately collected UI dependency licenses are retained.

Deferred:

- The new aggregate provider, fallback chain and token-saving modules are copied
  with the core because it imports them. Upstream standalone management lacks
  complete configuration controls and does not enable all DSH-specific wiring.
  They are not advertised as fully available Magpie features.
- DSH host updater/hot reload, announcements, Agent continuation and LAN relay
  remain outside this plugin's supported integration.

## Temporary adaptations

- **WorkBuddy INTL conversation gates** (issue #6, upstream
  `Ebony-Vinyl/dsh-our-free-model#377`). `src/workbuddy-conversation-patch.mjs`
  adds the three `X-Conversation-*` headers and a leading system message that
  `www.workbuddy.ai` requires together, without which every `workbuddy/*`
  request fails with HTTP 400 before the model is reached.
  - Normal startup: applied to the verified download as a sibling
    `business.workbuddy-gated.mjs` in `channelBusinessUrl`, so the pristine
    `CHANNEL_FILES` SHA-256 pin still attests the upstream bytes. Rewriting that
    pin instead would fail integrity on every fresh install.
  - Offline mode (`autoInstallChannels: false`): applied to the vendored bundle
    by the `scripts/vendor-ofm.mjs` patch table, so `--replace` regenerates it.
  - **Removal condition:** once the reviewed pin passes the merge of upstream
    PR #377, the bundle already carries both gates, the transform becomes a
    no-op and the sibling is never written. Delete the table entry, the module
    and its tests at that point.

## Recurring Review

A Codex app automation attached to the maintenance chat runs every 72 hours.
The user authorized implementing suitable changes, committing and pushing them
directly to the target repository after validation. The task is managed by the
Codex app, not installed as a system service or a GitHub Actions workflow.

For each run:

1. Fetch both repositories and compare the source HEAD with the snapshot pin.
   Review actual code changes and upstream tests; do not copy an unreviewed HEAD.
2. Integrate relevant standalone/core/channel changes and preserve Magpie service
   management, console security, uninstall ownership, credentials and licenses.
3. Update the reviewed pin in `scripts/vendor-ofm.mjs`, then run
   `node scripts/vendor-ofm.mjs /absolute/path/to/reviewed-upstream --replace`.
   Update channel/EAC pins, sizes and SHA-256 digests from those original files.
   Never distribute original vault data or bundled OAuth/App ID defaults.
4. Update the version, README, NOTICE, this review record and VALIDATION as needed.
   Run `npm run check`, `npm test`, native-channel fixtures with a verified
   original bundle, and relevant service/host/browser checks.
5. Stage only task changes, commit and normally push to `origin/main` after
   checking remote state. Do not force-push or overwrite unrelated user changes.
   Use an isolated checkout when concurrent work affects this checkout.
6. Notify on a completed push, failure or required user action. Stay quiet when
   there is no applicable change; do not create an empty commit.
