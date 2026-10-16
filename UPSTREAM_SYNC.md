# Upstream Maintenance

Target repository: `Gyarados4157/magpie-our-free-model`, branch `main`.
Source: `Ebony-Vinyl/dsh-our-free-model`.
The source snapshot, not this document, is authoritative: `vendor/ofm/UPSTREAM.json`.

## 0.10.0 - 2026-10-16

Reviewed the changes from `e9c4b70d913116284692d7b206a63f39ad6fe8cc`
to `e937077fa92d8cc21d3108d5d1e1f32f37e2534e` (v2.3.0 plus the fixes merged after it).

Adopted:

- Free lane moved to `/inference/v1` with minted session ids, `x-opencode-session-id`,
  the `bash`/`read` tool fingerprint and `FreeTierError` treated as a lane lock.
  Minted sessions persist in the plugin data directory (`session-map.json`), not `~/.dsh`,
  and are removed on uninstall.
- Standalone User-Agent: the anonymous lane refuses the `our-free-model-standalone` token,
  so the managed service sends `ofm-standalone/<version>`.
- Stale `service.lock` recovery on Windows and Linux, plus the desktop OpenCode request
  protocol and tool-name case normalization in the account channels.
- Independent **插件升级** page in the standalone console, separate from service settings.
- The optional `our-free-zen` compatibility entry uses the same wire and reuses the
  upstream fingerprint implementation instead of a second copy.


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
