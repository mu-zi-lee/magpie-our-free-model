import { baseURL, listModels, safeID, positive, fallback, chatRequest, forwardChat } from './transport.mjs';
import { configModels } from '../vendor/zen-free/models.mjs';

const PROVIDER = 'our-free-kilo';
const SDK = '@ai-sdk/openai-compatible';
const DEFAULT_BASE = 'https://api.kilo.ai/api/gateway';
const MANDATORY = /^(stepfun|liquid|thinkingmachines)\//;
const NO_OFF = new Set(['kilo-auto/free', 'openrouter/free']);

export function buildKiloModels(rows, base) {
  const out = {};
  for (const row of rows) {
    if (row?.isFree !== true || !safeID(row.id)) continue;
    const id = row.id.trim();
    if (Object.hasOwn(out, id)) continue;
    const params = Array.isArray(row.supported_parameters) ? row.supported_parameters : [];
    const inputs = row.architecture?.input_modalities ?? ['text'];
    const reasoning = params.includes('reasoning');
    const variants = reasoning ? {
      low: { reasoningEffort: 'low' }, medium: { reasoningEffort: 'medium' }, high: { reasoningEffort: 'high' },
      ...(!MANDATORY.test(id) && !NO_OFF.has(id) ? { disabled: { reasoningEffort: 'disabled' } } : {}),
    } : {};
    out[id] = {
      id, providerID: PROVIDER, name: row.name ?? id, api: { id, url: base, npm: SDK },
      limit: { context: positive(row.context_length, 131072), output: positive(row.top_provider?.max_completion_tokens, 32768) },
      capabilities: { temperature: params.includes('temperature'), reasoning,
        toolcall: params.includes('tools'), attachment: inputs.includes('image'),
        input: { text: true, image: inputs.includes('image'), audio: inputs.includes('audio'), video: inputs.includes('video'), pdf: inputs.includes('file') },
        output: { text: true, image: false, audio: false, video: false, pdf: false } },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      variants, options: {}, headers: {}, status: 'active', release_date: '', free: true,
    };
  }
  return out;
}

export function applyReasoning(body, model) {
  const effort = body.reasoning_effort;
  if (effort === undefined) return;
  if (!model.capabilities.reasoning || !Object.hasOwn(model.variants, effort)) throw new Error('Unsupported reasoning level for this model');
  body.reasoning = effort === 'disabled' ? { ...body.reasoning, enabled: false } : { ...body.reasoning, enabled: true, effort };
  delete body.reasoning_effort;
}

function requirePublic(auth) {
  if (auth?.type !== 'api' || auth.key !== 'public') throw new Error('请先启用 Kilo 免费访问（填写 public，不需要个人密钥）');
}

export async function createKiloPlugin(_input, options = {}) {
  const base = baseURL(options.baseURL ?? DEFAULT_BASE);
  let known = {};
  let inFlight;
  let discoveredAt = 0;
  async function discover(previous = known, signal) {
    if (signal) return refresh(previous, signal);
    if (inFlight) return inFlight;
    inFlight = refresh(previous).finally(() => { inFlight = undefined; });
    return inFlight;
  }
  async function refresh(previous, signal) {
    try {
      const next = buildKiloModels(await listModels(base, undefined, signal), base);
      known = next;
      discoveredAt = Date.now();
      return next;
    } catch (error) {
      signal?.throwIfAborted();
      return fallback(Object.keys(known).length ? known : previous);
    }
  }
  return {
    async config(cfg) {
      cfg.provider ??= {};
      cfg.provider[PROVIDER] ??= { name: 'Our Free Model · Kilo', npm: SDK, api: base, models: configModels(known) };
    },
    auth: {
      provider: PROVIDER, maxConcurrency: 2,
      methods: [{ type: 'api', label: 'Kilo 免费访问（填写 public）', placeholder: 'public',
        async authorize() { return { type: 'success', key: 'public' }; } }],
      async loader(getAuth, provider) {
        const auth = await getAuth();
        if (!auth) return {};
        requirePublic(auth);
        if (!Object.keys(known).length && provider?.models) known = { ...provider.models };
        return { baseURL: base, async fetch(input, init) {
          requirePublic(await getAuth());
          const { request, body } = await chatRequest(input, init, base);
          if (!Object.hasOwn(known, body.model) || Date.now() - discoveredAt > 15 * 60_000) {
            await discover(known, request.signal);
          }
          if (!Object.hasOwn(known, body.model)) throw new Error('Model is not in Kilo’s current free pool; refresh the model list');
          applyReasoning(body, known[body.model]);
          return forwardChat(request, body, { publicLane: true });
        } };
      },
      async usage() { return { plan: 'Kilo 免费池（上游限流；未提供剩余额度）', windows: [] }; },
    },
    provider: { id: PROVIDER, async models(provider, { auth } = {}) {
      if (!auth) return provider.models;
      requirePublic(auth);
      return discover(provider.models);
    } },
  };
}
