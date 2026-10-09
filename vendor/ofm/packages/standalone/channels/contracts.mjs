import { randomUUID } from 'node:crypto'

/** 渠道服务只持有本实例的平台接口，不依赖 Cordis。 */
export class Service {
  constructor(platform, name) {
    this.ctx = platform
    platform.provide(name, this)
  }
}

/** 各渠道实现完整协议；基类对未实现的接口显式失败。 */
export class LlmAdapter {
  listProviders() { throw new Error('渠道未实现供应商目录') }
  listModels() { throw new Error('渠道未实现模型目录') }
  resolveModel() { throw new Error('渠道未实现模型解析') }
  stream() { throw new Error('渠道未实现流式调用') }
  async prepareCall(provider, model, signal) {
    return { model: await this.resolveModel(provider, model, signal), stream: options => this.stream(options) }
  }
}
export class LlmError extends Error {
  constructor(message, code, options) {
    super(message, options)
    this.name = 'LlmError'
    this.code = code
  }
}
export const credentialRef = value => value
export const ReasoningEffortId = value => value
export const ToolCallId = value => value
export const createUserMessage = value => ({ id: randomUUID(), role: 'user', ...value })
export const attributionHeaders = () => ({ 'user-agent': 'our-free-model-standalone' })
export const CONTEXT_WINDOW_EXCEEDED_CODE = 'CONTEXT_WINDOW_EXCEEDED'
export const EMPTY_RESPONSE_CODE = 'EMPTY_RESPONSE'
export const QUOTA_EXCEEDED_CODE = 'QUOTA_EXCEEDED'
export const isContextWindowExceededError = error => error?.code === CONTEXT_WINDOW_EXCEEDED_CODE
export const isQuotaExceededError = error => error?.code === QUOTA_EXCEEDED_CODE
