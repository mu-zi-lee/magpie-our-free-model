export const PROVIDER = "our-free-zen";
export const SDK = {
  chat: "@ai-sdk/openai-compatible",
  responses: "@ai-sdk/openai",
  anthropic: "@ai-sdk/anthropic",
};

export function parseProtocolDocs(text) {
  const protocols = {};
  const pattern =
    /\|[^|]+\|\s*`?([^|`\s]+)`?\s*\|\s*`[^`]+\/v1\/(chat\/completions|responses|messages|systemone)`/g;
  for (const match of text.matchAll(pattern)) {
    protocols[match[1]] = {
      "chat/completions": "chat",
      responses: "responses",
      messages: "anthropic",
      systemone: "systemone",
    }[match[2]];
  }
  return protocols;
}

function sdkProtocol(npm) {
  if (npm?.includes("anthropic")) return "anthropic";
  if (npm === SDK.responses) return "responses";
  if (npm?.includes("openai-compatible")) return "chat";
}

function isRetired(model) {
  return (
    model.deprecated === true ||
    ["deprecated", "retired", "disabled"].includes(model.status ?? model.lifecycle) ||
    model.deprecated_at != null ||
    model.retirement_date != null
  );
}

export function isFree(id, model = {}) {
  return (
    !isRetired(model) && (/free/i.test(id) || (model.cost?.input === 0 && model.cost?.output === 0))
  );
}

export function buildModels(ids, provider, protocols, baseURL) {
  const result = {};
  for (const id of ids) {
    if (typeof id !== "string" || !id || id === "__proto__") continue;
    const raw = provider.models?.[id];
    const model = raw ?? {};
    const protocol = protocols[id] ?? (raw && sdkProtocol(model.provider?.npm ?? provider.npm));
    if (!isFree(id, model) || !Object.hasOwn(SDK, protocol)) continue;
    const input = model.modalities?.input ?? ["text"];
    const output = model.modalities?.output ?? ["text"];
    const modalities = (values) =>
      Object.fromEntries(
        ["text", "image", "audio", "video", "pdf"].map((name) => [name, values.includes(name)]),
      );
    const efforts = (model.reasoning_options ?? [])
      .filter((option) => option.type === "effort")
      .flatMap((option) => option.values ?? []);
    result[id] = {
      id,
      providerID: PROVIDER,
      name: model.name ?? id,
      api: { id, url: baseURL, npm: SDK[protocol] },
      limit: { context: 32768, output: 4096, ...model.limit },
      capabilities: {
        temperature: model.temperature ?? true,
        reasoning: model.reasoning ?? false,
        attachment: model.attachment ?? input.some((name) => name !== "text"),
        toolcall: model.tool_call ?? true,
        input: modalities(input),
        output: modalities(output),
        interleaved: model.interleaved ?? false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      variants: Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }])),
      options: {},
      headers: {},
      status: model.status ?? "active",
      release_date: model.release_date ?? "",
      free: true,
    };
  }
  return result;
}

// Offline bootstrap metadata from the OpenCode catalog, 2026-10-06.
export const bootstrapProvider = {
  npm: SDK.chat,
  models: {
    "big-pickle": {
      name: "Big Pickle",
      cost: { input: 0, output: 0 },
      limit: { context: 200000, input: 160000, output: 32000 },
      reasoning: true,
      tool_call: true,
      interleaved: { field: "reasoning_content" },
    },
    "space-bunny-free": {
      name: "Space Bunny Free",
      cost: { input: 0, output: 0 },
      limit: { context: 1048576, input: 524288, output: 524288 },
      reasoning: true,
      tool_call: true,
    },
    "muse-spark-1.3-contributor-free": {
      name: "Muse Spark 1.3 Free",
      cost: { input: 0, output: 0 },
      provider: { npm: SDK.responses },
      limit: { context: 1048576, output: 131072 },
      reasoning: true,
      tool_call: true,
      modalities: { input: ["text", "image", "video", "pdf", "audio"], output: ["text"] },
      reasoning_options: [
        { type: "effort", values: ["minimal", "low", "medium", "high", "xhigh"] },
      ],
    },
  },
};

export function configModels(models) {
  return Object.fromEntries(
    Object.entries(models).map(([id, model]) => [
      id,
      {
        id,
        name: model.name,
        provider: { npm: model.api.npm, api: model.api.url },
        limit: model.limit,
        reasoning: model.capabilities.reasoning,
        tool_call: model.capabilities.toolcall,
        attachment: model.capabilities.attachment,
        modalities: {
          input: Object.keys(model.capabilities.input).filter(
            (key) => model.capabilities.input[key],
          ),
          output: Object.keys(model.capabilities.output).filter(
            (key) => model.capabilities.output[key],
          ),
        },
        cost: { input: 0, output: 0 },
        variants: model.variants,
        free: true,
      },
    ]),
  );
}

