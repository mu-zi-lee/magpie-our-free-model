# Third-party notices and provenance

The Zen provider and its streaming/tool-call compatibility code are adapted
from https://github.com/magpie-community/plugins/tree/main/packages/zen-free
at commit 5189b287e7aedd413a3332ef3c5da247a48193a0, fetched on 2026-10-09.
The original MIT license and copyright are preserved in vendor/zen-free/LICENSE.

Local changes: provider id renamed from opencode-zen-free to our-free-zen
(including test expectations); response prefix inspection added; entry wrapped
to export a named provider function; helper added for upstream tests.
The original upstream tests are retained alongside the implementation.

Kilo and local-gateway providers are newly implemented for the documented
Magpie/OpenCode hooks. Their connection design is informed by
https://github.com/Ebony-Vinyl/dsh-our-free-model (src/kilo.js, src/catalog.js,
packages/standalone/README.md) and https://usemagpie.ai/docs/plugins.
No EAC seal, shared signing secret, channel credentials, DSH source bundle,
or WASM is embedded in this plugin. EAC and account channels are accessed
only through a separately running, user-authorized local OFM service.

This is an independent package, not an official Magpie release or a release
by the original OFM maintainer. No npm publication is implied by its name.
