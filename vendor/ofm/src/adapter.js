/**
 * The provider adapter.
 *
 * It satisfies the harness adapter contract structurally — `registerAdapter`
 * validates by calling the methods, not by an `instanceof` test — which is what
 * lets this plugin mount on more than one kernel line without importing a
 * version-pinned adapter base class.
 *
 * Two routes are published from one adapter instance, because the harness groups
 * the model picker strictly by provider route and offers no other grouping
 * field: `our-free-model` carries what this egress can use right now, and
 * `our-free-model-region` carries what the gateway refuses on this egress. A
 * group with no models is dropped from the picker by the client, so a user whose
 * VPN unlocks the region-gated models sees one group, and a user without sees
 * the second group labelled as such.
 *
 * @module src/adapter.js
 */

import { applyFingerprint, baseModelId, endpointFor, mintRequestId, sessionForConversation, wireFor } from './upstream.js'
import { toChatMessages, toClaudeMessages, toResponseInput, toToolDefs, repairToolPairing } from './messages.js'
import { CODE, UpstreamError, postStreamed } from './http.js'
import { postSealedStreamed } from './eac.js'
import { postKiloStreamed } from './kilo.js'
import { finishReason, readStream, windowTokens } from './stream.js'
import { DEFAULT_LEVEL, MIN_BUDGET, budgetFor, defaultEffortFor, effortPatchFor, effortsFor, resolveLevel } from './effort.js'
import { createChannel } from './channel.js'
import { recoveryPolicy, canRecover, canRecoverSilentStop, recoveryMessages, continuationMessages, checkpointFits, addUsage, createBlockTracker } from './recovery.js'
import { isEacEntry, isKiloEntry } from './catalog.js'

export const ROUTE_MAIN = 'our-free-model'
export const ROUTE_REGION = 'our-free-model-region'

/** Group headings — the only strings the picker shows as a section title. */
export const ROUTE_LABELS = {
  [ROUTE_MAIN]: 'Our Free Model',
  [ROUTE_REGION]: 'Our Free Model · region-limited',
}

const STYLE_FOR_WIRE = { chat: 'chat', responses: 'flat', messages: 'claude' }

export class FreeModelAdapter {
  /**
   * @param {object} dependencies
   * @param {() => {catalog: Array<object>, membership: Record<string, string[]>, settings: object, attributionUserAgent: string}} dependencies.state
   * @param {(ref: object) => string | undefined} [dependencies.resolveImage]
   * @param {(record: object) => void} dependencies.recordUsage
   * @param {(record: object) => void} [dependencies.recordTurn]
   * @param {(message: string) => void} [dependencies.warn]
   */
  constructor(dependencies) {
    this.deps = dependencies
  }

  providerInfo(provider) {
    return { id: provider, name: ROUTE_LABELS[provider] ?? provider }
  }

  /**
   * A fully resolved policy, not a configuration fragment.
   *
   * Both the 0.1.5 and 0.1.7 kernels store this object verbatim instead of
   * running it through their policy resolver, and the backoff scheduler reads the
   * delay fields off the top level. Reporting them nested under `backoff` makes
   * every scheduled delay `NaN`, which the durable session log then rejects —
   * turning a recoverable transient failure into an aborted turn.
   */
  providerRetryPolicy() {
    return Object.freeze({
      mode: 'normal',
      maxRetries: 2,
      // A regional refusal is a property of the egress, not a transient fault;
      // retrying it only spends quota. It is deliberately absent here. So is
      // RATE_LIMIT: this lane's 429 carries a *growing* retry-after, and the two
      // automatic retries turned every quota wall into three walls — the same
      // turn, paid thrice, arriving later (issue #13).
      retryableCodes: Object.freeze(['EMPTY_RESPONSE', 'SERVER', 'TIMEOUT', 'TRANSPORT']),
      initialDelayMs: 700,
      maxDelayMs: 8000,
      jitterRatio: 0.2,
    })
  }

  /**
   * Resolve provider-side request-image pricing for one exact model route.
   *
   * The harness base class supplies a default no-op returning `undefined`
   * (meaning "this route declares no image pricing"); this adapter deliberately
   * extends no version-pinned base class so it can mount on several kernel lines,
   * so it has to provide that default itself. Without it,
   * `ctx.llm.imageRequestPricing()` forwards to a missing method and token
   * measurement — and therefore compaction — throws.
   *
   * Must stay synchronous: the token meter resolves it per measurement, with no
   * I/O window (issue #42).
   *
   * @param {string} _provider - a route passed to `registerAdapter()` for this instance.
   * @param {string} _model - exact model id passed to GenerateOptions.model.
   * @returns always `undefined`: the free egress quotes no per-image price.
   */
  imageRequestPricing(_provider, _model) {
    return undefined
  }

  /** Models this route advertises right now. */
  async listModels(provider) {
    const state = this.deps.state()
    const ids = new Set(state.membership[provider] ?? [])
    return state.catalog
      .filter(entry => ids.has(entry.id))
      .map(entry => ({
        provider,
        id: entry.id,
        name: entry.name,
        description: describe(entry, state.settings),
        inputModalities: entry.vision ? ['text', 'image'] : ['text'],
      }))
  }

  async resolveModel(provider, model) {
    const state = this.deps.state()
    const entry = state.catalog.find(candidate => candidate.id === baseModelId(model))
    if (entry === undefined) {
      return {
        provider,
        id: baseModelId(model),
        name: baseModelId(model),
        context: { contextWindow: 131072 },
        defaultMaxTokens: 8192,
      }
    }
    const ceiling = Math.min(entry.maxOutput, state.settings.defaultMaxTokens ?? 32768)
    const efforts = effortsFor(entry, undefined, state.settings.defaultMaxTokens)
    return {
      provider,
      id: entry.id,
      name: entry.name,
      inputModalities: entry.vision ? ['text', 'image'] : ['text'],
      context: { contextWindow: entry.contextWindow },
      defaultMaxTokens: ceiling,
      ...efforts === undefined ? {} : { reasoning: { efforts, defaultEffort: defaultEffortFor(entry) } },
    }
  }

  /**
   * Bind model metadata and the dispatch closure to one state snapshot, so a
   * catalog refresh arriving mid-turn cannot mix one generation's capacities
   * with another's endpoint table.
   */
  async prepareCall(provider, model) {
    const snapshot = this.deps.state()
    const entry = snapshot.catalog.find(candidate => candidate.id === baseModelId(model)) ?? null
    return {
      model: await this.resolveModel(provider, model),
      stream: options => this.stream(options, entry, snapshot),
    }
  }

  /**
   * @param {object} options - GenerateOptions
   * @param {object|null} pinned - catalog row frozen by `prepareCall`, if any
   * @param {object} [snapshot] - state generation frozen by `prepareCall`
   */
  stream(options, pinned, snapshot = this.deps.state()) {
    const controller = new AbortController()
    const onAbort = () => controller.abort(options.signal?.reason)
    if (options.signal?.aborted === true) onAbort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
    const iterator = this.runStream({ ...options, signal: controller.signal }, pinned, snapshot)
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort)
    const step = async (method, value) => {
      try {
        const row = await iterator[method](value)
        if (row.done) cleanup()
        return row
      } catch (error) {
        cleanup()
        throw error
      }
    }
    // 原生生成器把 return 排在 pending next 后；先取消请求才能立即退出。
    return {
      [Symbol.asyncIterator]() { return this },
      next: value => step('next', value),
      return: value => { controller.abort(); cleanup(); return step('return', value) },
      throw: error => { controller.abort(error); cleanup(); return step('throw', error) },
    }
  }

  async * runStream(options, pinned, snapshot) {
    const settings = snapshot.settings ?? {}
    const started = Date.now()
    const modelId = baseModelId(options.model)
    const recordRejectedTurn = () => this.deps.recordTurn?.({
      at: started,
      model: modelId,
      ok: false,
      recovered: false,
      attempts: 0,
      origin: 'harness',
    })
    const entry = pinned ?? snapshot.catalog.find(candidate => candidate.id === modelId) ?? null

    if (settings.enabled === false) {
      recordRejectedTurn()
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'our free model is switched off in its settings page', code: 'CONFIG_DISABLED' } } }
      return
    }
    if (entry === null) {
      recordRejectedTurn()
      yield { type: 'finish', reason: { kind: 'error', failure: { message: `our free model does not serve "${options.model}" on this egress`, code: CODE.server } } }
      return
    }

    const sealed = isEacEntry(entry)
    const kilo = isKiloEntry(entry)
    // Both absorbed channels speak the Chat wire regardless of what their ids
    // resemble; only the free lane splits endpoints per model.
    const wire = sealed || kilo ? 'chat' : wireFor(entry.id)
    const style = STYLE_FOR_WIRE[wire]
    const warnings = []
    const resolveImage = this.deps.resolveImage
    const messages = repairToolPairing(options.messages ?? [])
    const budget = budgetFor(options.reasoningEffort, entry, options.maxTokens, settings.defaultMaxTokens)
    const declared = toToolDefs(options.tools, style)
    const policy = recoveryPolicy(settings.streamRecovery)
    const session = sessionForConversation(options.sessionId)
    const recoveryId = mintRequestId()
    let attemptMessages = messages
    let attemptBudget = budget
    let nextIndex = 0
    let totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    const blocks = createBlockTracker()
    let turnRecorded = false
    const finishTurn = (ok, recovered = false, attempts = 1) => {
      if (turnRecorded) return
      turnRecorded = true
      this.deps.recordTurn?.({
        at: started,
        model: entry.id,
        ok,
        recovered,
        attempts,
        origin: 'harness',
      })
    }

    // 一次逻辑回合的丢弃内容告警只由首个 payload 收集。检查点估算和续写段都要另建
    // 一份 payload，共用同一个数组会让 `image-dropped` 按 build 次数重复累积，还会
    // 让已经交出去的首段样本跟着后面的 build 一起变长。
    const payloadFor = (input, ceiling, recovering, sink) => {
      const payload = buildPayload(wire, entry.id, input, options, ceiling, resolveImage, sink)
      if (declared.length > 0) payload.tools = declared
      if (typeof options.temperature === 'number' && Number.isFinite(options.temperature)) payload.temperature = options.temperature
      if (wire !== 'responses' && Array.isArray(options.stop) && options.stop.length > 0) payload.stop = options.stop
      if (recovering) payload.tool_choice = wire === 'messages' ? { type: 'none' } : 'none'
      // Both absorbed channels carry a declared thinking menu whose level is
      // the real control on the wire: the selected level rides the request as
      // the model's own effort field (a JSON merge patch, ZCode's declaration
      // shape). The free lane keeps its token-budget behaviour untouched.
      if (sealed || kilo) {
        const patch = effortPatchFor(options.reasoningEffort, entry)
        if (patch !== null) Object.assign(payload, patch)
      }
      if (sealed) applySealedPacingHint(payload)
      return payload
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (options.signal?.aborted === true) {
        finishTurn(false, false, attempt)
        if (attempt > 0) yield { type: 'usage', usage: totalUsage }
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'request aborted', code: CODE.aborted } } }
        return
      }
      const attemptStarted = Date.now()
      const recovering = attempt === 1
      const payload = payloadFor(attemptMessages, attemptBudget, recovering, recovering ? [] : warnings)
      // The absorbed channels have no tool-name gate; their models see the
      // caller's tools exactly as declared, so the fingerprint pass is free-lane only.
      const renameMap = sealed || kilo ? new Map() : applyFingerprint(payload, wire === 'messages' ? 'claude' : style === 'flat')
      const controller = new AbortController()
      const onAbort = () => controller.abort(options.signal?.reason)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      const remainingMs = Math.max(1, policy.totalTimeoutMs - (attemptStarted - started))
      let expired = false
      const timeoutMs = recovering ? Math.min(policy.maxContinuationMs, remainingMs) : remainingMs
      const timer = policy.enabled ? setTimeout(() => {
        expired = true
        controller.abort()
      }, timeoutMs) : undefined
      timer?.unref?.()
      const channel = createChannel()
      const request = (sealed
        ? postSealedTurn(this.deps, payload, controller.signal, value => channel.push(value))
        : kilo
          ? postKiloStreamed({ body: payload, signal: controller.signal, onData: value => channel.push(value) })
          : postStreamed({
          path: endpointFor(entry.id), body: payload, session,
          requestId: attempt === 0 ? recoveryId : mintRequestId(),
          attributionUserAgent: snapshot.attributionUserAgent,
          signal: controller.signal,
          onData: value => channel.push(value),
        }))
        .then(() => channel.push(undefined))
        .catch(error => channel.push(error instanceof Error ? error : new Error(String(error))))
      let firstDeltaAt
      let delivered = false
      let sawAnswer = false
      let recorded = false
      let continuationScheduled = false
      let partialOutcome
      let usageAdded = false
      const record = (ok, outcome, extra = {}) => {
        if (recorded) return
        recorded = true
        const usage = outcome?.sawUsage === true ? outcome.usage : undefined
        this.deps.recordUsage({
          at: attemptStarted,
          model: entry.id,
          effort: resolveLevel(options.reasoningEffort, entry)?.id ?? '',
          ok,
          input: usage?.inputTokens ?? 0,
          output: usage?.outputTokens ?? 0,
          reasoning: usage?.reasoningTokens ?? 0,
          cacheRead: usage?.cacheReadTokens ?? 0,
          decodeTokens: ok ? windowTokens(usage, outcome?.sawReasoning === true) : 0,
          ttftMs: firstDeltaAt === undefined ? undefined : firstDeltaAt - attemptStarted,
          decodeMs: firstDeltaAt === undefined ? 0 : Date.now() - firstDeltaAt,
          origin: 'harness',
          recoveryId,
          attempt,
          elapsedMs: Date.now() - attemptStarted,
          ...recovering ? { recoveryAttempt: true } : {},
          ...outcome?.sawUsage === true ? {} : { noUsage: true },
          ...warnings.length === 0 ? {} : { warnings },
          ...extra,
        })
      }
      try {
        const reader = readStream(channel.read(), wire, renameMap, () => Date.now(), {
          startIndex: nextIndex, checkpointLimit: policy.checkpointLimit,
          onState: value => { partialOutcome = value },
        })
        let outcome
        try {
          while (true) {
            const row = await reader.next()
            if (row.done) { outcome = row.value; break }
            if (options.signal?.aborted === true) throw new UpstreamError('request aborted', CODE.aborted)
            const chunk = row.value
            if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.trim() !== '') sawAnswer = true
            // 续写禁用工具；网关不遵守时也不把工具块交给宿主执行。
            if (recovering && (chunk.blockType === 'tool-call' || chunk.type === 'tool-call-delta' || chunk.block?.type === 'tool-call')) {
              throw new UpstreamError('our free model continuation unexpectedly requested a tool', 'STREAM_CUT')
            }
            if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'tool-call-delta') {
              delivered = true
              if (firstDeltaAt === undefined) firstDeltaAt = Date.now()
            }
            blocks.accept(chunk)
            yield chunk
          }
        } finally {
          await reader.return()
        }
        nextIndex = outcome.nextIndex
        totalUsage = addUsage(totalUsage, outcome.usage, outcome.sawUsage)
        usageAdded = true
        if (options.signal?.aborted === true) {
          record(false, outcome, { aborted: true })
          finishTurn(false, false, attempt + 1)
          yield { type: 'usage', usage: totalUsage }
          yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'request aborted', code: CODE.aborted } } }
          return
        }
        const reason = outcome.brokenToolCall === true ? { kind: 'max-tokens' } : finishReason(outcome.finish)
        // finishReason 是兜底映射，failed/cancelled 也会落成 stop：正常收尾的判定必须显式查原 token。
        const elapsed = Date.now() - started
        const interrupted = canRecover(outcome, policy, elapsed)
        // 正文撞输出上限被截断（finish=length）：把已出正文回灌成 assistant 轮、
        // 用剩余预算自动续写一次，替代宿主提示的「发送继续」手动接力（#28）。
        // 只在首段触发（recovering 段自己也撞墙就如实报 max-tokens，不无限续），
        // 且不与断流/空停续写共用 attempt 名额以外的路径。
        const maxTokensCut = policy.enabled && !recovering && reason.kind === 'max-tokens' && outcome.brokenToolCall !== true
          && outcome.sawText === true && outcome.sawToolCall !== true
          && typeof outcome.answerText === 'string' && outcome.answerText.trim() !== ''
        const silentStop = !interrupted && !maxTokensCut && reason.kind === 'stop'
          // 无 token 的正常收尾（message_stop / response.done 不带 status）也算停收；failed、length 这类有 token 的收尾仍被挡在外面。
          && (outcome.finish === undefined || ['stop', 'end_turn', 'stop_sequence'].includes(outcome.finish))
          && canRecoverSilentStop(outcome, policy, elapsed)
        if (!recovering && (interrupted || silentStop || maxTokensCut)) {
          const remainingTokens = budget - (outcome.sawUsage ? outcome.usage.outputTokens ?? 0 : 0)
          const continuationBudget = Math.min(remainingTokens, policy.maxOutputTokens)
          const nextMessages = maxTokensCut
            ? continuationMessages(messages, outcome.answerText)
            : recoveryMessages(messages, outcome.reasoningText)
          if (continuationBudget >= MIN_BUDGET
            && checkpointFits(payloadFor(nextMessages, continuationBudget, true, []), entry, maxTokensCut ? outcome.answerText : outcome.reasoningText, continuationBudget)) {
            record(false, outcome, { truncated: true, recoveryScheduled: true })
            this.deps.warn?.(maxTokensCut
              ? 'our-free-model: the answer hit the output token ceiling; continuing once from where it stopped'
              : silentStop
                ? 'our-free-model: a stopped turn held only its reasoning; continuing once from its checkpoint'
                : 'our-free-model: interrupted reasoning; continuing once from its checkpoint')
            attemptMessages = nextMessages
            attemptBudget = continuationBudget
            continuationScheduled = true
            continue
          }
        }
        const failedEnding = outcome.finish === 'failed' || outcome.finish === 'cancelled'
        const normalEnding = outcome.finish === undefined || ['stop', 'end_turn', 'stop_sequence'].includes(outcome.finish)
        if (outcome.sawFinish !== true || failedEnding || (recovering && (!sawAnswer
          || outcome.sawToolCall === true || reason.kind !== 'stop' || !normalEnding))) {
          const seconds = Math.round((Date.now() - started) / 1000)
          const code = recovering || delivered || outcome.sawToolCall === true ? 'STREAM_CUT'
            : failedEnding ? CODE.server : CODE.transport
          const message = recovering
            ? `our free model continuation ended without a complete answer after ${seconds}s; automatic recovery exhausted`
            : failedEnding ? `our free model upstream response ended with status ${outcome.finish}`
            : delivered || outcome.sawToolCall === true
              ? `our free model closed the stream after ${seconds}s, before its finish token; automatic recovery was not safe`
              : 'our free model closed the stream before its finish token, without answering; retrying'
          record(false, outcome, { truncated: true })
          finishTurn(false, false, attempt + 1)
          yield { type: 'usage', usage: totalUsage }
          yield { type: 'finish', reason: { kind: 'error', failure: { message, code } } }
          return
        }
        if (outcome.sawText !== true && outcome.sawToolCall !== true && outcome.sawReasoning !== true && reason.kind === 'stop') {
          record(false, outcome)
          finishTurn(false, false, attempt + 1)
          yield { type: 'usage', usage: totalUsage }
          yield { type: 'finish', reason: { kind: 'error', failure: { message: 'our free model returned an empty response', code: CODE.empty } } }
          return
        }
        record(true, outcome, recovering ? { recovered: reason.kind === 'stop' } : {})
        finishTurn(true, recovering && reason.kind === 'stop', attempt + 1)
        yield { type: 'usage', usage: totalUsage }
        yield { type: 'finish', reason }
        if (warnings.length > 0) this.deps.warn?.(`our-free-model: dropped unsupported content for ${entry.id}: ${warnings.join(', ')}`)
        return
      } catch (error) {
        if (error?.code === CODE.region) this.deps.onRegionBlocked?.(entry.id)
        const aborted = options.signal?.aborted === true
        let failure = toFailure(error)
        if (!aborted && (recovering || expired)) {
          failure = { ...failure, code: recovering || delivered || partialOutcome?.sawToolCall === true ? 'STREAM_CUT' : CODE.timeout,
            message: expired
              ? `our free model reached its ${Math.round(timeoutMs / 1000)}s time limit before its finish token${recovering ? ', during the continuation from its checkpoint' : ''}`
              : `our free model continuation failed: ${failure.message}` }
        }
        if (!usageAdded) totalUsage = addUsage(totalUsage, partialOutcome?.usage, partialOutcome?.sawUsage)
        record(false, partialOutcome, { ...(recovering || expired) ? { truncated: true } : {}, ...aborted ? { aborted: true } : {} })
        finishTurn(false, false, attempt + 1)
        for (const chunk of blocks.close()) yield chunk
        if (recovering || partialOutcome?.sawUsage === true) yield { type: 'usage', usage: totalUsage }
        yield { type: 'finish', reason: { kind: aborted ? 'aborted' : 'error', failure } }
        return
      } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        controller.abort()
        await request
        if (!recorded) record(false, partialOutcome, { aborted: true })
        if (!continuationScheduled && !turnRecorded) finishTurn(false, false, attempt + 1)
      }
    }
  }
}

/** The co-paid reasoning models can burn minutes in the thinking channel on
 * turns that need seconds (observed: an entire small token budget spent on
 * reasoning for a one-line answer, first visible byte minutes late). The
 * effort menu owns the hard depth; this one-line prompt asks for pacing so a
 * turn does not sit silent while the model over-explores. Applied on every
 * sealed build, so the continuation and recovery payloads carry it too. */
const SEALED_PACING_HINT =
  'Avoid overthinking: keep your reasoning brief and proportionate to the task.'

function applySealedPacingHint(payload) {
  if (Array.isArray(payload.messages)) {
    const system = payload.messages.find(message => message?.role === 'system' && typeof message.content === 'string')
    if (system !== undefined) {
      system.content = system.content === '' ? SEALED_PACING_HINT : `${system.content}\n\n${SEALED_PACING_HINT}`
      return
    }
    payload.messages.unshift({ role: 'system', content: SEALED_PACING_HINT })
    return
  }
  if (typeof payload.system === 'string') {
    payload.system = payload.system === '' ? SEALED_PACING_HINT : `${payload.system}\n\n${SEALED_PACING_HINT}`
  }
}

/**
 * One co-paid-lane turn: unlock the sealed credential for this request frame
 * and hand it straight to the lane's poster. A host the gate refuses — or a
 * seal that does not open — is a non-retryable configuration state, not a
 * transport fault: `LANE_LOCKED` is deliberately outside the retryable set so
 * a locked host fails its turn once, with a plain message and no retry storm.
 */
async function postSealedTurn(deps, payload, signal, onData) {
  const credential = await Promise.resolve(deps.sealedCredential?.())
  if (credential === null || credential === undefined) throw new UpstreamError('this model lane is not available on this host', 'LANE_LOCKED')
  return postSealedStreamed({ credential, body: payload, signal, onData })
}

function buildPayload(wire, modelId, messages, options, budget, resolveImage, warnings) {
  if (wire === 'responses') {
    const input = toResponseInput(messages, resolveImage, warnings)
    return {
      model: modelId,
      input: input.length > 0 ? input : [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '...' }] }],
      stream: true,
      store: false,
      max_output_tokens: budget,
    }
  }
  if (wire === 'messages') {
    const shaped = toClaudeMessages(messages, resolveImage, warnings)
    return {
      model: modelId,
      messages: shaped.messages,
      stream: true,
      max_tokens: budget,
      ...shaped.system === undefined ? {} : { system: shaped.system },
    }
  }
  const chat = toChatMessages(messages, resolveImage, warnings)
  return {
    model: modelId,
    messages: typeof options.system === 'string' && options.system !== ''
      ? [{ role: 'system', content: options.system }, ...chat]
      : chat,
    stream: true,
    max_tokens: budget,
  }
}

/**
 * Shape one thrown error into the harness's `LlmFailure` vocabulary.
 *
 * The harness writes this object straight into a durable session event, and that
 * log rejects anything that does not survive a lossless JSON round trip — an
 * Error instance, a `NaN`, an explicit `undefined` field. A rejected append
 * aborts the whole turn, so a malformed failure is strictly worse than a sparse
 * one: only the whitelisted fields are carried, each validated, and each dropped
 * rather than emitted in a degraded form.
 */
function toFailure(error) {
  const message = typeof error?.message === 'string' && error.message.length > 0
    ? error.message
    : String(error ?? 'our free model request failed')
  const code = typeof error?.code === 'string' && error.code.length > 0 ? error.code : CODE.transport
  const status = error?.status
  const retryAfter = error?.providerRetryAfterMs
  return {
    message,
    code,
    ...Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {},
    ...Number.isFinite(retryAfter) && retryAfter > 0 ? { providerRetryAfterMs: Math.trunc(retryAfter) } : {},
  }
}

/**
 * The `/model` popup's detail line. The composer renders only the model name, so
 * the capacities that matter for choosing a model — modality, window, whether an
 * effort menu exists — have to fit here.
 *
 * A model that cannot switch its thinking off names the shared ceiling outright:
 * on that lane the rung is not only the answer's budget, and a picker that
 * implied otherwise is how "why is it cut off at 8K when my ceiling is 32K" gets
 * asked.
 */
function describe(entry, settings) {
  const parts = [entry.vision ? 'vision + text input' : 'text input', `${Math.round(entry.contextWindow / 1024)}K context`]
  if (entry.reasoning === true) {
    // A declared menu is the model's own level list on the wire — naming the
    // levels is the honest detail line; "budget" would describe the free lane's
    // ladder, which is exactly what a menu model does not use.
    if (Array.isArray(entry.efforts) && entry.efforts.length > 0) {
      parts.push(`thinking levels: ${entry.efforts.join(' / ')}`)
    } else {
      const rung = Math.round(budgetFor(DEFAULT_LEVEL, entry, undefined, settings?.defaultMaxTokens) / 1024)
      parts.push(entry.canDisableThinking === false
        ? `thinking always on · ${rung}K default ceiling, shared with the answer`
        : 'tunable thinking budget')
    }
  }
  return parts.join(' · ')
}
