# Third-party notices and provenance

## Primary upstream: Our Free Model

The full account-channel integration, standalone model runtime, EAC authorization,
statistics and local management UI are from **Ebony-Vinyl/dsh-our-free-model**:
https://github.com/Ebony-Vinyl/dsh-our-free-model
Pinned commit: f8974369c5904858c696b520d8b9b82ad4425f78 (2026-10-09).
57 upstream runtime/asset/license paths are retained under vendor/ofm; 54 are
byte-for-byte copies. UPSTREAM.json records original and adapted hashes and the
two omitted encrypted EAC data files. Three adaptations are documented: removing
bundled Google OAuth defaults and the Loomy WeChat App ID, replacing vault.js with an empty stub, and adding
an optional locally supplied EAC credential function to the standalone service.
The generator patch is scripts/ofm-google-config-patch.mjs. These adaptations
avoid publishing credential material and comply with repository secret scanning.
Gemini requires user-owned OAuth configuration; Loomy WeChat QR login requires private local App ID configuration. EAC requires an explicitly
selected local upstream source; server authorization/login/signature flow remains
unchanged. No original vault decryption code, ciphertext or shards are distributed.
The integration uses the upstream's published standalone entry point.
Original MIT license: vendor/ofm/LICENSE. Channel-pack attribution and MIT license:
vendor/ofm/vendor/channel-pack/NOTICE.md and LICENSE. The channel pack's original
upstream is iJetLi/deepseek-harness-codearts (Gitee), absorbed commit
345f0a07b22713c0ae189ca7d8b97ec4f64626c6.

Qoder's WASM runtime code is retained unchanged. Original EAC material is not
shipped, extracted, logged, re-minted or published. If the user chooses a local
original source, the integration uses its existing credential function solely
inside the local service. Original GitHub/Star authorization and server checks
remain in place. No personal account credentials, local API keys or data directories
are included.

Original standalone third-party notices are preserved in
vendor/ofm/scripts/standalone-third-party.txt. Additional complete licenses for
the bundled UI's React, Radix, TanStack Virtual, Lucide, clsx, tailwind-merge and
Tailwind dependencies are included in vendor/ofm/WEB_THIRD_PARTY_LICENSES.txt.
No Node executable is bundled in this repository. Version 0.3.0 may download an official Node.js 24.21.0 runtime from nodejs.org to the user's private data directory, after checking the pinned official SHA-256. Unix release archives retain their original licenses; Node.js license and third-party terms are also available at https://github.com/nodejs/node/blob/v24.21.0/LICENSE. No remote installation script is executed.

New Magpie-specific code manages the child service, maps model metadata and opens
one-use console handoffs. Those are adaptations, not authorship of OFM's original
channels or management features. This is an independent, unofficial port.

## Compatibility Zen provider

The Zen provider and its streaming/tool-call compatibility code are adapted
from https://github.com/magpie-community/plugins/tree/main/packages/zen-free
at commit 5189b287e7aedd413a3332ef3c5da247a48193a0, fetched on 2026-10-09.
The original MIT license and copyright are preserved in vendor/zen-free/LICENSE.

Local changes: provider id renamed from opencode-zen-free to our-free-zen
(including test expectations); response prefix inspection added; entry wrapped
to export a named provider function; helper added for upstream tests. The optional compatibility wrapper displays Our Free Model · Zen. The main entry no longer loads this provider by default.
The original upstream tests are retained alongside the implementation.

Kilo and local-gateway providers are newly implemented for the documented
Magpie/OpenCode hooks. Their connection design is informed by
https://github.com/Ebony-Vinyl/dsh-our-free-model (src/kilo.js, src/catalog.js,
packages/standalone/README.md) and https://usemagpie.ai/docs/plugins.
These two compatibility providers do not embed EAC credentials. Starting in
0.2.0 the separate managed provider ships the original upstream runtime snapshot
described above, and no longer requires a manually started external OFM service.

This is an independent package, not an official Magpie release or a release
by the original OFM maintainer. No npm publication is implied by its name.

## 临时远程管理入口

插件可从 https://dl.tailscale.com/stable/ 下载官方 Tailscale 1.102.4 Linux 静态发行包，
校验固定 SHA-256 后缓存到用户数据目录；这些二进制不随本仓库分发。
Tailscale 及其第三方组件许可见 https://tailscale.com/licenses 。
临时网关、下载器和进程管理代码位于本仓库 `src/`，未修改固定的上游管理服务。
