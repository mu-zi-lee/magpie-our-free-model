import { baseURL, listModels, safeID, positive, fallback, chatRequest, forwardChat } from './transport.mjs';

const PROVIDER = 'our-free-local';
const SDK = '@ai-sdk/openai-compatible';
const DEFAULT_BASE = 'http://127.0.0.1:18900/v1';

function connection(auth, options) {
  if (auth?.type !== 'api' || typeof auth.key !== 'string' || !auth.key.trim()) throw new Error('请输入独立服务的 API Key');
  return { base: baseURL(auth.metadata?.baseURL || options.baseURL || DEFAULT_BASE, true), key: auth.key };
}

export async function createLocalPlugin(_input, options = {}) {
  const defaultBase = baseURL(options.baseURL ?? DEFAULT_BASE, true);
  // Cache by account object, never share credentials or catalogs between accounts.
  const catalogs = new Map();
  const accountKey = auth => `${auth.metadata?.baseURL || defaultBase}\0${auth.key}`;
  async function discover(auth, previous = {}, signal) {
    const { base, key } = connection(auth, options);
    try {
      const rows = await listModels(base, key, signal);
      const next = {};
      for (const row of rows) {
        if (!safeID(row?.id)) continue;
        const id = row.id.trim();
        next[id] = {
          id, providerID: PROVIDER, name: row.name ?? id,
          api: { id, url: base, npm: SDK },
          limit: { context: positive(row.context_window ?? row.context_length, 32768), output: positive(row.max_tokens, 4096) },
          capabilities: { temperature: true, reasoning: false, toolcall: true, attachment: false,
            input: { text: true, image: false, audio: false, video: false, pdf: false },
            output: { text: true, image: false, audio: false, video: false, pdf: false } },
          options: {}, headers: {}, variants: {}, status: 'active', release_date: '',
        };
      }
      catalogs.set(accountKey(auth), next);
      return next;
    } catch (error) {
      signal?.throwIfAborted();
      if (error.signIn === 'expired') throw error;
      return fallback(catalogs.get(accountKey(auth)) ?? previous);
    }
  }
  return {
    async config(cfg) {
      cfg.provider ??= {};
      cfg.provider[PROVIDER] ??= { name: 'Our Free Model · 本地服务（可选）', npm: SDK, api: defaultBase, models: {} };
    },
    auth: {
      provider: PROVIDER, maxConcurrency: 2,
      methods: [{ type: 'api', label: '独立服务 API Key（EAC / 账号渠道桥接）',
        prompts: [{ type: 'text', key: 'baseURL', message: `本机服务地址（默认 ${defaultBase}；可留空）`,
          placeholder: defaultBase, validate(value) { try { baseURL(value || defaultBase, true); } catch (error) { return error.message; } } }] }],
      async loader(getAuth, provider) {
        const auth = await getAuth();
        if (!auth) return {};
        const { base } = connection(auth, options);
        return { baseURL: base, async fetch(input, init) {
          const current = await getAuth();
          const conn = connection(current, options);
          if (conn.base !== base) throw new Error('Local service address changed; reload the provider');
          const { request, body } = await chatRequest(input, init, base);
          let models = catalogs.get(accountKey(current));
          if (!models || !Object.hasOwn(models, body.model)) models = await discover(current, provider?.models ?? {}, request.signal);
          if (!Object.hasOwn(models, body.model)) throw new Error('Local service does not list this model; log in to the channel in its console and refresh');
          return forwardChat(request, body, { key: conn.key });
        } };
      },
      async usage() { return { plan: '本机 Our Free Model 服务；渠道额度在其控制台查看', windows: [] }; },
    },
    provider: { id: PROVIDER, async models(provider, { auth } = {}) {
      if (!auth) return provider.models;
      return discover(auth, provider.models);
    } },
  };
}
