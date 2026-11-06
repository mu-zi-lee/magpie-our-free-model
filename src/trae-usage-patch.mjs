const BEFORE = `                    const promptTokens = typeof ev.usage.prompt_tokens === "number" ? ev.usage.prompt_tokens : 0;
                    const completionTokens = typeof ev.usage.completion_tokens === "number" ? ev.usage.completion_tokens : 0;
                    const reasoningTokens = typeof ev.usage.reasoning_tokens === "number" ? ev.usage.reasoning_tokens : void 0;
                    yield {
                      type: "usage",
                      usage: {
                        inputTokens: promptTokens,
                        outputTokens: completionTokens,
                        ...reasoningTokens !== void 0 && reasoningTokens > 0 ? { reasoningTokens } : {}
                      }
                    };`;

const AFTER = `                    const promptTokens = typeof ev.usage.prompt_tokens === "number" ? ev.usage.prompt_tokens : 0;
                    const completionTokens = typeof ev.usage.completion_tokens === "number" ? ev.usage.completion_tokens : 0;
                    const reasoningTokens = typeof ev.usage.reasoning_tokens === "number" ? ev.usage.reasoning_tokens : void 0;
                    const cachedTokens = typeof ev.usage.cache_read_input_tokens === "number" && ev.usage.cache_read_input_tokens > 0
                      ? Math.trunc(ev.usage.cache_read_input_tokens)
                      : typeof ev.usage.prompt_cache_hit_tokens === "number" && ev.usage.prompt_cache_hit_tokens > 0
                        ? Math.trunc(ev.usage.prompt_cache_hit_tokens) : 0;
                    yield {
                      type: "usage",
                      usage: {
                        inputTokens: Math.max(0, promptTokens - cachedTokens),
                        outputTokens: completionTokens,
                        ...cachedTokens > 0 ? { cacheReadTokens: cachedTokens } : {},
                        ...reasoningTokens !== void 0 && reasoningTokens > 0 ? { reasoningTokens } : {}
                      }
                    };`;

export function applyTraeUsagePatch(source) {
  if (source.includes('cache_read_input_tokens') && source.includes('inputTokens: Math.max(0, promptTokens - cachedTokens)')) return source;
  if (source.split(BEFORE).length !== 2) throw new Error('Trae usage patch anchor changed');
  return source.replace(BEFORE, AFTER);
}

export function traeUsagePatched(source) {
  return source.includes('cache_read_input_tokens') && source.includes('inputTokens: Math.max(0, promptTokens - cachedTokens)');
}
