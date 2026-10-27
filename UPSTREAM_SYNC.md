# Upstream Maintenance

Target repository: `mu-zi-lee/magpie-our-free-model`, branch `main`.
Source: `Ebony-Vinyl/dsh-our-free-model`.
The source snapshot, not this document, is authoritative: `vendor/ofm/UPSTREAM.json`.

## 0.9.1 - 2026-10-14

Reviewed changes from `e9c4b70d913116284692d7b206a63f39ad6fe8cc`
to upstream 2.2.0 at `9e6121802ab5b87e379a07141e94e36482809147`.

Adopted:

- The matched EAC migration files from the new fixed source revision, downloaded
  into the private runtime cache. Updated both hashes together and added exact
  file sizes to EAC download/cache validation. Real authorization still requires
  the original GitHub/Star workflow; existing users may need to log in again.
- RTK whole-output validation prevents timestamps, source citations or mixed
  webpage prose from being discarded as grep output, including content beyond
  the sampling window. Windows drive paths, filenames containing spaces and
  extensionless search hits are retained. Focused tests cover all three wires.
- Published standalone theme refinements and the upstream service version 2.2.0.
  The original Magpie service, console, cleanup and Anthropic adaptations remain.

Deferred:

- Upstream Tauri desktop packaging/window/tray features do not apply to Magpie's
  managed service. No desktop binary or separate desktop runtime is included.
- Upstream's source-only gateway message identity fixes are not in its published
  standalone business bundle, whose bytes are unchanged. That bundle remains
  pinned and loaded unchanged; this release does not claim to include the fix.
- Aggregate provider, fallback-chain and token-saving configuration controls
  retain the standalone integration limits recorded for 0.9.0.

The original checkout path no longer existed when this run started. Maintenance
used a fresh isolated clone of the target repository in a temporary directory;
no deleted user checkout or application data was recreated.

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

## 2026-10-27 Review

Adopted upstream `97120cd`: availability probes now derive a distinct stable
upstream session from each model id, preventing one model's per-session quota
from making later models appear unavailable. DSH desktop, FleetRelay, probe
shutdown, and release/CI-only changes remain deferred.

## 0.9.2 - 2026-10-24

Reviewed upstream through `38e0a9437e3a37c8c1a030c165de8cf8c7c0b7e8`.

Adopted the reviewed Kilo free-lane usage fix from upstream `d1aae8f` and
`53fe986b`: multimodal usage stamps larger than the advertised context window
no longer poison host context budgeting. The adapter limits this heuristic to
the exact `kilo-auto/free` route and preserves output/reasoning counters.

Deferred DSH-only desktop, sponsor, relay, probe-disabling, FleetRelay and
catalog/UI changes. The pinned vendor snapshot remains the verified Magpie
adaptation; this release records the newer upstream review without copying
unreviewed credentials, vault data or DSH distribution assets.

A Codex app automation attached to the maintenance chat runs every 72 hours.
The user authorized implementing suitable changes, committing and pushing them
directly to the target repository after validation. The task is managed by the
Codex app, not installed as a system service or a GitHub Actions workflow.

For each run:

1. Fetch both repositories and compare the source HEAD with the snapshot pin.
   Review actual code changes and upstream tests; do not copy an unreviewed HEAD.
   If the configured checkout was moved or removed, use a fresh temporary clone
   of the target repository and verify its origin instead of recreating the old
   user-managed checkout. Do not include personal runtime caches in that clone.
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
