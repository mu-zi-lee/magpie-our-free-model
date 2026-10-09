import assert from "node:assert/strict";
import test from "node:test";
import { collapseResponse } from "./stream.mjs";

const encoder = new TextEncoder();
const event = (data, name) =>
  `${name ? `event: ${name}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;

function sse(text, { chunkSize = 23, headers = {}, status = 200 } = {}) {
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
    { status, headers: { "content-type": "text/event-stream; charset=utf-8", ...headers } },
  );
}

async function collapseOpenStream(text, protocol, cancel = () => {}) {
  let controller;
  let cancelled = false;
  let timer;
  const bytes = encoder.encode(text);
  const response = new Response(
    new ReadableStream({
      start(source) {
        controller = source;
        source.enqueue(bytes.slice(0, -1));
        source.enqueue(bytes.slice(-1));
      },
      cancel() {
        cancelled = true;
        return cancel();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  try {
    const result = await Promise.race([
      collapseResponse(response, protocol),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("SSE error waited for EOF")), 500);
      }),
    ]);
    assert.equal(cancelled, true);
    assert.equal(response.body.locked, false);
    return result;
  } finally {
    clearTimeout(timer);
    if (!cancelled) controller.close();
  }
}

async function json(text, protocol, options) {
  const response = await collapseResponse(sse(text, options), protocol);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  return response.json();
}

async function failure(text, protocol, pattern = /./) {
  const response = await collapseResponse(sse(text), protocol);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error.type, "upstream_error");
  assert.match(body.error.message, pattern);
  if (protocol === "anthropic") assert.equal(body.type, "error");
  else {
    assert.equal(body.error.param, null);
    assert.equal(body.error.code, null);
  }
}

test("chat preserves text, reasoning, indexed choices, tool arguments, usage and finish reasons", async () => {
  const text =
    [
      {
        id: "chat-1",
        object: "chat.completion.chunk",
        created: 123,
        model: "zen",
        system_fingerprint: "fp",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: "你",
              reasoning_content: "想",
              tool_calls: [
                {
                  index: 1,
                  id: "call-b",
                  type: "function",
                  function: { name: "second", arguments: '{"b":' },
                },
                {
                  index: 0,
                  id: "call-a",
                  type: "function",
                  function: { name: "first", arguments: '{"a":' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          { index: 1, delta: { content: "other" }, finish_reason: "stop" },
          {
            index: 0,
            delta: {
              content: "好🙂",
              reasoning_content: "法",
              tool_calls: [
                { index: 0, function: { arguments: "1}" } },
                { index: 1, function: { arguments: "2}" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      {
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 7,
          total_tokens: 17,
          completion_tokens_details: { reasoning_tokens: 3 },
        },
      },
    ]
      .map((value) => event(value))
      .join("") + event("[DONE]");
  const body = await json(text, "chat", { chunkSize: 1 });
  assert.equal(body.id, "chat-1");
  assert.equal(body.object, "chat.completion");
  assert.equal(body.created, 123);
  assert.equal(body.model, "zen");
  assert.equal(body.system_fingerprint, "fp");
  assert.equal(body.choices[0].message.role, "assistant");
  assert.equal(body.choices[0].message.content, "你好🙂");
  assert.equal(body.choices[0].message.reasoning_content, "想法");
  assert.deepEqual(body.choices[0].message.tool_calls, [
    { id: "call-a", type: "function", function: { name: "first", arguments: '{"a":1}' } },
    { id: "call-b", type: "function", function: { name: "second", arguments: '{"b":2}' } },
  ]);
  assert.equal(body.choices[0].finish_reason, "tool_calls");
  assert.equal(body.choices[1].message.content, "other");
  assert.equal(body.choices[1].finish_reason, "stop");
  assert.deepEqual(body.usage, {
    prompt_tokens: 10,
    completion_tokens: 7,
    total_tokens: 17,
    completion_tokens_details: { reasoning_tokens: 3 },
  });
});

test("chat retains null content for tool-only replies and legacy function_call fragments", async () => {
  const body = await json(
    event({
      choices: [
        {
          index: 0,
          delta: { content: null, function_call: { name: "lookup", arguments: '{"x":' } },
        },
      ],
    }) +
      event({
        choices: [
          {
            index: 0,
            delta: { function_call: { arguments: "1}" } },
            finish_reason: "function_call",
          },
        ],
      }) +
      event("[DONE]"),
    "chat",
  );
  assert.equal(body.choices[0].message.content, null);
  assert.deepEqual(body.choices[0].message.function_call, { name: "lookup", arguments: '{"x":1}' });
});

test("SSE supports BOM, comments, CRLF, multiple data lines and arbitrary byte boundaries", async () => {
  const text =
    '\uFEFF: keepalive\r\nid: 3\r\nevent: message\r\ndata: {"choices":\r\ndata: [{"index":0,"delta":{"content":"中文🙂"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n';
  for (const chunkSize of [1, 2, 3, 7, 64, 1024]) {
    const body = await json(text, "chat", { chunkSize });
    assert.equal(body.choices[0].message.content, "中文🙂");
  }
});

test("SSE supports CR-only line endings", async () => {
  const body = await json(
    (
      event({ choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] }) +
      event("[DONE]")
    ).replaceAll("\n", "\r"),
    "chat",
    { chunkSize: 1 },
  );
  assert.equal(body.choices[0].message.content, "ok");
});

test("Responses uses the complete final response without replacing authoritative fields", async () => {
  const final = {
    id: "resp-1",
    object: "response",
    status: "completed",
    model: "zen",
    output: [
      {
        type: "message",
        id: "msg",
        role: "assistant",
        content: [{ type: "output_text", text: "final", annotations: [] }],
      },
      { type: "reasoning", summary: [{ type: "summary_text", text: "thought" }] },
      { type: "function_call", call_id: "call", name: "f", arguments: '{"a":1}' },
    ],
    usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 },
    metadata: { retained: true },
  };
  const body = await json(
    event({
      type: "response.output_text.delta",
      output_index: 0,
      content_index: 0,
      delta: "not final",
    }) + event({ type: "response.completed", response: final }, "response.completed"),
    "responses",
  );
  assert.deepEqual(body, final);
});

test("Responses incomplete keeps the original response and its usage", async () => {
  const final = {
    id: "resp-limit",
    object: "response",
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    output: [],
    usage: { output_tokens: 20 },
  };
  assert.deepEqual(
    await json(event({ response: final }, "response.incomplete"), "responses"),
    final,
  );
});

test("Responses aggregates fallback text, reasoning, function arguments and usage", async () => {
  const events = [
    {
      type: "response.created",
      response: {
        id: "resp-2",
        object: "response",
        model: "zen",
        status: "in_progress",
        output: [],
      },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { id: "m", type: "message", role: "assistant", content: [] },
    },
    {
      type: "response.content_part.added",
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    },
    { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "hello" },
    { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: " world" },
    {
      type: "response.output_item.added",
      output_index: 1,
      item: { id: "r", type: "reasoning", summary: [] },
    },
    {
      type: "response.reasoning_summary_part.added",
      output_index: 1,
      summary_index: 0,
      part: { type: "summary_text", text: "" },
    },
    {
      type: "response.reasoning_summary_text.delta",
      output_index: 1,
      summary_index: 0,
      delta: "think",
    },
    {
      type: "response.output_item.added",
      output_index: 2,
      item: { id: "f", type: "function_call", call_id: "call", name: "lookup", arguments: "" },
    },
    { type: "response.function_call_arguments.delta", output_index: 2, delta: '{"q":' },
    { type: "response.function_call_arguments.delta", output_index: 2, delta: '"x"}' },
    { type: "response.completed", usage: { input_tokens: 2, output_tokens: 4, total_tokens: 6 } },
  ];
  const body = await json(events.map((value) => event(value)).join(""), "responses");
  assert.equal(body.id, "resp-2");
  assert.equal(body.status, "completed");
  assert.equal(body.output[0].content[0].text, "hello world");
  assert.equal(body.output[1].summary[0].text, "think");
  assert.equal(body.output[2].arguments, '{"q":"x"}');
  assert.deepEqual(body.usage, { input_tokens: 2, output_tokens: 4, total_tokens: 6 });
});

test("Responses done snapshots do not duplicate accumulated deltas", async () => {
  const item = {
    id: "f",
    type: "function_call",
    call_id: "call",
    name: "lookup",
    arguments: '{"a":1}',
    status: "completed",
  };
  const body = await json(
    event({
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, arguments: "" },
    }) +
      event({ type: "response.function_call_arguments.delta", output_index: 0, delta: '{"a":1}' }) +
      event({
        type: "response.function_call_arguments.done",
        output_index: 0,
        arguments: '{"a":1}',
      }) +
      event({ type: "response.output_item.done", output_index: 0, item }) +
      event({ type: "response.completed" }),
    "responses",
  );
  assert.deepEqual(body.output, [item]);
});

test("Anthropic preserves initial content, thinking, signatures, tool JSON, usage and stop reason", async () => {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg-1",
        type: "message",
        role: "assistant",
        model: "zen",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 11, output_tokens: 0, cache_read_input_tokens: 4 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "先", signature: "sig" },
    },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "想" } },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature: "nature" },
    },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "你" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "好🙂" } },
    {
      type: "content_block_start",
      index: 2,
      content_block: { type: "tool_use", id: "tool", name: "lookup", input: {} },
    },
    {
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: '{"q":' },
    },
    {
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: '"中文"}' },
    },
    { type: "content_block_stop", index: 2 },
    {
      type: "content_block_start",
      index: 3,
      content_block: { type: "redacted_thinking", data: "opaque" },
    },
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: "END" },
      usage: { output_tokens: 9 },
    },
    { type: "message_stop" },
  ];
  const body = await json(events.map((value) => event(value, value.type)).join(""), "anthropic", {
    chunkSize: 1,
  });
  assert.equal(body.id, "msg-1");
  assert.deepEqual(body.content, [
    { type: "thinking", thinking: "先想", signature: "signature" },
    { type: "text", text: "你好🙂" },
    { type: "tool_use", id: "tool", name: "lookup", input: { q: "中文" } },
    { type: "redacted_thinking", data: "opaque" },
  ]);
  assert.deepEqual(body.usage, { input_tokens: 11, output_tokens: 9, cache_read_input_tokens: 4 });
  assert.equal(body.stop_reason, "tool_use");
  assert.equal(body.stop_sequence, "END");
});

test("Anthropic retains complete tool input when there are no JSON deltas", async () => {
  const body = await json(
    event({
      type: "message_start",
      message: { id: "m", content: [{ type: "text", text: "initial" }] },
    }) +
      event({
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "t", name: "f", input: { a: 1 } },
      }) +
      event({ type: "message_stop" }),
    "anthropic",
  );
  assert.deepEqual(body.content[1].input, { a: 1 });
  assert.equal(body.content[0].text, "initial");
});

for (const protocol of ["chat", "responses", "anthropic"]) {
  test(`${protocol}: HTTP failures and non-SSE JSON return the same unread Response`, async () => {
    const httpError = sse(event({ error: { message: "quota" } }), { status: 429 });
    assert.equal(await collapseResponse(httpError, protocol), httpError);
    assert.equal(httpError.bodyUsed, false);
    const plain = new Response('{"unchanged": true}', {
      headers: { "content-type": "application/json", "content-length": "19" },
    });
    assert.equal(await collapseResponse(plain, protocol), plain);
    assert.equal(plain.bodyUsed, false);
    assert.equal(await plain.text(), '{"unchanged": true}');
  });

  test(`${protocol}: empty and truncated SSE are 502 errors`, async () => {
    await failure("", protocol, /complet|end|terminat/i);
    await failure(
      event({ choices: [{ index: 0, delta: { content: "partial" }, finish_reason: "stop" }] }),
      protocol,
    );
    if (protocol !== "chat") await failure(event("[DONE]"), protocol);
  });

  test(`${protocol}: error events and JSON errors are 502 errors`, async () => {
    await failure(event({ error: { message: "quota exhausted" } }), protocol, /quota exhausted/);
    await failure(event({ message: "upstream exploded" }, "error"), protocol, /upstream exploded/);
    await failure(event("plain failure", "error"), protocol, /plain failure/);
    await failure(
      event({ type: "error", error: { type: "overloaded_error", message: "busy" } }),
      protocol,
      /busy/,
    );
    await failure(event("{invalid json"), protocol, /JSON|invalid|malformed/i);
  });

  test(`${protocol}: open SSE errors cancel promptly and return 502`, async () => {
    for (const text of [
      event({ message: "upstream exploded" }, "error"),
      event("upstream exploded", "error"),
      event({ error: { message: "upstream exploded" } }),
      event({ type: "error", error: { message: "upstream exploded" } }),
    ]) {
      const response = await collapseOpenStream(text, protocol);
      assert.equal(response.status, 502);
      const body = await response.json();
      assert.equal(body.error.type, "upstream_error");
      assert.equal(body.error.message, "upstream exploded");
      if (protocol === "anthropic") assert.equal(body.type, "error");
      else {
        assert.equal(body.error.param, null);
        assert.equal(body.error.code, null);
      }
    }
  });

  test(`${protocol}: open SSE errors propagate cancellation failures`, async () => {
    for (const asynchronous of [false, true]) {
      const cause = new DOMException("cancel failed", "AbortError");
      let cancelled = false;
      await assert.rejects(
        collapseOpenStream(event("upstream exploded", "error"), protocol, () => {
          cancelled = true;
          if (asynchronous) return Promise.reject(cause);
          throw cause;
        }),
        (error) => error === cause,
      );
      assert.equal(cancelled, true);
    }
  });

  test(`${protocol}: body read errors and aborts reject with the original exception`, async () => {
    for (const cause of [new Error("read failed"), new DOMException("cancelled", "AbortError")]) {
      let pulled = false;
      const response = new Response(
        new ReadableStream({
          pull(controller) {
            if (pulled) return controller.error(cause);
            pulled = true;
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
      await assert.rejects(collapseResponse(response, protocol), (error) => error === cause);
    }
  });
}

test("protocol-specific finish reasons without terminal events remain truncated", async () => {
  await failure(
    event({ type: "response.created", response: { id: "r", output: [] } }) +
      event({ type: "response.output_text.delta", output_index: 0, delta: "partial" }),
    "responses",
    /completion/,
  );
  await failure(
    event({ type: "message_start", message: { id: "m", content: [] } }) +
      event({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
    "anthropic",
    /completion/,
  );
  await failure("data: [DONE]\n", "chat", /completion/);
});

test("upstream errors after terminal events are not successful responses", async () => {
  for (const [protocol, terminal] of [
    ["chat", "[DONE]"],
    ["responses", { type: "response.completed", response: { output: [] } }],
    ["anthropic", { type: "message_stop" }],
  ]) {
    await failure(
      event(terminal) + event({ error: { message: "late error" } }),
      protocol,
      /late error/,
    );
  }
});

test("buffer-limit cancellation failures propagate instead of becoming JSON", async () => {
  const cause = new DOMException("cancel failed", "AbortError");
  const chunk = new Uint8Array(1024 * 1024);
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        controller.enqueue(chunk);
      },
      cancel() {
        throw cause;
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  await assert.rejects(collapseResponse(response, "chat"), (error) => error === cause);
});

test("Responses open SSE failed events cancel promptly and return 502", async () => {
  const response = await collapseOpenStream(
    event({
      type: "response.failed",
      response: { status: "failed", error: { message: "model failed" } },
    }),
    "responses",
  );
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.message, "model failed");
});

test("Responses failed is an error even when a response object is present", async () => {
  await failure(
    event({
      type: "response.failed",
      response: { id: "r", status: "failed", error: { message: "model failed" }, output: [] },
    }),
    "responses",
    /model failed/,
  );
});

test("Anthropic rejects malformed accumulated tool JSON", async () => {
  await failure(
    event({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", input: {} },
    }) +
      event({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"unfinished":' },
      }) +
      event({ type: "message_stop" }),
    "anthropic",
    /JSON|argument|input/i,
  );
});

test("success and error JSON remove stale entity headers and preserve retry metadata", async () => {
  for (const text of [event("[DONE]"), event({ error: { message: "fail" } })]) {
    const response = await collapseResponse(
      sse(text, {
        headers: {
          "content-length": "999",
          "content-encoding": "gzip",
          "retry-after": "12",
          "x-request-id": "req-1",
        },
      }),
      "chat",
    );
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.equal(response.headers.get("content-length"), null);
    assert.equal(response.headers.get("content-encoding"), null);
    assert.equal(response.headers.get("retry-after"), "12");
    assert.equal(response.headers.get("x-request-id"), "req-1");
  }
});

test("bounded buffering rejects oversized unterminated events and cancels the source", async () => {
  let cancelled = false;
  let pulls = 0;
  const chunk = encoder.encode("x".repeat(1024 * 1024));
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        pulls++;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  const result = await collapseResponse(response, "chat");
  assert.equal(result.status, 502);
  assert.match((await result.json()).error.message, /limit|large|buffer/i);
  assert.ok(pulls <= 35);
  assert.equal(cancelled, true);
});

test("bounded buffering also counts many small completed events", async () => {
  const chunk = encoder.encode(
    event({ choices: [{ index: 0, delta: { content: "x".repeat(65536) } }] }),
  );
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  const result = await collapseResponse(response, "chat");
  assert.equal(result.status, 502);
  assert.equal(cancelled, true);
});

test("read failures after a completion marker are not swallowed", async () => {
  const cause = new Error("late transport failure");
  let sent = false;
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        if (sent) return controller.error(cause);
        sent = true;
        controller.enqueue(encoder.encode(event("[DONE]")));
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  await assert.rejects(collapseResponse(response, "chat"), (error) => error === cause);
});

