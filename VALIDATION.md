# Validation — 0.10.0

## Upstream standalone/core/channel refresh - 2026-10-16

- Reviewed upstream changes from `e9c4b70d913116284692d7b206a63f39ad6fe8cc`
  to `e937077fa92d8cc21d3108d5d1e1f32f37e2534e`. The snapshot retains 90
  original paths: 79 byte-for-byte copies and eleven recorded adapted paths.
  All snapshot SHA-256 digests and channel/EAC pin consistency checks pass.
- `npm test`: 217 tests, 215 pass, 0 fail. The two remaining are the
  30-minute Cloudflare session-expiry test, which passes when run alone and
  times out under the full-suite deadline.
- `node scripts/check.mjs`: plugin contract passes.

## Upstream standalone/core/channel refresh - 2026-10-11

- Reviewed upstream changes from `f8974369c5904858c696b520d8b9b82ad4425f78`
  to `e9c4b70d913116284692d7b206a63f39ad6fe8cc`. The snapshot retains 88
  original paths: 80 byte-for-byte copies and eight recorded adapted paths.
  All snapshot SHA-256 digests and channel/EAC pin consistency checks pass.
- Downloaded the complete new original channel bundle and EAC file set from
  the pinned official source using the production installers; all sizes/hashes
  passed. EAC source files are unchanged at this revision. The public snapshot
  still excludes vault data and embedded OAuth/App ID defaults.
- Added a regression test for native Anthropic forwarding to the real standalone
  account-channel Worker: unauthorized refusal, authenticated JSON text/tools,
  `x-api-key` authenticated SSE, output budget and disabled-model refusal.
  This found an upstream standalone integration gap: the Messages listener
  supplies harness messages, while the Worker originally only accepted OpenAI
  or Responses bodies. The reproducible Worker patch now accepts that format
  and retains the original enablement/effort/budget checks.
- `npm run check` passed. `npm test`: **215 passed, 0 failed, 2 skipped**.
  The two optional native-channel tests passed separately (**2/2**) with the
  verified new original bundle and mocked vendor replies, including Gemini
  credentials and Loomy QR/poll relays.
  One concurrent validation run hit the existing tunnel-expiry fixture's 400 ms
  startup limit under load; rerunning the full suite separately passed. Production
  expiry remains 30 minutes; this fixture can be sensitive to machine load.
- Both real Magpie/Bun smoke scripts passed against isolated fixture services.
  The unified managed smoke, including uninstall, passed using the previously
  built `/tmp/ofm-magpie-uninstall-bin` with the documented uninstall support.
  An initial run against `/tmp/magpie-compaction-darwin` passed login, inference
  and host-exit shutdown but failed cleanup because that build lacks the paired
  uninstall callback support. This is the existing documented host requirement.
- Chromium checked overview, model listing, account channels, EAC and settings
  at 1440x1000 and 390x844. Pages rendered without uncaught script errors; overview
  had no horizontal document overflow. Screenshots of desktop account channels
  and mobile model listing were visually inspected. Browser fixture data and
  generated screenshots remain outside the published package.
- Live vendor account eligibility, real EAC GitHub authorization, Windows proxy
  behavior on Windows and all provider quotas were not tested. No live public
  Cloudflare tunnel was needed for this upstream refresh; existing gateway,
  callback, lifecycle and tunnel fixture coverage passed.
- Aggregate providers, fallback chains and token-saving dependencies are retained
  with the updated core, but upstream standalone management lacks their complete
  configuration and DSH wiring. This release does not claim those controls
  are available in Magpie.

## Previous 0.8.0 validation record

## Accountless Cloudflare console and Tailscale removal — 2026-10-09

- Removed Tailscale client/daemon installation, authorization and runtime integration.
  Saved `consoleAccess: "tailscale"` migrates to Cloudflare. Only legacy cache
  ownership rules remain so uninstall can remove old plugin downloads.
- Official cloudflared **2026.10.0** asset sizes and SHA-256 pins match GitHub
  release metadata for Linux/macOS x64/arm64 and Windows x64. Both macOS archives
  were verified before calculating executable hashes. The official macOS arm64
  binary was downloaded, verified, installed privately and executed successfully.
  No binaries ship in the package; the original Apache-2.0 LICENSE is preserved.
- Live accountless Quick Tunnels were exercised on macOS arm64 using only a
  synthetic management service and fixture credentials. The tunnel connected;
  initial public requests returned DNS `ENOTFOUND`/NXDOMAIN. After approximately
  **80 seconds**, public HTTPS reached the gateway. A second tunnel then passed
  one-use ticket exchange (303), authenticated HTML (200), replay refusal (401)
  and explicit close (200). All tunnel processes and temporary configurations
  were closed afterward. Real Google/WeChat/EAC sign-in was not exercised.
- `npm test`: **214 passed, 0 failed, 2 skipped**. The two optional unchanged
  original-channel tests passed separately (**2/2**) using the verified original
  bundle, a real Worker/gateway and mocked vendor replies. Node/Bun contracts pass.
- Downloader fixtures cover concurrent install, offline reuse, repair, checksum
  rejection before execution, archive/executable verification and official redirect
  restrictions. Tunnel fixtures cover shared opens, isolated config/environment,
  failures, timeouts, 30-minute expiry, close races and owner SIGKILL cleanup.
- Gateway and managed-runner fixtures verify authentication, origin fencing,
  management-only routing, native callback relays and continuing model service
  after remote access closes. Uninstall covers cloudflared caches, incomplete
  downloads, temporary config, legacy Tailscale data and existing external tools.
- Both real Magpie/Bun CLI smoke scripts pass. Fixture runs now intercept browser
  launch commands in their own child PATH and omit transient login URLs from
  successful output. The managed smoke asserts that the browser invocation was
  intercepted. The live user's browser and system PATH are not modified.
- Linux/Windows cloudflared execution was not tested on those platforms. The
  successful public fixture validates this environment at test time; Quick Tunnel
  DNS delay and external service/network availability still affect startup.

## Previous 0.7.0 validation record

## Original channel bundle and remote callbacks — 2026-10-09

- Downloaded all six original channel bundle/dependency/license files from upstream
  commit `f8974369c5904858c696b520d8b9b82ad4425f78`; all pinned sizes and SHA-256
  digests passed. The full original business module is loaded unchanged by the
  existing standalone Worker. No original defaults are copied into the public package.
- The runner no longer reads `gemini-oauth.json` or `loomy-wechat.json`. Invalid
  legacy files do not prevent startup in the real managed service fixture.
- Original-bundle validation uses real Node Worker, standalone management server,
  remote authentication gateway, native Gemini callback listener and native Loomy
  QR/poll listener. Vendor network replies are fixtures: original default Gemini
  client starts login, callback returns through the gateway, native token exchange
  persists refresh token and account identity; Loomy default App ID starts QR login,
  QR HTML/poll paths are rewritten, and native account login/save completes.
- The production managed runner also starts with the original bundle by default,
  despite malformed legacy OAuth/App ID files; original Gemini login starts.
- `npm test`: **213 passed, 0 failed, 2 skipped** (the original-bundle tests
  require a separately downloaded source); that separate native run passed
  **2/2**, so both skipped scenarios were exercised.
- Node/Bun plugin contracts pass. Real Magpie/Bun CLI fixture completes add,
  login, model discovery, inference and uninstall.
- Downloader fixtures verify complete unmodified files, private permissions,
  concurrent install, offline reuse, corruption repair, size/hash rejection,
  symlink rejection and safe failures. Remote relay fixtures reject wrong origin,
  session, port/path/state, duplicates, replay, expired/closed flows and unrelated
  loopback routes; cookies and authorization headers are never forwarded.
- Uninstall fixtures also cover versioned channel downloads and incomplete stages.
- Real Google/WeChat account sign-in, vendor eligibility and live public Funnel
  were not tested. Fixture success does not prove those external services accept
  an account. All channel/model behavior remains pinned to the stated upstream version.

Native bundle validation (requires an already downloaded verified original cache):

```sh
OFM_TEST_CHANNEL_SOURCE=/absolute/path/to/runtime/channels-f8974369c5904858c696b520d8b9b82ad4425f78 \
  node --import ./tests/native-channel-fixture.mjs --test tests/native-channels.test.mjs
```

## Previous 0.6.0 validation record

## Automatic uninstall cleanup — 2026-10-09

- Plugin `magpie.uninstall` declares a standalone cleanup module. The paired
  Magpie change runs it before removing the package/list entry, including when
  disabled, and calls only this plugin's live `lifecycle.dispose` hook first.
  Cleanup is bounded/cancellable. A failure keeps the entry for retry.
- Ownership records retain every data directory used since 0.6.0. Cleanup covers
  automatic Node/Tailscale/EAC downloads and incomplete stages, channel account
  storage, runtime settings/cache/statistics, OAuth configuration and private
  temporary console directories. Exact OFM auth ids and their `#account` suffixes
  are removed under Magpie's auth lock; other providers remain.
- Filesystem fixtures cover history, disabled mode, legacy data adoption, partial
  journal retry, restart after partial cleanup, malformed state/auth, live/unknown
  service locks, expired empty Magpie auth locks, protected paths and replaced
  symlinks. Existing binaries, external EAC source and unrelated custom files
  remain. Repeated uninstall succeeds.
- Real bundled Node service is disposed, its HTTP endpoint closes, registered
  current/history data disappears, and the disposed runtime cannot restart.
- A real Unix socket binds inside a data path longer than 108 bytes through a
  shared private working directory and relative socket name; console shutdown
  removes that directory.
- Modified Magpie CLI + real Bun completes local package add, options, login,
  model listing, loopback fixture inference and `plugin rm`. Service data,
  ownership registry and OFM auth are gone; the pre-existing Node wrapper remains.
  This ran in isolated XDG config/cache paths on macOS arm64.
- Node and Bun contract checks pass; `npm test`: **207 passed, 0 failed, 0 skipped**.
- Magpie native, Linux nogui and Windows builds and vet checks pass. New removal
  tests pass with real Bun; Go source formatting produces no changes.
- `go test -tags nogui ./...` passes under a temporary HOME with pinned Go caches.
- Targeted removal tests also pass with `-race`; paired host implementation is
  [Magpie PR #1](https://github.com/mu-zi-lee/magpie/pull/1), commit
  `d25453b6d55dd7501c21b408e692d65c0fa021da`.
- Replacing Magpie's removal code with its original implementation makes
  `TestRemoveDisabledPluginRunsDeclaredCleanupBeforeRemovingEntry` fail with
  `uninstall left downloaded runtime`. Restoring the change passes.

Uninstall requires the paired Magpie implementation. Updating only this plugin
on a Magpie version without `magpie.uninstall` does not enable automatic cleanup.
Local-folder source checkouts and shared Magpie Bun/caches remain user/host owned.
Pre-0.6 paths that are no longer configured cannot be reconstructed. Other live
Magpie instances must stop before deleting a shared data directory. There was no
live-account deletion, real public Tailscale Funnel or Linux/Windows execution;
cross-platform builds and vet are compilation checks only.

## Previous 0.5.0 validation record

## Automatic EAC source — 2026-10-09

- Original standalone `createStandaloneEac` calls `openSeal` directly, rather than
  the DSH plugin's host-detection gate. The Magpie runner now downloads that
  unchanged module, both dependencies and the MIT license from the official
  pinned commit, verifies fixed SHA-256 hashes, and imports only the complete
  verified set from a private runtime cache. No original material is packaged.
- Live official downloads verified all four hashes. A real Node child started
  through `getManagedRuntime` with default automatic setup, reached the original
  EAC gateway's status endpoint, and returned `available: true`, `configured: true`,
  `required: true`, `authorized: false`. The EAC model credential is absent before
  login. Temporary test data and processes were cleaned up afterward.
- Installer fixtures cover cache reuse offline, permissions, dependency tampering,
  concurrent installation, checksum/size/redirect failure, staging cleanup,
  explicit-source precedence, opt-out, and sanitizing imported module exceptions.
- Real bundled service fixtures verify GitHub authorization collection, original
  HMAC and per-user token forwarding, unified model discovery after login, and
  EAC source failure without disrupting the anonymous model catalog.
- EAC UI now shows safe source setup diagnostics instead of reporting every
  installation failure as an unsupported runtime. Five adapted upstream files
  have updated provenance hashes; 52 of 57 retained paths remain unchanged.
- Node and Bun plugin hook checks pass. Full suite: **195 passed, 0 failed, 0 skipped**.

No real user's GitHub login, Star action, or authorized EAC inference was performed.
The live check confirms source installation and gateway readiness, not free quota
or successful turns after authorization. Source installation on Windows was not
exercised. Existing account data and local API keys are outside the package.

## Previous 0.4.0 run

## Temporary Tailscale console — 2026-10-09

Verified on macOS arm64 with Node and Bun:

- `npm run check` and `bun scripts/check.mjs`: plugin hook checks pass.
- `npm test`: **186 passed; 0 failed; 0 skipped**.
- Linux installer fixtures exercise official pinned URLs, streamed SHA-256 verification,
  matched CLI/daemon extraction, concurrent installation, cache reuse, and rejecting
  a bad checksum before extraction or execution. Official 1.102.4 amd64/arm64 hashes
  were fetched from the release server and pinned in source.
- Controlled CLI processes exercise existing-node reuse, isolated userspace daemon
  with in-memory state/private socket, browser login and Funnel policy authorization,
  free-port selection, foreground-only cleanup, deadline expiry, and worker cleanup
  after SIGKILL of the owner. Existing nodes are never globally reset or logged out.
- Real bundled Node runner and actual management service exercise remote authorize,
  gateway ticket/cookie exchange, management reads, and closing the remote gateway
  while the model service remains available. Funnel transport is a controlled CLI fixture.
- Gateway tests cover unauthenticated requests, replay/expiry, Secure/HttpOnly cookies,
  cross-origin rejection, opening a capability link from Magpie Web, blocked model
  API/local terminal routes, header isolation, and explicit closure.

No live public Funnel or real Tailscale browser authorization was exercised. No Linux
static binary was executed on this macOS host. macOS/Windows system installers are
not automated. Vendor OAuth flows using separate localhost callback listeners still
need their own forwarding; this change does not establish remote login compatibility
for every account channel. The earlier evidence below records the previous run.

## Packaged provider icon

The original `assets/icon.png` is preserved. Its lossless WebP copy is 701,618 bytes
and has identical 1254 × 1254 RGBA pixels, verified by decoding both images.
The package includes both assets. `magpie.icon` supplies the public HTTPS asset;
the auth hook supplies the packaged WebP as a data URI for offline loading.

## Previous 0.3.0 run

Date: 2026-10-09. Linux amd64; Node.js v24.19.0.

## Managed integration

- `npm run check`: one default provider export and hooks passed, no network or credentials.
- `npm test`: **176 passed; 0 failed; 0 skipped**.
- 54 of the 57 retained upstream paths match commit
  `f8974369c5904858c696b520d8b9b82ad4425f78` byte-for-byte. Three adapted paths
  match their declared hashes. Google OAuth defaults and the Loomy WeChat App ID were removed; the EAC vault
  was replaced by an empty stub; and the service accepts an optional local
  credential function. Two encrypted EAC data files are omitted entirely.
  These changes respond to GitHub secret scanning and automatic public-egress review.
- Tests run the actual bundled service in its Node child, including its real
  Worker/channel adapters, with all external fetches redirected to loopback.
- Verified one-use console handoff and reopening, HttpOnly management cookies,
  model discovery, channel image/context metadata, anonymous effort budgets,
  real CodeBuddy tool calls, image bytes, EAC login/poll/signature forwarding
  with a user-selected local fixture credential function (not original secrets),
  model disable admission, key rotation, concurrent startup, graceful shutdown,
  dead-child lock recovery, and account-data retention.
- Original upstream `standalone-channels-test.mjs`: **11/11 checks passed**.
- Original upstream `standalone-management-test.mjs`: **16/16 checks passed**.
  These also use local fixtures; they ran in the separately checked-out pinned
  upstream source, not against production accounts.
- Real official Magpie CLI **0.1.1139** and its **Bun 1.4.2** host passed the
  managed provider sign-in, model metadata and actual Chat request tests.
  After each short-lived CLI host exits, the child stops and releases its lock.
- The optional compatibility-file host suite also passed: three signed-in providers,
  Zen Chat/Responses/Anthropic, Kilo Chat and external-local Chat.

## Automatic Node runtime and single entry

- Main entry exports only `OurFreeModelPlugin`, so normal installation registers
  exactly one provider without compatibility-disable options. Package metadata is
  `magpie-our-free-model` 0.3.0; provider display name is Our Free Model.
- Automatic runtime tests passed in Node and **Bun 1.4.2**: missing-system-Node
  fallback, concurrent download sharing, cache reuse, checksum rejection before
  extraction/execution, failed-install cleanup/retry, explicit-path precedence,
  opt-out, supported target mappings and old/Bun runtime rejection.
- A real official **Node.js 24.21.0 Linux x64** release was downloaded from
  nodejs.org by Bun, checked against the pinned official SHA-256, extracted and
  executed successfully. A second install reused the cache. The actual bundled service
  and installer test suites also passed under this downloaded Node version. This found and fixed
  root/container tar ownership failures using `--no-same-owner` and
  `--no-same-permissions`. No system Node or PATH was modified.
- The bundled service test verifies the configured console handoff port, real
  cookie exchange and shutdown; README provides SSH forwarding for server use.
- The WeChat patch test confirms missing local configuration reports an error,
  configured App ID builds the login URL, and no fixed WeChat App ID remains in
  the compiled bundle. Combined OAuth adaptation was reproduced byte-for-byte
  from the pinned original upstream source. No live Loomy login was performed.
- Windows/macOS/Alpine installers are implemented but not executed on those
  systems. Tests for extraction use small synthetic archives; the separate real
  Linux download check used the official binary, not a synthetic archive.

Reproduce managed-host verification (the Node wrapper is POSIX-only):

```sh
MAGPIE_BIN=/absolute/path/to/magpie node scripts/managed-magpie-smoke.mjs
```

No live vendor inference, real GitHub EAC authorization, or real channel account
login was performed. User-owned Gemini OAuth client configuration and Code Assist
eligibility and Loomy WeChat login configuration were not validated. Browser cookie exchange was verified over HTTP; GUI clicks
and rendering were not exercised. Runtime management is tested on Linux only;
macOS and Windows behavior needs testing on those platforms. The main managed
integration test's POSIX Node wrapper skips on Windows; the other unit tests
still run there. No Node binary is distributed. The hosted management UI and its
backend are retained upstream code, not a newly audited implementation.

The original Magpie used for this historical record did not call custom tool/event/disposal hooks. Models and requests run
through Magpie; management stays in a loopback browser console. Signing out of
the Magpie provider does not itself stop the shared child; exiting its host does.
DSH announcements, plugin self-update/hot reload, LAN relay and DSH Agent resume
are outside this version's integration scope.

## Previous 0.1.0 validation record

Date: 2026-10-09.

## Unit and integration tests

- Runtime: Node.js v24.19.0.
- `node scripts/check.mjs`: three provider exports, config/auth/model hooks passed.
- `npm test`: **156 passed; 0 failed; 0 skipped**.
- Tests use loopback HTTP stand-ins only. No personal accounts or API keys used.
- Retained upstream Zen tests: native Chat Completions, Responses and Anthropic
  Messages; tool snapshots and fragmented deltas; Unicode; protocol errors;
  bounded pending-tool buffers; cancellation and downstream backpressure.
- Added tests: Kilo free-only discovery, paid-model refusal, reasoning menu and
  request mapping, SSE/JSON mismatch, cache fallback, successful empty catalogs,
  Retry-After, caller cancellation, local key substitution and account isolation.

## Real Magpie host

- Official Magpie CLI **0.1.1139**, Linux amd64.
- Download SHA-256 verified against official release metadata:
  `2bce36cf5decc725306af9b5b13fe439a90c9c86ada964f565dc600e6692bbf8`.
- Magpie downloaded and ran its **Bun 1.4.2** plugin host.
- Separate XDG configuration/cache paths; no agent config was changed.
- Added local folder package and set its options with the actual CLI.
- Signed in to all three fixture providers via Magpie's real login prompts.
- `magpie plugin --json` confirms three providers loaded and signed in.
- Kilo context length, image flag and four reasoning variants verified from
  real host output.
- `magpie provider test` passed for:

| Provider | Fixture model | Native upstream protocol |
|---|---|---|
| our-free-zen | chat-free | Chat Completions |
| our-free-zen | responses-free | Responses |
| our-free-zen | messages-free | Anthropic Messages |
| our-free-kilo | fixture/free | Chat Completions |
| our-free-local | qoder/fixture | Chat Completions |

The fixture deliberately labels SSE with `application/json` to check response
prefix detection inside Bun. It also verifies that Kilo receives no key and
the local bridge receives only the local service key.

Reproduce using `MAGPIE_BIN=/path/to/magpie node scripts/magpie-smoke.mjs`.

## Limits of the evidence

No live inference against Zen, Kilo, EAC or the thirteen account channels was
performed. Tests establish plugin installation, host-hook compatibility and
request/response behavior with controlled upstreams. They do not establish
current real model availability, regions, allowances or account eligibility.
The full original OFM service was not installed or tested in this environment;
its local API boundary was represented by the documented fixture.
EAC and account channels remain optional local-service integration, not native
Magpie login implementations. GUI click flows were not exercised; CLI login
and prompts were exercised through the same plugin host.
