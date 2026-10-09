import assert from "node:assert/strict";
import test from "node:test";
import { guardToolResponse } from "./tool-response.mjs";

const encoder = new TextEncoder();

for (const type of [
  "custom_tool_call",
  "computer_call",
  "local_shell_call",
  "shell_call",
  "mcp_call",
  "apply_patch_call",
]) {
  test(`Responses rejects unsupported ${type} in JSON and streaming snapshots`, async () => {
    const item = { type, name: "undeclared_command", call_id: "call1", input: "run" };
    const json = await guardToolResponse(Response.json({ output: [item] }), "responses", policy);
    assert.equal(json.status, 502);
    assertError("responses", await json.json(), false);
    for (const data of [
      { type: "response.output_item.added", item },
      { type: "response.output_item.done", item },
      { type: "response.completed", response: { output: [item] } },
    ]) {
      const response = await guardToolResponse(
        sse(event(data) + terminal("responses")),
        "responses",
        policy,
      );
      const text = await response.text();
      assert.doesNotMatch(text, /undeclared_command/);
      assertError("responses", parse(text)[0].data);
    }
  });
}
const policy = {
  declared: new Set(["Bash", "Read"]),
  injected: new Set(["bash", "read", "shell"]),
};
const protocols = ["chat", "responses", "anthropic"];
const event = (data, name) =>
  `${name ? `event: ${name}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
const terminal = (protocol) =>
  event(
    protocol === "chat"
      ? "[DONE]"
      : { type: protocol === "responses" ? "response.completed" : "message_stop" },
  );
const chat = (delta, finish_reason = null, index = 0) => ({
  choices: [{ index, delta, finish_reason }],
});
const call = (name, index = 0, args = "{}") => ({
  index,
  id: `call-${index}`,
  type: "function",
  function: { name, arguments: args },
});
const tool = (protocol, name) =>
  protocol === "chat"
    ? call(name)
    : protocol === "responses"
      ? { type: "function_call", name, call_id: "call", arguments: "{}" }
      : { type: "tool_use", name, id: "call", input: {} };
function snapshot(protocol, names) {
  const tools = names.map((name) => tool(protocol, name));
  if (protocol === "chat")
    return { choices: [{ message: { role: "assistant", tool_calls: tools } }] };
  return protocol === "responses" ? { output: tools } : { type: "message", content: tools };
}
function streamSnapshot(protocol, names) {
  if (protocol === "chat")
    return chat({ tool_calls: names.map((name, index) => call(name, index)) }, "tool_calls");
  if (protocol === "responses")
    return { type: "response.completed", response: snapshot(protocol, names) };
  return { type: "message_start", message: snapshot(protocol, names) };
}
function namesIn(protocol, data) {
  if (protocol === "chat")
    return data.choices
      .flatMap((choice) => (choice.message ?? choice.delta)?.tool_calls ?? [])
      .map((value) => value.function.name);
  return (
    protocol === "responses" ? (data.response ?? data).output : (data.message ?? data).content
  ).map((value) => value.name);
}
function sse(text, { chunkSize = 31, headers = {}, status = 200 } = {}) {
  const bytes = encoder.encode(text);
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) return controller.close();
        const end = Math.min(offset + chunkSize, bytes.length);
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
      },
    }),
    { status, headers: { "content-type": "text/event-stream", ...headers } },
  );
}
function parse(text) {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r\n\r\n|\n\n|\r\r/)
    .filter(Boolean)
    .map((frame) => {
      const lines = frame.split(/\r\n|\r|\n/);
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      return {
        name: lines
          .find((line) => line.startsWith("event:"))
          ?.slice(6)
          .trim(),
        data: !data || data === "[DONE]" ? data : JSON.parse(data),
      };
    });
}
function assertError(protocol, data, stream = true) {
  if (protocol === "chat") assert.equal(data.error.type, "upstream_error");
  if (protocol === "responses") {
    if (stream) {
      assert.equal(data.type, "error");
      assert.equal(data.code, "undeclared_tool");
    } else {
      assert.equal(data.error.type, "upstream_error");
      assert.equal(data.error.code, "undeclared_tool");
    }
  }
  if (protocol === "anthropic") {
    assert.equal(data.type, "error");
    assert.equal(data.error.type, "api_error");
  }
  assert.equal(typeof (data.message ?? data.error?.message), "string");
}
async function withTimeout(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("stream waited for EOF")), 1500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function openSource(text, cancel = () => {}) {
  let controller;
  let pulls = 0;
  const response = new Response(
    new ReadableStream(
      {
        start(value) {
          controller = value;
        },
        pull(value) {
          pulls++;
          if (pulls === 1) value.enqueue(encoder.encode(text));
        },
        cancel,
      },
      { highWaterMark: 0 },
    ),
    { headers: { "content-type": "text/event-stream" } },
  );
  return {
    response,
    push: (value) => controller.enqueue(encoder.encode(value)),
    close: () => controller.close(),
    pulls: () => pulls,
  };
}

for (const protocol of protocols) {
  test(`${protocol}: JSON maps injected casing and retains declared names`, async () => {
    for (const names of [
      ["bash", "read"],
      ["Bash", "Read"],
    ]) {
      const result = await guardToolResponse(
        Response.json(snapshot(protocol, names)),
        protocol,
        policy,
      );
      assert.equal(result.status, 200);
      assert.deepEqual(namesIn(protocol, await result.json()), ["Bash", "Read"]);
    }
  });

  test(`${protocol}: JSON refuses unknown, non-injected, ambiguous and semantic aliases atomically`, async () => {
    for (const [name, rules] of [
      ["unknown", policy],
      ["shell", policy],
      ["BASH", policy],
      ["bash", { declared: new Set(["Bash", "BASH"]), injected: new Set(["bash"]) }],
      ["bash", { declared: new Set(), injected: new Set(["bash"]) }],
    ]) {
      const response = await guardToolResponse(
        Response.json(snapshot(protocol, ["Read", name])),
        protocol,
        rules,
      );
      assert.equal(response.status, 502);
      const body = await response.json();
      assertError(protocol, body, false);
      assert.equal(body.choices ?? body.output ?? body.content, undefined);
    }
  });

  test(`${protocol}: exact matches win over ambiguous casing`, async () => {
    const rules = { declared: new Set(["bash", "Bash"]), injected: new Set(["bash"]) };
    const result = await guardToolResponse(
      Response.json(snapshot(protocol, ["bash"])),
      protocol,
      rules,
    );
    assert.deepEqual(namesIn(protocol, await result.json()), ["bash"]);
  });

  test(`${protocol}: SSE maps injected casing and retains declared names`, async () => {
    for (const names of [
      ["bash", "read"],
      ["Bash", "Read"],
    ]) {
      const result = await guardToolResponse(
        sse(event(streamSnapshot(protocol, names)) + terminal(protocol)),
        protocol,
        policy,
      );
      assert.equal(result.status, 200);
      const frames = parse(await result.text()).filter(
        (frame) => frame.data && frame.data !== "[DONE]",
      );
      const tools = frames.find(
        (frame) =>
          protocol !== "chat" || frame.data.choices?.some((choice) => choice.delta?.tool_calls),
      );
      assert.deepEqual(namesIn(protocol, tools.data), ["Bash", "Read"]);
      assert.ok(!frames.some((frame) => frame.name === "error" || frame.data.error));
    }
  });

  test(`${protocol}: bad mixed SSE snapshot never leaks a tool and cancels immediately`, async () => {
    for (const name of ["unknown", "shell", "BASH"]) {
      let cancelled = false;
      const source = openSource(
        event(streamSnapshot(protocol, ["Read", name])) + event({ sentinel: "must not escape" }),
        () => {
          cancelled = true;
        },
      );
      const result = await guardToolResponse(source.response, protocol, policy);
      const frames = parse(await withTimeout(result.text()));
      assert.equal(frames.length, 1);
      assertError(protocol, frames[0].data);
      if (protocol !== "chat") assert.equal(frames[0].name, "error");
      assert.equal(cancelled, true);
      assert.equal(source.response.body.locked, false);
    }
  });

  test(`${protocol}: upstream SSE errors pass through byte-for-byte and cancel open streams`, async () => {
    const errors =
      protocol === "responses"
        ? [
            {
              type: "response.failed",
              response: {
                status: "failed",
                error: { code: "rate_limit_exceeded", message: "slow down 中文🙂" },
              },
            },
            { type: "error", code: "rate_limit_exceeded", message: "slow down 中文🙂" },
            { response: { status: "failed", error: { code: "server_error", message: "failed" } } },
          ]
        : protocol === "anthropic"
          ? [{ type: "error", error: { type: "overloaded_error", message: "busy 中文🙂" } }]
          : [
              {
                error: {
                  code: "rate_limit_exceeded",
                  type: "rate_limit_error",
                  message: "slow down 中文🙂",
                  param: null,
                },
              },
            ];
    const rawFrames = errors.map(
      (data) =>
        `\uFEFF: upstream\r\nid: err-7\r\nretry: 200\r\ndata: {\r\ndata: ${JSON.stringify(data).slice(1)}\r\n\r\n`,
    );
    if (protocol === "responses") {
      rawFrames.push(
        event({ response: { error: { code: "rate_limit_exceeded" } } }, "response.failed"),
      );
    }
    rawFrames.push(
      '\uFEFFevent:error\r\ndata: not JSON 中文🙂\r\ndata: second line\r\n\r\n',
      'event: error\ndata: {broken\n\n',
      'event: error\ndata: [DONE]\n\n',
      'event: error\n\n',
    );
    for (const raw of rawFrames) {
      for (const newline of ["\r\n", "\n", "\r"]) {
        const text = raw.replace(/\r\n|\n/g, newline);
        const bytes = encoder.encode(text);
        for (const chunkSize of [1, 2, 7, bytes.length - 1, bytes.length + 1024]) {
          let offset = 0;
          let pulls = 0;
          let cancellations = 0;
          const trailing = encoder.encode(event(streamSnapshot(protocol, ["unknown"])));
          const all = new Uint8Array(bytes.length + trailing.length);
          all.set(bytes);
          all.set(trailing, bytes.length);
          const source = new Response(
            new ReadableStream(
              {
                pull(controller) {
                  pulls++;
                  if (offset === all.length) return;
                  const end = Math.min(offset + chunkSize, all.length);
                  controller.enqueue(all.slice(offset, end));
                  offset = end;
                },
                cancel() {
                  cancellations++;
                },
              },
              { highWaterMark: 0 },
            ),
            { headers: { "content-type": "text/event-stream" } },
          );
          const result = await guardToolResponse(source, protocol, policy);
          const actual = new Uint8Array(await withTimeout(result.arrayBuffer()));
          assert.deepEqual(actual, bytes);
          assert.equal(cancellations, 1);
          assert.equal(source.body.locked, false);
          const lookahead = newline === "\r" && bytes.length % chunkSize === 0 ? 1 : 0;
          assert.equal(pulls, Math.ceil(bytes.length / chunkSize) + lookahead);
        }
        if (newline === "\r") continue;
        let cancelled = false;
        const source = openSource(text, () => {
          cancelled = true;
        });
        const result = await guardToolResponse(source.response, protocol, policy);
        assert.deepEqual(new Uint8Array(await withTimeout(result.arrayBuffer())), bytes);
        assert.equal(cancelled, true);
        assert.equal(source.pulls(), 1);
      }
    }
  });

  test(`${protocol}: upstream SSE errors preserve cancellation failures`, async () => {
    for (const asynchronous of [false, true]) {
      const cause = new DOMException("cancel failed", "AbortError");
      const source = openSource(event("not JSON", "error"), () => {
        if (asynchronous) return Promise.reject(cause);
        throw cause;
      });
      const result = await guardToolResponse(source.response, protocol, policy);
      await assert.rejects(withTimeout(result.arrayBuffer()), (error) => error === cause);
      assert.equal(source.response.body.locked, false);
      assert.equal(source.pulls(), 1);
    }
  });

  test(`${protocol}: HTTP failures return the original unread response`, async () => {
    const source = sse(event(streamSnapshot(protocol, ["unknown"])), { status: 429 });
    assert.equal(await guardToolResponse(source, protocol, policy), source);
    assert.equal(source.bodyUsed, false);
  });

  test(`${protocol}: JSON and SSE remove stale entity headers, retain request metadata`, async () => {
    const headers = { "content-length": "42", "content-encoding": "gzip", "x-request-id": "req" };
    for (const source of [
      Response.json(snapshot(protocol, ["bash"]), { headers }),
      sse(event(streamSnapshot(protocol, ["bash"])) + terminal(protocol), { headers }),
    ]) {
      const result = await guardToolResponse(source, protocol, policy);
      assert.equal(result.headers.get("content-length"), null);
      assert.equal(result.headers.get("content-encoding"), null);
      assert.equal(result.headers.get("x-request-id"), "req");
      await result.text();
    }
  });

  test(`${protocol}: truncated streams emit a protocol error`, async () => {
    for (const text of ["", event({ harmless: true }), 'data: {"unfinished":']) {
      const result = await guardToolResponse(sse(text), protocol, policy);
      assertError(protocol, parse(await result.text()).at(-1).data);
    }
  });

  test(`${protocol}: downstream cancellation propagates its reason without pre-reading`, async () => {
    const reason = new Error("client stopped");
    let received;
    const source = openSource(event({ harmless: true }), (value) => {
      received = value;
    });
    const result = await guardToolResponse(source.response, protocol, policy);
    assert.equal(source.pulls(), 0);
    await result.body.cancel(reason);
    assert.equal(received, reason);
    assert.equal(source.pulls(), 0);
    assert.equal(source.response.body.locked, false);
  });

  test(`${protocol}: transport read failures preserve the original exception`, async () => {
    const cause = new DOMException("upstream aborted", "AbortError");
    const source = new Response(
      new ReadableStream({
        pull(controller) {
          controller.error(cause);
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
    const result = await guardToolResponse(source, protocol, policy);
    await assert.rejects(result.text(), (error) => error === cause);
    assert.equal(source.body.locked, false);
  });

  test(`${protocol}: cancel failures propagate rather than being swallowed`, async () => {
    const cause = new Error("cancel failed");
    for (const badTool of [false, true]) {
      const source = openSource(event(streamSnapshot(protocol, ["unknown"])), () => {
        throw cause;
      });
      const result = await guardToolResponse(source.response, protocol, policy);
      await assert.rejects(
        badTool ? result.text() : result.body.cancel("stop"),
        (error) => error === cause,
      );
      assert.equal(source.response.body.locked, false);
    }
  });

  test(`${protocol}: malformed JSON is a protocol-shaped 502`, async () => {
    const result = await guardToolResponse(
      new Response("{broken", { headers: { "content-type": "application/json" } }),
      protocol,
      policy,
    );
    assert.equal(result.status, 502);
    assertError(protocol, await result.json(), false);
  });
}

test("chat: JSON checks every choice, legacy function_call and missing tool names", async () => {
  const result = await guardToolResponse(
    Response.json({ choices: [{ message: { function_call: { name: "read", arguments: "{}" } } }] }),
    "chat",
    policy,
  );
  assert.equal((await result.json()).choices[0].message.function_call.name, "Read");
  for (const message of [
    { function_call: { name: "unknown" } },
    { tool_calls: [{ type: "function", function: {} }] },
    { tool_calls: [{ type: "custom", custom: { name: "unknown" } }] },
  ]) {
    const source = Response.json({ choices: [{ message: { content: "ok" } }, { message }] });
    assert.equal((await guardToolResponse(source, "chat", policy)).status, 502);
  }
});

test("Responses: nested JSON responses and all streaming snapshots are checked", async () => {
  const nested = await guardToolResponse(
    Response.json({ response: { response: snapshot("responses", ["bash"]) } }),
    "responses",
    policy,
  );
  assert.equal((await nested.json()).response.response.output[0].name, "Bash");
  for (const type of [
    "response.output_item.added",
    "response.output_item.done",
    "response.created",
    "response.in_progress",
    "response.completed",
    "response.incomplete",
    "vendor.snapshot",
  ]) {
    for (const name of ["read", "unknown"]) {
      const data = type.includes("output_item")
        ? { type, item: tool("responses", name) }
        : { type, response: snapshot("responses", [name]) };
      const result = await guardToolResponse(
        sse(event(data, type) + terminal("responses")),
        "responses",
        policy,
      );
      const frames = parse(await result.text());
      if (name === "unknown") {
        assert.equal(frames.length, 1);
        assertError("responses", frames[0].data);
      } else
        assert.equal(frames[0].data.item?.name ?? frames[0].data.response.output[0].name, "Read");
    }
  }
});

test("Anthropic: content_block_start, message_start and server_tool_use are guarded", async () => {
  for (const type of ["tool_use", "server_tool_use"]) {
    for (const name of ["bash", "unknown"]) {
      const block = { type, name, id: "t", input: {} };
      const json = await guardToolResponse(
        Response.json({ content: [block] }),
        "anthropic",
        policy,
      );
      assert.equal(json.status, name === "bash" ? 200 : 502);
      for (const data of [
        { type: "content_block_start", index: 0, content_block: block },
        { type: "message_start", message: { content: [block] } },
      ]) {
        const response = await guardToolResponse(
          sse(event(data) + terminal("anthropic")),
          "anthropic",
          policy,
        );
        const frames = parse(await response.text());
        if (name === "unknown") {
          assert.equal(frames.length, 1);
          assertError("anthropic", frames[0].data);
        } else
          assert.equal(
            frames[0].data.content_block?.name ?? frames[0].data.message.content[0].name,
            "Bash",
          );
      }
    }
  }
});

test("chat: buffers names and arguments by choice/index, including arguments before name", async () => {
  const values = [
    chat({
      tool_calls: [
        { index: 1, function: { arguments: '{"x":' } },
        { index: 0, id: "first", type: "function", function: { name: "ba", arguments: "{}" } },
      ],
    }),
    chat({ tool_calls: [{ index: 0, function: { name: "re", arguments: "{}" } }] }, null, 1),
    chat({
      content: "你好",
      tool_calls: [
        { index: 1, id: "second", type: "function", function: { name: "re", arguments: "1}" } },
        { index: 0, function: { name: "sh" } },
      ],
    }),
    chat({ tool_calls: [{ index: 0, function: { name: "ad" } }] }, "tool_calls", 1),
    chat({ tool_calls: [{ index: 1, function: { name: "ad" } }] }, "tool_calls"),
  ];
  const result = await guardToolResponse(
    sse(values.map((value) => event(value)).join("") + terminal("chat"), { chunkSize: 1 }),
    "chat",
    policy,
  );
  const choices = parse(await result.text()).flatMap((frame) => frame.data.choices ?? []);
  const toolChoices = choices.filter((choice) => choice.delta?.tool_calls);
  assert.equal(toolChoices.length, 2);
  assert.deepEqual(toolChoices.find((choice) => choice.index === 0).delta.tool_calls, [
    { index: 0, id: "first", type: "function", function: { name: "Bash", arguments: "{}" } },
    { index: 1, id: "second", type: "function", function: { name: "Read", arguments: '{"x":1}' } },
  ]);
  assert.equal(
    toolChoices.find((choice) => choice.index === 1).delta.tool_calls[0].function.name,
    "Read",
  );
  assert.equal(
    choices
      .filter((choice) => choice.delta?.content)
      .map((choice) => choice.delta.content)
      .join(""),
    "你好",
  );
});

test("chat: legacy fragments flush at DONE, but truncated pending calls never escape", async () => {
  const prefix =
    event(chat({ function_call: { arguments: "{}" } })) +
    event(chat({ function_call: { name: "ba" } })) +
    event(chat({ function_call: { name: "sh" } }));
  const success = await guardToolResponse(sse(prefix + terminal("chat")), "chat", policy);
  const frames = parse(await success.text());
  const calls = frames
    .flatMap((frame) => frame.data.choices ?? [])
    .filter((choice) => choice.delta?.function_call);
  assert.deepEqual(
    calls.map((choice) => choice.delta.function_call),
    [{ name: "Bash", arguments: "{}" }],
  );
  const failure = await guardToolResponse(sse(prefix), "chat", policy);
  const failed = parse(await failure.text());
  assert.equal(failed.length, 1);
  assertError("chat", failed[0].data);
});

test("chat: text and usage flow immediately while tools wait, without reading the conversation", async () => {
  let cancelled = false;
  const text = event(chat({ content: "first", tool_calls: [call("ba")] }));
  const source = openSource(text, () => {
    cancelled = true;
  });
  const result = await guardToolResponse(source.response, "chat", policy);
  const reader = result.body.getReader();
  const first = await withTimeout(reader.read());
  const firstData = parse(new TextDecoder().decode(first.value))[0].data;
  assert.equal(firstData.choices[0].delta.content, "first");
  assert.equal(firstData.choices[0].delta.tool_calls, undefined);
  assert.equal(source.pulls(), 1);
  source.push(event({ choices: [], usage: { total_tokens: 12 } }));
  const usage = await withTimeout(reader.read());
  assert.equal(parse(new TextDecoder().decode(usage.value))[0].data.usage.total_tokens, 12);
  await reader.cancel("enough");
  assert.equal(cancelled, true);
});

test("chat: one chunk containing many text events still obeys downstream backpressure", async () => {
  let cancelled = false;
  const source = openSource(
    event(chat({ content: "one" })) +
      event(chat({ content: "two" })) +
      event(chat({ tool_calls: [call("unknown")] }, "tool_calls")),
    () => {
      cancelled = true;
    },
  );
  const result = await guardToolResponse(source.response, "chat", policy);
  const reader = result.body.getReader();
  assert.equal(
    parse(new TextDecoder().decode((await reader.read()).value))[0].data.choices[0].delta.content,
    "one",
  );
  assert.equal(cancelled, false);
  assert.equal(
    parse(new TextDecoder().decode((await reader.read()).value))[0].data.choices[0].delta.content,
    "two",
  );
  assert.equal(cancelled, false);
  assertError("chat", parse(new TextDecoder().decode((await reader.read()).value))[0].data);
  assert.equal(cancelled, true);
});

test("SSE handles UTF8, BOM, CRLF, CR-only, multiline data and arbitrary chunks", async () => {
  const raw =
    '\uFEFF: ping\r\nid: 7\r\nevent: message\r\ndata: {"choices":\r\ndata: [{"index":0,"delta":{"content":"中文🙂"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n';
  for (const text of [raw, raw.replaceAll("\r\n", "\r"), raw.replaceAll("\r\n", "\n")]) {
    for (const chunkSize of [1, 2, 3, 7, 1024]) {
      const result = await guardToolResponse(sse(text, { chunkSize }), "chat", policy);
      const frames = parse(await result.text());
      assert.equal(frames[0].data.choices[0].delta.content, "中文🙂");
      assert.equal(frames[1].data, "[DONE]");
    }
  }
});

test("ordinary events retain SSE metadata without buffering", async () => {
  for (const protocol of protocols) {
    const text = ': keepalive\nid: 8\nretry: 200\nevent: vendor.text\ndata: {"text":"hello"}\n\n';
    const source = openSource(text);
    const result = await guardToolResponse(source.response, protocol, policy);
    const reader = result.body.getReader();
    assert.equal(new TextDecoder().decode((await withTimeout(reader.read())).value), text);
    await reader.cancel();
  }
});

test("single SSE event limit is 32 MiB and cancels an unterminated upstream", async () => {
  let cancelled = false;
  let pulls = 0;
  const bytes = encoder.encode("x".repeat(1024 * 1024));
  const source = new Response(
    new ReadableStream(
      {
        pull(controller) {
          pulls++;
          controller.enqueue(bytes);
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    ),
    { headers: { "content-type": "text/event-stream" } },
  );
  const result = await guardToolResponse(source, "chat", policy);
  const frames = parse(await result.text());
  assertError("chat", frames[0].data);
  assert.match(frames[0].data.error.message, /32 MiB|limit/i);
  assert.equal(cancelled, true);
  assert.ok(pulls <= 33);
});

test("cumulative pending chat tools are limited across choices and calls", async () => {
  let cancelled = false;
  let pulls = 0;
  const argumentsChunk = "x".repeat(1024 * 1024);
  const source = new Response(
    new ReadableStream(
      {
        pull(controller) {
          controller.enqueue(
            encoder.encode(
              event(chat({ tool_calls: [call("bash", pulls, argumentsChunk)] }, null, pulls++ % 2)),
            ),
          );
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    ),
    { headers: { "content-type": "text/event-stream" } },
  );
  const result = await guardToolResponse(source, "chat", policy);
  const frames = parse(await result.text());
  assert.equal(frames.length, 1);
  assertError("chat", frames[0].data);
  assert.match(frames[0].data.error.message, /32 MiB|limit/i);
  assert.equal(cancelled, true);
  assert.ok(pulls <= 33);
});

test("chat: DONE validates all pending choices atomically and rejects missing final names", async () => {
  for (const ending of [
    terminal("chat"),
    event({
      choices: [
        { index: 0, delta: {}, finish_reason: "tool_calls" },
        { index: 1, delta: {}, finish_reason: "tool_calls" },
      ],
    }),
  ]) {
    for (const name of ["unknown", ""]) {
      const text =
        event(chat({ tool_calls: [call("bash")] })) +
        event(chat({ tool_calls: [call(name)] }, null, 1)) +
        ending;
      const response = await guardToolResponse(sse(text), "chat", policy);
      const frames = parse(await response.text());
      assert.equal(frames.length, 1);
      assertError("chat", frames[0].data);
    }
  }
});

test("SSE: ambiguous injected names fail in every protocol", async () => {
  const rules = { declared: new Set(["Bash", "BASH"]), injected: new Set(["bash"]) };
  for (const protocol of protocols) {
    const response = await guardToolResponse(
      sse(event(streamSnapshot(protocol, ["bash"])) + terminal(protocol)),
      protocol,
      rules,
    );
    const frames = parse(await response.text());
    assert.equal(frames.length, 1);
    assertError(protocol, frames[0].data);
  }
});

test("downstream cancellation interrupts a pending upstream read", async () => {
  for (const protocol of protocols) {
    let cancelReason;
    const source = openSource(event({ harmless: true }), (reason) => {
      cancelReason = reason;
    });
    const response = await guardToolResponse(source.response, protocol, policy);
    const reader = response.body.getReader();
    await reader.read();
    const waiting = reader.read();
    await Promise.resolve();
    await withTimeout(reader.cancel("abort now"));
    assert.equal((await withTimeout(waiting)).done, true);
    assert.equal(cancelReason, "abort now");
    assert.equal(source.response.body.locked, false);
  }
});

test("chat: completed tool buffers release their cumulative budget", async () => {
  let count = 0;
  const bytes = encoder.encode(
    event(chat({ tool_calls: [call("bash", 0, "x".repeat(1024 * 1024))] }, "tool_calls")),
  );
  const source = new Response(
    new ReadableStream({
      pull(controller) {
        if (count < 34) {
          count++;
          return controller.enqueue(bytes);
        }
        if (count++ === 34) return controller.enqueue(encoder.encode(terminal("chat")));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  const response = await guardToolResponse(source, "chat", policy);
  const reader = response.body.getReader();
  let tools = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const data = parse(new TextDecoder().decode(value))[0].data;
    if (data === "[DONE]") continue;
    assert.equal(data.choices[0].delta.tool_calls[0].function.name, "Bash");
    tools++;
  }
  assert.equal(tools, 34);
});

test("SSE event byte limit includes both bytes of CRLF even across chunks", async () => {
  const prefix = 'data: {"text":"';
  const suffix = '"}\r\n\r\n';
  const text = prefix + "x".repeat(32 * 1024 * 1024 + 1 - prefix.length - suffix.length) + suffix;
  for (const chunkSize of [1024 * 1024, text.length - 1]) {
    const result = await guardToolResponse(sse(text, { chunkSize }), "chat", policy);
    const frames = parse(await result.text());
    assert.equal(frames.length, 1);
    assertError("chat", frames[0].data);
    assert.match(frames[0].data.error.message, /32 MiB|limit/i);
  }
});

test("text streams larger than 32 MiB are not subject to the pending-tool limit", async () => {
  let count = 0;
  const bytes = encoder.encode(event(chat({ content: "x".repeat(1024 * 1024) })));
  const source = new Response(
    new ReadableStream({
      pull(controller) {
        if (count < 34) {
          count++;
          return controller.enqueue(bytes);
        }
        if (count++ === 34) return controller.enqueue(encoder.encode(terminal("chat")));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  const result = await guardToolResponse(source, "chat", policy);
  const reader = result.body.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    assert.ok(!new TextDecoder().decode(value).includes('"error"'));
  }
  assert.ok(total > 32 * 1024 * 1024);
});

