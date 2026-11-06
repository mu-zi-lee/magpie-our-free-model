import { getManagedRuntime } from './managed-runtime.mjs';
import { safeID, positive, fallback, chatRequest, forwardChat, listModels } from './transport.mjs';
import { remoteByDefault } from './cloudflare-console.mjs';
import fs from 'node:fs';

const PROVIDER = 'our-free-model';
const SDK = '@ai-sdk/openai-compatible';
const boolean = (value, defaultValue = false) => typeof value === 'boolean' ? value : defaultValue;
let providerIcon;

export function managedModel(row, base) {
  if (!safeID(row?.id)) return;
  const id = row.id.trim();
  const inputs = row.input ?? row.modalities?.input ?? [];
  const rawEfforts = row.reasoning_efforts ?? row.reasoning?.efforts;
  const efforts = Array.isArray(rawEfforts) ? rawEfforts : [];
  const variants = {};
  for (const value of efforts) {
    // Offer the canonical name (none/low/…/max) when the service gives one:
    // agents only understand those, and the service maps them back to the
    // channel's own levels (on/off, light/extra_high, …) on every request.
    const effort = typeof value === 'string' ? value : value?.canonical ?? value?.id;
    if (safeID(effort)) variants[effort] = { reasoningEffort: effort };
  }
  return {
    id, providerID: PROVIDER, name: row.name ?? id,
    api: { id, url: base, npm: SDK },
    limit: { context: positive(row.context_window ?? row.context_length, 32768), output: positive(row.max_tokens, 4096) },
    capabilities: { temperature: true, reasoning: boolean(row.reasoning, efforts.length > 0),
      toolcall: boolean(row.tool_call ?? row.toolcall, true), attachment: false,
      input: { text: true, image: boolean(row.vision, inputs.includes('image')), audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false } },
    options: {}, headers: {}, variants, status: 'active', release_date: '',
  };
}

// Channel rules the service doesn't apply on its forward path. WorkBuddy
// rejects a conversation whose first message isn't a system prompt (code
// 11128, sent as an empty stream); CodeArts answers an empty stream to
// max_tokens above 65536.
const CODEARTS_MAX_TOKENS = 65536;
export function adaptChannelRequest(body) {
  const channel = body.model.split('/')[0];
  if (channel === 'workbuddy' && Array.isArray(body.messages) &&
      !['system', 'developer'].includes(body.messages[0]?.role)) {
    body.messages = [{ role: 'system', content: 'You are a helpful assistant.' }, ...body.messages];
  }
  if (channel === 'codearts') {
    for (const field of ['max_tokens', 'max_completion_tokens']) {
      if (Number.isFinite(body[field]) && body[field] > CODEARTS_MAX_TOKENS) body[field] = CODEARTS_MAX_TOKENS;
    }
  }
  return body;
}

export async function createManagedPlugin(input, options = {}) {
  if (options.consoleAccess === 'tailscale') options = { ...options, consoleAccess: 'cloudflare' };
  const runtime = getManagedRuntime(input, options);
  let cache;
  const authorizeConsole = async access => {
    const result = await runtime.command('console', access ? { access } : {});
    const remote = typeof result === 'object';
    return { url: remote ? result.url : result, method: 'auto',
      instructions: remote ? result.instructions : '内置服务已启动。在本机控制台完成 EAC 或账号渠道登录，再回 Magpie 刷新模型。此按钮也可重新打开管理页面。',
      async callback() { return { type: 'success', key: 'managed', metadata: { dataDir: runtime.dataDir } }; } };
  };
  const checkAuth = auth => {
    if (auth?.type !== 'api' || auth.key !== 'managed' || auth.metadata?.dataDir !== runtime.dataDir) {
      throw Object.assign(new Error('请在 Our Free Model 一体化供应商中重新打开控制台并启用'), { signIn: 'expired' });
    }
  };
  // Another Magpie process (the app, while `magpie sync` runs in a terminal)
  // already serves this data directory: list the rows that service shares
  // instead of failing over to the last list.
  async function discoverFromLiveService() {
    const shared = JSON.parse(fs.readFileSync(`${runtime.dataDir}/managed-models.json`, 'utf8'));
    process.kill(shared.pid, 0);
    const { forwardKey } = JSON.parse(fs.readFileSync(`${runtime.dataDir}/settings.json`, 'utf8'));
    return modelsOf(shared.rows, `${shared.url}/v1`, forwardKey);
  }
  // The service's own rows, then the account channels' rows from its model
  // listing: listed here too so their reasoning levels go out by canonical
  // name rather than as the channel's own (on/off, light/extra_high).
  async function modelsOf(rows, base, key) {
    const models = {};
    for (const row of rows) {
      const model = managedModel(row, base);
      if (model) models[model.id] = model;
    }
    try {
      for (const row of await listModels(base, key)) {
        if (models[row?.id] || !row?.reasoning || typeof row.reasoning !== 'object') continue;
        const model = managedModel(row, base);
        if (model) models[model.id] = model;
      }
    } catch {}
    return models;
  }
  async function discover(auth, previous = {}, signal) {
    checkAuth(auth);
    let conn;
    try {
      conn = await runtime.connection();
    } catch (error) {
      if (!/数据目录已被另一个服务占用/.test(error.message)) throw error;
      try { return await discoverFromLiveService(); } catch { throw error; }
    }
    try {
      const models = await modelsOf(await runtime.command('models'), conn.base, conn.key);
      cache = models;
      return models;
    } catch (error) {
      signal?.throwIfAborted();
      if (error.signIn === 'expired') throw error;
      return fallback(cache ?? previous);
    }
  }
  return {
    lifecycle: { dispose: () => runtime.dispose() },
    async config(cfg) {
      cfg.provider ??= {};
      cfg.provider[PROVIDER] ??= { name: 'Our Free Model', npm: SDK, models: {} };
      if (cfg.provider[PROVIDER].name === 'Our Free Model · 一体化（全部渠道）') cfg.provider[PROVIDER].name = 'Our Free Model';
    },
    auth: { provider: PROVIDER, maxConcurrency: 2,
      // Carry the packaged picture without depending on access to GitHub.
      icon: providerIcon ??= `data:image/webp;base64,${fs.readFileSync(new URL('../assets/icon.webp', import.meta.url)).toString('base64')}`,
      methods: [
        { type: 'oauth', label: remoteByDefault(options) ? '启用模型 / 临时远程控制台（免登录）' : '启用模型 / 打开账号管理控制台', authorize: () => authorizeConsole() },
        { type: 'oauth', label: remoteByDefault(options) ? '本机控制台 / SSH 转发' : '临时远程控制台（免登录）', authorize: () => authorizeConsole(remoteByDefault(options) ? 'local' : 'cloudflare') },
      ],
      async loader(getAuth) {
        const auth = await getAuth();
        if (!auth) return {};
        checkAuth(auth);
        const conn = await runtime.connection();
        return { baseURL: conn.base, async fetch(input, init) {
          const currentAuth = await getAuth();
          checkAuth(currentAuth);
          const current = await runtime.connection();
          if (current.base !== conn.base) throw new Error('内置服务地址发生变化，请刷新或重载供应商');
          const { request, body } = await chatRequest(input, init, current.base);
          request.signal.throwIfAborted();
          // A busy channel worker can take longer than the admit check may
          // wait; the service still checks the model, so go on and ask it.
          const admitted = await runtime.command('admit', { model: body.model }, request.signal)
            .catch(error => { if (error.message === '内置服务管理请求超时') return true; throw error; });
          if (!admitted) {
            return Response.json({ error: { type: 'invalid_request_error', message: '模型不存在、已停用或没有可用账号；请在控制台检查并刷新模型' } }, { status: 404 });
          }
          request.signal.throwIfAborted();
          // The service checks its live catalog on every request. Never let an
          // old Magpie cache re-enable a model disabled in the console.
          return forwardChat(request, adaptChannelRequest(body), { key: current.key });
        } };
      },
      async usage(auth) {
        checkAuth(auth);
        await runtime.ensure();
        return { plan: 'Our Free Model 一体化；账号积分、用量、签到和请求日志见本机控制台', windows: [] };
      },
    },
    provider: { id: PROVIDER, async models(provider, { auth } = {}) {
      if (!auth) return provider.models;
      return discover(auth, provider.models);
    } },
  };
}
