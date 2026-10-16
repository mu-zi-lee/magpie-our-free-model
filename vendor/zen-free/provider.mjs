import { randomUUID } from "node:crypto";
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
import { mintSessionId, SESSION_RE, applyFingerprint } from "../ofm/src/upstream.js";
import { normalizeResponse } from "../../src/response.mjs";

const DEFAULT_BASE = "https://opencode.ai/inference/v1";
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
  const declared = new Set();
  for (const tool of body.tools ?? []) {
    const name = protocol === "chat" ? tool?.function?.name : tool?.name;
    if (typeof name === "string") declared.add(name);
  }
  if (protocol === "chat" && Array.isArray(body.functions)) {
    for (const tool of body.functions) if (typeof tool?.name === "string") declared.add(tool.name);
  }
  const map = applyFingerprint(body, protocol === "responses" ? true : protocol === "anthropic" ? "claude" : false);
  const injected = new Set();
  const folded = new Map();
  for (const [sent, original] of map) {
    if (!declared.has(sent)) injected.add(sent);
    if (sent !== original) folded.set(sent, original);
  }
  return { declared, injected, folded };
}

const sessions = new Map();

function sessionID(headers, body) {
  let signal;
  for (const name of [
    "x-opencode-session-id",
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
  if (SESSION_RE.test(signal)) return signal;
  const remembered = sessions.get(signal);
  if (remembered) return remembered;
  const minted = mintSessionId();
  sessions.set(signal, minted);
  return minted;
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
            for (const name of ["x-session-id", "x-opencode-session", "x-opencode-session-id", "x-session-affinity"])
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
      output.headers["x-opencode-session-id"] = input.sessionID;
      output.headers["x-session-affinity"] = input.sessionID;
    },
  };
}

export default { id: PROVIDER, server };

