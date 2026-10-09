import { getManagedRuntime } from './managed-runtime.mjs';
import { safeID, positive, fallback, chatRequest, forwardChat } from './transport.mjs';
import { remoteByDefault } from './tailscale-console.mjs';
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
    const effort = typeof value === 'string' ? value : value?.id;
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

export async function createManagedPlugin(input, options = {}) {
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
  async function discover(auth, previous = {}, signal) {
    checkAuth(auth);
    const conn = await runtime.connection();
    try {
      const rows = await runtime.command('models');
      const models = {};
      for (const row of rows) {
        const model = managedModel(row, conn.base);
        if (model) models[model.id] = model;
      }
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
        { type: 'oauth', label: remoteByDefault(options) ? '启用模型 / 临时远程控制台（Tailscale）' : '启用模型 / 打开账号管理控制台', authorize: () => authorizeConsole() },
        { type: 'oauth', label: remoteByDefault(options) ? '本机控制台 / SSH 转发' : '临时远程控制台（Tailscale）', authorize: () => authorizeConsole(remoteByDefault(options) ? 'local' : 'tailscale') },
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
          if (!await runtime.command('admit', { model: body.model }, request.signal)) {
            return Response.json({ error: { type: 'invalid_request_error', message: '模型不存在、已停用或没有可用账号；请在控制台检查并刷新模型' } }, { status: 404 });
          }
          request.signal.throwIfAborted();
          // The service checks its live catalog on every request. Never let an
          // old Magpie cache re-enable a model disabled in the console.
          return forwardChat(request, body, { key: current.key });
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
