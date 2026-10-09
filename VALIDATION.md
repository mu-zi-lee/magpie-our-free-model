# Validation — 0.1.0

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
