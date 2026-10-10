// System One: the free decision models (Jev) are served by Zen on
// /v1/systemone alone. Zen refuses them over chat (403 FreeTierError), so
// this plugin answers the decision API itself, on the one provider it
// already serves.
//
// The plugin's loader calls this: magpie, knowing a plugin provider may
// serve a decision API (its config hook sets decide), posts a System One
// question at the provider's own base /systemone, and the loader forwards
// it to Zen unchanged.
//
// Zen's free decision models are served to OpenCode's own client headers,
// with the public credential, exactly as its free chat pool is.
const ZEN_BASE = 'https://opencode.ai/zen/v1';
const ZEN_HEADERS = { authorization: 'Bearer public', 'x-opencode-client': 'cli' };

// SYSTEMONE_PATH is where a System One request is posted: magpie asks
// <provider base>/systemone, and its own gateway serves both /systemone
// and /v1/systemone, so the route is the same one whatever the base names.
export const SYSTEMONE_PATH = '/systemone';

// isDecisionModel reports whether an id is one of Zen's decision models:
// the Jev family, and any other the free pool serves on System One alone
// (a Clef, if Zen ever offers one). These answer no chat request, so they
// are marked as decisions and never offered to an agent as a model to
// talk to.
export function isDecisionModel(id) {
  const base = String(id).split('/').pop().toLowerCase();
  return /^jev(?:-|$)/.test(base) || /^clef(?:-|$)/.test(base);
}

// isSystemOne reports whether a request path is a System One one. The
// provider's other route is /chat/completions, so a path ending in
// SYSTEMONE_PATH is that route and nothing else.
export function isSystemOne(pathname) {
  return pathname.replace(/\/+$/, '').endsWith(SYSTEMONE_PATH);
}

// forwardSystemOne sends a System One request to Zen unchanged and returns
// its answer as it came: a Jev answer, or its error, is what magpie reads
// either way.
export async function forwardSystemOne(request, body, { fetchImpl = fetch } = {}) {
  const headers = { 'content-type': 'application/json', ...ZEN_HEADERS };
  const upstream = await fetchImpl(`${ZEN_BASE}/systemone`, {
    method: 'POST',
    headers,
    body,
    redirect: 'error',
    signal: request.signal,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
