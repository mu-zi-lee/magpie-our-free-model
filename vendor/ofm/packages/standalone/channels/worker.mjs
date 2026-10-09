import { parentPort, workerData } from 'node:worker_threads'
import { createCredentials } from './credentials.mjs'
import { attachments } from './images.mjs'
import {
  apply, toGenerateOptions, toResponsesGenerateOptions, normalizeReasoningEffort,
  responsesReasoningEffort, normalizeMaxTokens, responsesMaxOutputTokens, markGatewayChannel,
  collectGatewayModels, collectGatewayEffortViews, toOpenAiModels,
} from './business.mjs'

const cleanups = []
const adapters = new Map()
const routes = new Map()
const controllers = new Map()
let closed = false
const send = message => parentPort.postMessage(message)
const logger = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, message => send({ type: 'log', level, message: String(message) })]))
const credentials = createCredentials(workerData.dataDir)
const ctx = {
  platform: { channelHome: workerData.dataDir }, credentials, logger, attachments,
  connection: { fetch: { register(route) { routes.set(route.path, route) } } },
  get(name) { return this[name] },
  provide(name, value) {
    if (Object.hasOwn(this, name)) throw new Error(`服务重复注册：${name}`)
    this[name] = value
  },
  effect(body) {
    const cleanup = body()
    if (typeof cleanup === 'function') {
      if (closed) void cleanup()
      else cleanups.push(cleanup)
    }
    return cleanup
  },
  inject(names, body) { if (names.every(name => this[name] !== undefined)) return body(this) },
  emit() { send({ type: 'changed' }) },
  llm: {
    registerAdapter(providers, adapter) {
      for (const provider of providers) {
        if (adapters.has(provider)) throw new Error(`渠道重复注册：${provider}`)
        adapters.set(provider, adapter)
      }
    },
    listProviders() { return [...adapters.keys()].map(id => ({ id })) },
    async listModels(provider) { return await adapters.get(provider)?.listModels(provider) ?? [] },
    async resolveModel(provider, model, signal) {
      const adapter = adapters.get(provider)
      if (!adapter) throw Object.assign(new Error('渠道不存在'), { statusCode: 404 })
      return adapter.resolveModel(provider, model, signal)
    },
    async resolveModelInfo(provider, model, signal) { return this.resolveModel(provider, model, signal) },
    async *stream(options) {
      const adapter = adapters.get(options.provider)
      if (!adapter) throw Object.assign(new Error('渠道不存在'), { statusCode: 404 })
      const call = await adapter.prepareCall(options.provider, options.model, options.signal)
      yield* call.stream(options)
    },
  },
}

async function models() {
  const onError = (provider, error) => logger.warn(`${provider} 模型目录读取失败：${error.message}`)
  const groups = (await Promise.all([...adapters.keys()].map(provider => collectGatewayModels({
    listProviders: () => [{ id: provider }],
    listModels: id => ctx.llm.listModels(id),
  }, onError)))).flat()
  const infos = new Map()
  const views = await collectGatewayEffortViews({
    async resolveModelInfo(provider, model) {
      const info = await ctx.llm.resolveModel(provider, model)
      infos.set(`${provider}/${model}`, info)
      return info
    },
  }, groups, onError)
  return toOpenAiModels(groups, views).map(row => ({
    ...row, channel: row.owned_by, vision: row.input?.includes('image') === true,
    context_window: row.context_window ?? infos.get(row.id)?.context?.contextWindow,
    max_tokens: row.max_tokens ?? infos.get(row.id)?.defaultMaxTokens,
  }))
}

async function rpc(call, signal) {
  const route = routes.get('/api/channel-pack')
  if (!route) throw new Error('渠道管理接口未注册')
  const response = await route.fetch(new Request('http://localhost/api/channel-pack', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ type: 'client-request', rpcId: 'standalone', method: 'channel-pack', payload: call }),
  }))
  const reply = await response.json()
  return reply.result
}

async function complete(request, id, signal) {
  const slash = request.model.indexOf('/')
  const provider = request.model.slice(0, slash)
  const model = request.model.slice(slash + 1)
  // 禁用模型和供应商必须同时影响统一 API，不能只隐藏页面。
  if (!(await ctx.llm.listModels(provider)).some(row => row.id === model)) throw Object.assign(new Error('模型不存在或已停用'), { statusCode: 404 })
  const body = { ...request.responsesBody ?? request.openAi, model: request.model }
  const resolved = await ctx.llm.resolveModel(provider, model, signal)
  const effort = normalizeReasoningEffort(request.responses ? responsesReasoningEffort(body) : body.reasoning_effort, resolved, provider, model,
    notice => logger.info(`${request.model}：思考档位 ${notice.requested} ${notice.applied ? `映射为 ${notice.applied}` : '使用模型默认'}`))
  const requested = request.responses ? responsesMaxOutputTokens(body) : body.max_completion_tokens ?? body.max_tokens
  const maxTokens = typeof requested === 'number' ? normalizeMaxTokens(requested, provider, model) : undefined
  const convert = request.responses ? toResponsesGenerateOptions : toGenerateOptions
  const options = await convert(body, signal, effort, maxTokens, { bridge: attachments }, dropped => logger.warn(`忽略无法表达的工具类型：${dropped.type}`))
  options.sessionId = `standalone:${String(body.user ?? body.conversation ?? 'shared')}`
  for await (const chunk of ctx.llm.stream(markGatewayChannel(options))) {
    if (signal.aborted) throw new Error('请求已取消')
    send({ type: 'chunk', id, chunk })
  }
}

parentPort.on('message', async message => {
  if (message.type === 'cancel') { controllers.get(message.id)?.abort(); return }
  if (message.type === 'close') {
    closed = true
    for (const controller of controllers.values()) controller.abort()
    credentials.dispose()
    for (const cleanup of cleanups.reverse()) { try { await cleanup() } catch {} }
    send({ type: 'closed' })
    return
  }
  const { id, type } = message
  const controller = new AbortController()
  controllers.set(id, controller)
  try {
    if (closed) throw new Error('渠道已停止')
    if (type === 'models') send({ type: 'result', id, value: await models() })
    else if (type === 'rpc') send({ type: 'result', id, value: await rpc(message.call, controller.signal) })
    else if (type === 'complete') { await complete(message.request, id, controller.signal); send({ type: 'result', id }) }
    else throw new Error('未知渠道操作')
  } catch (error) {
    send({ type: 'error', id, message: error.message, statusCode: error.statusCode ?? error.status })
  } finally { controllers.delete(id) }
})

apply(ctx, { disableOpencode: true })
send({ type: 'ready', providers: [...adapters.keys()] })
