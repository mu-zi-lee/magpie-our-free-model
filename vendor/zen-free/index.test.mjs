import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { protocols, declaredTools, toolReply } from "./tool-fixtures.mjs";

const subject = import("./index.mjs").then((module) => ({
  default: { server: module.ZenFreePlugin },
}));

async function fixture(t, input = {}) {
  const state = { calls: [], status: 200, modelsStatus: 200, docsStatus: 200, catalogStatus: 200 };
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    state.calls.push({ url: req.url, headers: req.headers, body: text && JSON.parse(text) });
    if (state.discoveryHang) {
      state.onDiscovery?.();
      return;
    }
    if (req.url === "/v1/models") {
      res.writeHead(state.modelsStatus, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          data: [
            { id: "chat-free" },
            { id: "responses-free" },
            { id: "messages-free" },
            { id: "paid" },
          ],
        }),
      );
    } else if (req.url === "/catalog") {
      res.writeHead(state.catalogStatus, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          opencode: {
            npm: "@ai-sdk/openai-compatible",
            models: {
              ...(state.omitChat
                ? {}
                : { "chat-free": { name: "Chat Free", limit: { context: 200000, output: 8192 } } }),
              "responses-free": { provider: { npm: "@ai-sdk/openai" } },
              "messages-free": { provider: { npm: "@ai-sdk/anthropic" } },
              paid: { cost: { input: 3, output: 10 } },
            },
          },
        }),
      );
    } else if (req.url === "/docs") {
      res.writeHead(state.docsStatus);
      res.end(
        `| Model | chat-free | \`https://opencode.ai/zen/v1/${state.chatProtocol ?? "chat/completions"}\` | sdk |`,
      );
    } else if (state.reply) {
      res.writeHead(200, { "content-type": state.contentType ?? "text/event-stream" });
      res.end(state.reply);
    } else if (state.hang) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": heartbeat\n\n");
    } else if (state.status !== 200) {
      res.writeHead(state.status, { "content-type": "application/json", "retry-after": "30" });
      res.end('{"error":{"message":"limited","type":"rate_limit_error"}}');
    } else {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        'data: {"id":"chat-1","model":"chat-free","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const module = await subject;
  assert.equal(typeof module.default?.server, "function", "plugin hooks must be implemented");
  const plugin = await module.default.server(input, {
    baseURL: `${origin}/v1`,
    catalogURL: `${origin}/catalog`,
    docsURL: `${origin}/docs`,
  });
  return { plugin, state, origin };
}

const publicAuth = async () => ({ type: "api", key: "public" });

for (const { protocol, path, model } of protocols) {
  for (const stream of [true, false]) {
    for (const upstreamSSE of [true, false]) {
      test(`${protocol}: guards tool names with client stream=${stream}, upstream SSE=${upstreamSSE}`, async (t) => {
        const { plugin, state, origin } = await fixture(t);
        await plugin.provider.models({ models: {} }, { auth: await publicAuth() });
        const loader = await plugin.auth.loader(publicAuth);
        const tools = declaredTools(protocol);
        state.contentType = upstreamSSE ? "text/event-stream" : "application/json";
        const send = () =>
          loader.fetch(`${origin}/v1/${path}`, {
            method: "POST",
            body: JSON.stringify({ model, stream, tools }),
          });
        for (const [upstream, expected] of [
          ["bash", "Bash"],
          ["read", "Read"],
          ["Bash", "Bash"],
        ]) {
          state.reply = toolReply(protocol, upstream, upstreamSSE);
          const response = await send();
          assert.equal(response.status, 200);
          const text = await response.text();
          assert.match(text, new RegExp(`"name"\\s*:\\s*"${expected}"`));
          assert.doesNotMatch(text, /"name"\s*:\s*"(?:bash|read)"/);
        }
        const outbound = state.calls.at(-1).body.tools;
        assert.deepEqual(outbound.slice(0, tools.length), tools);
        for (const raw of outbound.slice(tools.length)) {
          const tool = protocol === "chat" ? raw.function : raw;
          assert.match(tool.description, /Not available\. Never call this tool\./);
          assert.equal((tool.parameters ?? tool.input_schema).additionalProperties, false);
          assert.deepEqual((tool.parameters ?? tool.input_schema).properties, {});
        }
        state.reply = toolReply(protocol, "edit", upstreamSSE);
        const error = await send();
        if (!stream || !upstreamSSE) assert.equal(error.status, 502);
        const rejected = await error.text();
        assert.match(rejected, /error/);
        assert.doesNotMatch(rejected, /"name"\s*:\s*"edit"/);
      });
    }
  }
}

test("keeps declared tools isolated between requests using the same loader", async (t) => {
  const { plugin, state, origin } = await fixture(t);
  await plugin.provider.models({ models: {} }, { auth: await publicAuth() });
  const loader = await plugin.auth.loader(publicAuth);
  state.reply = toolReply("chat", "bash");
  const send = (tools) =>
    loader.fetch(`${origin}/v1/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model: "chat-free", stream: false, tools }),
    });
  assert.equal((await send(declaredTools("chat"))).status, 200);
  const blocked = await send([]);
  assert.equal(blocked.status, 502);
  assert.doesNotMatch(await blocked.text(), /"name"\s*:\s*"Bash"/);
});

for (const [input, supplied, expected] of [
  [{}, undefined, "global"],
  [{ project: { id: "magpie" } }, undefined, "global"],
  [{ project: { id: "abc123", vcs: "git" } }, undefined, "abc123"],
  [{}, "client-project", "client-project"],
]) {
  test(`uses OpenCode project identity ${expected}`, async (t) => {
    const { plugin, state, origin } = await fixture(t, input);
    await plugin.provider.models({ models: {} }, { auth: await publicAuth() });
    const loader = await plugin.auth.loader(publicAuth);
    const response = await loader.fetch(`${origin}/v1/chat/completions`, {
      method: "POST",
      headers: supplied ? { "x-opencode-project": supplied } : {},
      body: JSON.stringify({ model: "chat-free", stream: true }),
    });
    await response.text();
    assert.equal(state.calls.at(-1).headers["x-opencode-project"], expected);
    assert.equal(state.calls.at(-1).headers["user-agent"], "opencode/1.18.34");
  });
}

test("aborts discovery immediately when the inference caller cancels", async (t) => {
  const { plugin, state, origin } = await fixture(t);
  const loader = await plugin.auth.loader(publicAuth);
  const controller = new AbortController();
  state.discoveryHang = true;
  const started = new Promise((resolve) => {
    state.onDiscovery = resolve;
  });
  const request = loader.fetch(`${origin}/v1/chat/completions`, {
    method: "POST",
    signal: controller.signal,
    body: JSON.stringify({ model: "chat-free", stream: true }),
  });
  const rejected = assert.rejects(request, /abort/i);
  await started;
  controller.abort();
  let timer;
  try {
    await Promise.race([
      rejected,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("discovery ignored caller cancellation")), 500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
});

test("partial discovery never restores a model explicitly changed to SystemOne", async (t) => {
  const { plugin, state } = await fixture(t);
  state.omitChat = true;
  const before = await plugin.provider.models({ models: {} }, { auth: await publicAuth() });
  assert.ok(before["chat-free"]);
  state.catalogStatus = 503;
  state.chatProtocol = "systemone";
  const after = await plugin.provider.models({ models: before }, { auth: await publicAuth() });
  assert.equal(after["chat-free"], undefined);
});

test("registers without overwriting user config and enables public access without a secret", async (t) => {
  const { plugin } = await fixture(t);
  const cfg = {};
  await plugin.config(cfg);
  assert.equal(cfg.provider["our-free-zen"].name, "OpenCode Zen Free");
  cfg.provider["our-free-zen"].name = "My name";
  await plugin.config(cfg);
  assert.equal(cfg.provider["our-free-zen"].name, "My name");
  assert.deepEqual(await plugin.auth.methods[0].authorize(), { type: "success", key: "public" });
  assert.deepEqual(await plugin.auth.loader(async () => undefined), {});
  await assert.rejects(
    plugin.auth.loader(async () => ({ type: "api", key: "paid-secret" })),
    /public/i,
  );
  assert.deepEqual((await plugin.auth.usage(publicAuth)).windows, []);
});

test("discovers protocols and free models, caches success, marks failed refresh as fallback", async (t) => {
  const { plugin, state, origin } = await fixture(t);
  const provider = { models: {} };
  const models = await plugin.provider.models(provider, { auth: await publicAuth() });
  assert.deepEqual(Object.keys(models).sort(), ["chat-free", "messages-free", "responses-free"]);
  assert.equal(models["responses-free"].api.npm, "@ai-sdk/openai");
  assert.equal(models["messages-free"].api.npm, "@ai-sdk/anthropic");
  assert.equal(models["chat-free"].api.url, `${origin}/v1`);
  state.modelsStatus = 503;
  const fallback = await plugin.provider.models({ models }, { auth: await publicAuth() });
  assert.equal(fallback[Symbol.for("magpie.fellBack")], true);
  assert.deepEqual(Object.keys(fallback), Object.keys(models));
});

test("partial catalog failure retains previously verified models rather than dropping them", async (t) => {
  const { plugin, state } = await fixture(t);
  const models = await plugin.provider.models({ models: {} }, { auth: await publicAuth() });
  state.catalogStatus = 503;
  state.docsStatus = 503;
  const fallback = await plugin.provider.models({ models }, { auth: await publicAuth() });
  assert.deepEqual(Object.keys(fallback).sort(), ["chat-free", "messages-free", "responses-free"]);
  assert.equal(fallback[Symbol.for("magpie.fellBack")], true);
});

test("forces upstream streaming, preserves existing tools and returns the SSE body unbuffered", async (t) => {
  const { plugin, state, origin } = await fixture(t);
  await plugin.provider.models({ models: {} }, { auth: await publicAuth() });
  const loader = await plugin.auth.loader(publicAuth);
  const bash = {
    type: "function",
    function: {
      name: "bash",
      description: "real bash",
      parameters: { type: "object", properties: { command: { type: "string" } } },
    },
  };
  const response = await loader.fetch(`${origin}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: "Bearer client-key",
      "x-session-id": "session_123",
      "content-length": "1",
    },
    body: JSON.stringify({
      model: "chat-free",
      stream: true,
      messages: [{ role: "user", content: "hello" }],
      tools: [bash],
    }),
  });
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  assert.match(await response.text(), /\[DONE\]/);
  const sent = state.calls.at(-1);
  assert.equal(sent.headers.authorization, "Bearer public");
  assert.match(sent.headers["x-opencode-session"], /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  assert.equal(sent.headers["x-session-affinity"], sent.headers["x-opencode-session"]);
  assert.equal(sent.headers["x-session-id"], sent.headers["x-opencode-session"]);
  assert.ok(sent.headers["x-opencode-request"]);
  assert.equal(sent.body.stream, true);
  assert.equal(sent.body.stream_options.include_usage, true);
  assert.deepEqual(sent.body.tools[0], bash);
  assert.deepEqual(
    sent.body.tools.map((tool) => tool.function.name),
    ["bash", "edit", "glob", "grep", "read"],
  );
});

test("collapses SSE for a non-streaming client and preserves upstream HTTP errors", async (t) => {
  const { plugin, state, origin } = await fixture(t);
  await plugin.provider.models({ models: {} }, { auth: await publicAuth() });
  const loader = await plugin.auth.loader(publicAuth);
  const send = () =>
    loader.fetch(`${origin}/v1/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model: "chat-free", messages: [{ role: "user", content: "hello" }] }),
    });
  const response = await send();
  assert.equal((await response.json()).choices[0].message.content, "hello");
  state.status = 429;
  const error = await send();
  assert.equal(error.status, 429);
  assert.equal(error.headers.get("retry-after"), "30");
  assert.equal((await error.json()).error.message, "limited");
});

for (const [path, model, key] of [
  ["responses", "responses-free", "parameters"],
  ["messages", "messages-free", "input_schema"],
]) {
  test(`normalizes ${path} tools and authentication using native protocol`, async (t) => {
    const { plugin, state, origin } = await fixture(t);
    await plugin.provider.models({ models: {} }, { auth: await publicAuth() });
    const loader = await plugin.auth.loader(publicAuth);
    const response = await loader.fetch(`${origin}/v1/${path}`, {
      method: "POST",
      body: JSON.stringify({ model, stream: true }),
    });
    await response.text();
    const sent = state.calls.at(-1);
    assert.equal(sent.body.tools[0].name, "bash");
    assert.equal(sent.body.tools[0][key].type, "object");
    if (path === "messages") {
      assert.equal(sent.headers["x-api-key"], "public");
      assert.equal(sent.headers["anthropic-version"], "2023-06-01");
      assert.equal(sent.headers.authorization, undefined);
    }
  });
}

test("rejects paid models, wrong protocol and foreign URLs before sending inference", async (t) => {
  const { plugin, state, origin } = await fixture(t);
  await plugin.provider.models({ models: {} }, { auth: await publicAuth() });
  const loader = await plugin.auth.loader(publicAuth);
  const before = state.calls.length;
  for (const [url, model] of [
    [`${origin}/v1/chat/completions`, "paid"],
    [`${origin}/v1/responses`, "chat-free"],
    ["https://other.example/v1/chat/completions", "chat-free"],
  ]) {
    await assert.rejects(
      loader.fetch(url, { method: "POST", body: JSON.stringify({ model, stream: true }) }),
    );
  }
  assert.equal(state.calls.length, before);
});

test("accepts Request input and aborts a streaming request", async (t) => {
  const { plugin, state, origin } = await fixture(t);
  await plugin.provider.models({ models: {} }, { auth: await publicAuth() });
  const loader = await plugin.auth.loader(publicAuth);
  state.hang = true;
  const controller = new AbortController();
  const req = new Request(`${origin}/v1/chat/completions`, {
    method: "POST",
    signal: controller.signal,
    body: JSON.stringify({ model: "chat-free", stream: true }),
  });
  const response = await loader.fetch(req);
  const body = response.text();
  controller.abort();
  await assert.rejects(body, /abort/i);
});

test("chat headers are scoped to this provider and retain the conversation session", async (t) => {
  const { plugin } = await fixture(t);
  const out = { headers: {} };
  await plugin["chat.headers"]({ model: { providerID: "other" }, sessionID: "s1" }, out);
  assert.deepEqual(out.headers, {});
  await plugin["chat.headers"](
    { model: { providerID: "our-free-zen" }, sessionID: "s1" },
    out,
  );
  assert.equal(out.headers["x-session-id"], "s1");
});

