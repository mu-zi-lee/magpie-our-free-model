# Validation — 0.2.0

Date: 2026-10-09. Linux amd64; Node.js v24.19.0.

## Managed integration

- `npm run check`: four provider exports and hooks passed, no network or credentials.
- `npm test`: **170 passed; 0 failed; 0 skipped**.
- 54 of the 57 retained upstream paths match commit
  `f8974369c5904858c696b520d8b9b82ad4425f78` byte-for-byte. Three adapted paths
  match their declared hashes. Google OAuth defaults were removed; the EAC vault
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
- The previous compatibility-host suite also passed: three signed-in providers,
  Zen Chat/Responses/Anthropic, Kilo Chat and external-local Chat.

Reproduce managed-host verification (the Node wrapper is POSIX-only):

```sh
MAGPIE_BIN=/absolute/path/to/magpie node scripts/managed-magpie-smoke.mjs
```

No live vendor inference, real GitHub EAC authorization, or real channel account
login was performed. User-owned Gemini OAuth client configuration and Code Assist
eligibility were not validated. Browser cookie exchange was verified over HTTP; GUI clicks
and rendering were not exercised. Runtime management is tested on Linux only;
macOS and Windows behavior needs testing on those platforms. The main managed
integration test's POSIX Node wrapper skips on Windows; the other unit tests
still run there. No Node binary is distributed. The hosted management UI and its
backend are retained upstream code, not a newly audited implementation.

Magpie does not call custom tool/event/disposal hooks. Models and requests run
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
