import { createHash, randomUUID } from "node:crypto";
import {
  PROVIDER,
  SDK,
  bootstrapProvider,
  buildModels,
  configModels,
  parseProtocolDocs,
} from "./models.mjs";
import { collapseResponse } from "./stream.mjs";
import { guardToolResponse } from "./tool-response.mjs";
import { normalizeResponse } from "../../src/response.mjs";

const DEFAULT_BASE = "https://opencode.ai/zen/v1";
const CATALOG = "https://models.opencode.ai/api.json";
const DOCS =
  "https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/web/src/content/docs/zen.mdx";
const PATHS = { chat: "/chat/completions", responses: "/responses", anthropic: "/messages" };
const CORE_TOOLS = ["bash", "edit", "glob", "grep", "read"];
const OPENCODE_VERSION = "1.18.34";

function httpURL(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Expected an HTTP(S) URL without credentials, query or fragment");
  }
  return url.href.replace(/\/+$/, "");
}

function requirePublic(auth) {
  if (auth?.type !== "api" || auth.key !== "public") {
    throw new Error(
      "OpenCode Zen Free uses the public credential. Enable its free access login method.",
    );
  }
}

async function readRemote(url, json, headers, callerSignal) {
  const timeout = AbortSignal.timeout(15000);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  const response = await fetch(url, { headers, signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Model discovery returned HTTP ${response.status}`);
  }
  return json ? response.json() : response.text();
}

function normalizeTools(body, protocol) {
  if (body.tools !== undefined && !Array.isArray(body.tools)) {
    throw new Error("tools must be an array");
  }
  body.tools ??= [];
  const present = new Set(
    body.tools.map((tool) => (protocol === "chat" ? tool?.function?.name : tool?.name)),
  );
  const declared = new Set([...present].filter((name) => typeof name === "string"));
  if (protocol === "chat" && Array.isArray(body.functions)) {
    for (const tool of body.functions) if (typeof tool?.name === "string") declared.add(tool.name);
  }
  const injected = new Set();
  for (const name of CORE_TOOLS) {
    if (present.has(name)) continue;
    injected.add(name);
    const parameters = { type: "object", properties: {}, additionalProperties: false };
    const definition = { name, description: "Not available. Never call this tool." };
    body.tools.push(
      protocol === "chat"
        ? { type: "function", function: { ...definition, parameters } }
        : protocol === "anthropic"
          ? { ...definition, input_schema: parameters }
          : { type: "function", ...definition, parameters },
    );
  }
  return { declared, injected };
}

function sessionID(headers, body) {
  let signal;
  for (const name of [
    "x-opencode-session",
    "x-session-affinity",
    "x-session-id",
    "conversation-id",
  ]) {
    if (headers.get(name)) {
      signal = headers.get(name);
      break;
    }
  }
  if (!signal && typeof body.metadata?.session_id === "string") signal = body.metadata.session_id;
  if (!signal) {
    const messages = body.messages ?? body.input;
    const first = Array.isArray(messages)
      ? messages.find((message) => message.role === "user")?.content
      : messages;
    signal = first ? JSON.stringify(first) : randomUUID();
  }
  if (/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/.test(signal)) return signal;
  // Keep conversation affinity using OpenCode's canonical session format.
  const hash = createHash("sha256").update(`ses\0${signal}`).digest("hex");
  let value = BigInt(`0x${hash.slice(12, 32)}`);
  let suffix = "";
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  for (let i = 0; i < 14; i++) {
    suffix = alphabet[Number(value % 62n)] + suffix;
    value /= 62n;
  }
  return `ses_${hash.slice(0, 12)}${suffix}`;
}

async function server(_input, options = {}) {
  const baseURL = httpURL(options.baseURL ?? DEFAULT_BASE);
  const catalogURL = httpURL(options.catalogURL ?? CATALOG);
  const docsURL = httpURL(options.docsURL ?? DOCS);
  let known = buildModels(Object.keys(bootstrapProvider.models), bootstrapProvider, {}, baseURL);
  let metadata = bootstrapProvider;
  let protocols = {};
  let listed = false;

  async function discover(signal) {
    const headers = { authorization: "Bearer public", "x-opencode-client": "cli" };
    const [listing, catalog, docs] = await Promise.allSettled([
      readRemote(`${baseURL}/models`, true, headers, signal),
      readRemote(catalogURL, true, undefined, signal),
      readRemote(docsURL, false, undefined, signal),
    ]);
    signal?.throwIfAborted();
    let partial = false;
    if (catalog.status === "fulfilled" && catalog.value?.opencode?.models) {
      metadata = catalog.value.opencode;
    } else {
      partial = true;
    }
    if (docs.status === "fulfilled" && Object.keys(parseProtocolDocs(docs.value)).length) {
      protocols = parseProtocolDocs(docs.value);
    } else {
      partial = true;
    }
    if (listing.status !== "fulfilled" || !Array.isArray(listing.value?.data)) {
      const fallback = { ...known };
      fallback[Symbol.for("magpie.fellBack")] = true;
      return fallback;
    }
    const ids = listing.value.data.map((item) => item.id);
    const discovered = buildModels(ids, metadata, protocols, baseURL);
    if (partial) {
      // Preserve previously verified models only while they remain in the live catalog.
      for (const id of ids) {
        if (!discovered[id] && !metadata.models?.[id] && !protocols[id] && known[id]) {
          discovered[id] = known[id];
        }
      }
      discovered[Symbol.for("magpie.fellBack")] = true;
    }
    known = discovered;
    listed = true;
    return discovered;
  }

  return {
    async config(cfg) {
      cfg.provider ??= {};
      cfg.provider[PROVIDER] ??= {
        name: "OpenCode Zen Free",
        npm: SDK.chat,
        api: baseURL,
        models: configModels(known),
      };
    },
    auth: {
      provider: PROVIDER,
      icon: "https://opencode.ai/favicon-v3.ico",
      maxConcurrency: 2,
      methods: [
        {
          type: "api",
          label: "Zen 免费访问（密钥填写 public）",
          placeholder: "public",
          async authorize() {
            return { type: "success", key: "public" };
          },
        },
      ],
      async loader(getAuth) {
        const auth = await getAuth();
        if (!auth) return {};
        requirePublic(auth);
        return {
          baseURL,
          apiKey: "public",
          async fetch(input, init) {
            requirePublic(await getAuth());
            const request = new Request(input, init);
            const protocol = Object.keys(PATHS).find(
              (key) => request.url === `${baseURL}${PATHS[key]}`,
            );
            if (!protocol || request.method !== "POST")
              throw new Error("Unsupported Zen endpoint or method");
            request.signal.throwIfAborted();
            const body = await request.json();
            if (!body || typeof body !== "object" || Array.isArray(body))
              throw new Error("Expected a JSON request object");
            if (!listed && !Object.hasOwn(known, body.model)) {
              await discover(request.signal);
            }
            const model = known[body.model];
            if (!model || model.api.npm !== SDK[protocol]) {
              throw new Error(
                "Model is not an available free model for this protocol. Refresh the model list.",
              );
            }
            const streaming = body.stream === true;
            body.stream = true;
            const toolPolicy = normalizeTools(body, protocol);
            if (protocol === "chat")
              body.stream_options = { ...body.stream_options, include_usage: true };
            const headers = new Headers(request.headers);
            for (const name of [
              "authorization",
              "x-api-key",
              "x-goog-api-key",
              "content-length",
              "content-encoding",
              "host",
              "cookie",
            ]) {
              headers.delete(name);
            }
            headers.set("content-type", "application/json");
            headers.set("accept", "text/event-stream");
            headers.set("user-agent", `opencode/${OPENCODE_VERSION}`);
            headers.set("x-opencode-client", "cli");
            headers.set("x-opencode-request", `req_${randomUUID().replaceAll("-", "")}`);
            if (!headers.has("x-opencode-project")) {
              const project = _input?.project;
              headers.set(
                "x-opencode-project",
                project?.vcs === "git" && project.id ? project.id : "global",
              );
            }
            const session = sessionID(headers, body);
            for (const name of ["x-session-id", "x-opencode-session", "x-session-affinity"])
              headers.set(name, session);
            if (protocol === "anthropic") {
              headers.set("x-api-key", "public");
              if (!headers.has("anthropic-version")) headers.set("anthropic-version", "2023-06-01");
            } else {
              headers.set("authorization", "Bearer public");
            }
            const response = await fetch(request.url, {
              method: "POST",
              headers,
              body: JSON.stringify(body),
              signal: request.signal,
              redirect: "error",
            });
            const guarded = await guardToolResponse(await normalizeResponse(response), protocol, toolPolicy);
            return streaming ? guarded : collapseResponse(guarded, protocol);
          },
        };
      },
      async usage() {
        return { plan: "OpenCode Zen Free", windows: [] };
      },
    },
    provider: {
      id: PROVIDER,
      async models(provider, { auth } = {}) {
        if (!auth) return provider.models;
        requirePublic(auth);
        return discover();
      },
    },
    async "chat.headers"(input, output) {
      if (![PROVIDER, `${PROVIDER}-plugin`].includes(input.model?.providerID) || !input.sessionID)
        return;
      output.headers["x-session-id"] = input.sessionID;
      output.headers["x-opencode-session"] = input.sessionID;
      output.headers["x-session-affinity"] = input.sessionID;
    },
  };
}

export default { id: PROVIDER, server };

