// System One: the free decision models (Jev) are served by Zen on
// /v1/systemone alone. Zen refuses them over chat (403 FreeTierError), so
// this plugin answers the decision API itself, on the one provider it
// already serves.
//
// The plugin's loader calls this: magpie, knowing a plugin provider may
// serve a decision API (its config hook sets decide), posts a System One
// question at the provider's own base /systemone, and the loader admits the
// model it names against the service's live catalog before forwarding it to
// Zen unchanged — the same check the provider's chat route applies, so a
// model that never existed, was switched off, or is no decision model is
// refused instead of being forwarded.
//
// Zen's free decision models are served to OpenCode's own client headers,
// with the public credential, exactly as its free chat pool is.
import { safeID } from './transport.mjs';

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

// systemOneModel reads the model a System One request names, or undefined
// when the body is no System One request at all. The route serves this
// provider's decision models alone, and they are admitted exactly as a chat
// one is, so what the request names is read before anything is forwarded.
function systemOneModel(body) {
  let payload;
  try { payload = JSON.parse(body); } catch { return undefined; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  return safeID(payload.model) ? payload.model.trim() : undefined;
}

// serveSystemOne answers one System One request: the model it names has to
// be a decision model this provider serves, and one the service still admits
// — the console's live catalog decides that, not Magpie's cache, so a model
// that never existed, was switched off, or does not answer this API is
// refused here instead of being forwarded for Zen to refuse. `admit` is the
// loader's own admission call; `fetchImpl` is the vendor transport.
export async function serveSystemOne(request, body, { admit, fetchImpl = fetch }) {
  request.signal?.throwIfAborted();
  const model = systemOneModel(body);
  if (!isDecisionModel(model) || !await admit(model)) {
    return Response.json({ error: { type: 'invalid_request_error',
      message: '决策模型不存在、已停用或不受支持；请在控制台检查并刷新模型' } }, { status: 404 });
  }
  request.signal?.throwIfAborted();
  return forwardSystemOne(request, body, { fetchImpl });
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
