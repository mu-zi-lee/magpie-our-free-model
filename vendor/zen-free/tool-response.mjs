const MAX_BYTES = 32 * 1024 * 1024;
const encoder = new TextEncoder();

class GuardError extends Error {}

function headersFor(response) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return headers;
}

function failure(protocol, message, stream = false) {
  if (protocol === "anthropic") return { type: "error", error: { type: "api_error", message } };
  if (protocol === "responses") {
    return stream
      ? { type: "error", code: "undeclared_tool", message }
      : { error: { type: "upstream_error", code: "undeclared_tool", message } };
  }
  return { error: { message, type: "upstream_error" } };
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function list(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new GuardError("Invalid upstream tool snapshot");
  return value;
}

function nameGuard(policy) {
  const declared = new Set(policy.declared);
  const injected = new Set(policy.injected);
  const folded = new Map();
  for (const name of declared) {
    const key = name.toLowerCase();
    folded.set(key, folded.has(key) ? null : name);
  }
  return (name) => {
    if (typeof name !== "string" || !name) throw new GuardError("Missing upstream tool name");
    if (declared.has(name)) return name;
    const match = injected.has(name) && folded.get(name.toLowerCase());
    if (match) return match;
    throw new GuardError("Upstream called a tool not declared by the client");
  };
}

function checkFunction(value, checkName) {
  if (!object(value)) throw new GuardError("Invalid upstream function call");
  const name = checkName(value.name);
  const changed = name !== value.name;
  value.name = name;
  return changed;
}

function checkChatMessage(message, checkName) {
  if (!object(message)) return false;
  let changed = false;
  if (message.function_call != null) changed = checkFunction(message.function_call, checkName);
  for (const call of list(message.tool_calls)) {
    if (!object(call) || (call.type != null && call.type !== "function")) {
      throw new GuardError("Unsupported upstream tool call");
    }
    changed = checkFunction(call.function, checkName) || changed;
  }
  return changed;
}

function checkSnapshots(data, protocol, checkName) {
  let changed = false;
  if (protocol === "chat") {
    for (const choice of list(data.choices)) {
      if (!object(choice)) throw new GuardError("Invalid upstream choice");
      changed = checkChatMessage(choice.message, checkName) || changed;
    }
    return changed;
  }
  const stack = [data];
  while (stack.length) {
    const value = stack.pop();
    if (!object(value)) throw new GuardError("Invalid upstream tool snapshot");
    if (
      protocol === "responses" &&
      typeof value.type === "string" &&
      value.type.endsWith("_call") &&
      value.type !== "function_call"
    ) {
      throw new GuardError("Unsupported upstream tool call type");
    }
    if (
      (protocol === "responses" && value.type === "function_call") ||
      (protocol === "anthropic" && ["tool_use", "server_tool_use"].includes(value.type))
    ) {
      changed = checkFunction(value, checkName) || changed;
    }
    const arrays = protocol === "responses" ? ["output", "content"] : ["content"];
    const objects =
      protocol === "responses" ? ["response", "item", "part"] : ["message", "content_block"];
    for (const key of arrays) {
      // Text content is not a snapshot container.
      if (typeof value[key] === "string") continue;
      for (const item of list(value[key])) stack.push(item);
    }
    for (const key of objects) {
      if (value[key] != null) stack.push(value[key]);
    }
  }
  return changed;
}

function position(value) {
  const result = value ?? 0;
  if (!Number.isSafeInteger(result) || result < 0)
    throw new GuardError("Invalid upstream tool index");
  return result;
}

function appendFunction(target, fragment) {
  if (!object(fragment)) throw new GuardError("Invalid upstream function delta");
  for (const [key, value] of Object.entries(fragment)) {
    if (key === "name" || key === "arguments") {
      if (typeof value !== "string") throw new GuardError("Invalid upstream function delta");
      target[key] = (target[key] ?? "") + value;
    } else {
      Object.defineProperty(target, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }
}

function chatBuffer(checkName) {
  const pending = new Map();
  let bytes = 0;
  function charge(state, value) {
    const size = encoder.encode(JSON.stringify(value)).byteLength;
    bytes += size;
    state.bytes += size;
    if (bytes > MAX_BYTES)
      throw new GuardError("Pending upstream tools exceed the 32 MiB buffer limit");
  }
  function stateFor(index, data) {
    if (!pending.has(index)) {
      const metadata = {};
      for (const key of [
        "id",
        "object",
        "created",
        "model",
        "system_fingerprint",
        "service_tier",
      ]) {
        if (data[key] !== undefined) metadata[key] = data[key];
      }
      const state = { calls: new Map(), legacy: null, metadata, bytes: 0 };
      pending.set(index, state);
      charge(state, metadata);
    }
    return pending.get(index);
  }
  function complete(state) {
    const delta = {};
    if (state.calls.size) {
      delta.tool_calls = [...state.calls].sort(([a], [b]) => a - b).map(([, value]) => value);
    }
    if (state.legacy) delta.function_call = state.legacy;
    checkChatMessage(delta, checkName);
    return delta;
  }
  function remove(index) {
    const state = pending.get(index);
    if (state) bytes -= state.bytes;
    pending.delete(index);
  }
  return {
    get size() {
      return pending.size;
    },
    clear() {
      pending.clear();
      bytes = 0;
    },
    apply(data) {
      let changed = checkSnapshots(data, "chat", checkName);
      const choices = list(data.choices);
      for (const choice of choices) {
        const delta = choice.delta;
        if (!object(delta)) continue;
        if (delta.tool_calls == null && delta.function_call == null) continue;
        changed = true;
        const state = stateFor(position(choice.index), data);
        for (const fragment of list(delta.tool_calls)) {
          if (!object(fragment) || (fragment.type != null && fragment.type !== "function")) {
            throw new GuardError("Unsupported upstream tool delta");
          }
          charge(state, fragment);
          const index = position(fragment.index);
          const previous = state.calls.get(index) ?? { index, function: {} };
          const value = { ...previous, ...fragment, index, function: previous.function };
          if (fragment.function != null) appendFunction(value.function, fragment.function);
          state.calls.set(index, value);
        }
        if (delta.function_call != null) {
          charge(state, delta.function_call);
          state.legacy ??= {};
          appendFunction(state.legacy, delta.function_call);
        }
        delete delta.tool_calls;
        delete delta.function_call;
      }
      // Validate every finishing choice before publishing any part of this event.
      for (const choice of choices) {
        if (choice.finish_reason == null) continue;
        const index = position(choice.index);
        const state = pending.get(index);
        if (!state) continue;
        choice.delta = { ...choice.delta, ...complete(state) };
        remove(index);
        changed = true;
      }
      if (!changed) return { data, changed: false };
      data.choices = choices.filter(
        (choice) =>
          choice.finish_reason != null ||
          Object.keys(choice.delta ?? {}).length ||
          Object.keys(choice).some((key) => !["index", "delta", "finish_reason"].includes(key)),
      );
      return { data: data.choices.length || data.usage != null ? data : null, changed: true };
    },
    finish() {
      if (!pending.size) return null;
      const choices = [...pending]
        .sort(([a], [b]) => a - b)
        .map(([index, state]) => ({ index, delta: complete(state), finish_reason: null }));
      const metadata = pending.values().next().value.metadata;
      pending.clear();
      bytes = 0;
      return { ...metadata, choices };
    },
  };
}

function parseJSON(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new GuardError("Invalid JSON in upstream response");
  }
  if (!object(value)) throw new GuardError("Invalid JSON object in upstream response");
  return value;
}

function encodeEvent(data, name = "") {
  return `${name ? `event: ${name}\n` : ""}data: ${JSON.stringify(data)}\n\n`;
}

function rewrite(frame, data) {
  const lines = frame.lines.filter((line) => line !== "data" && !line.startsWith("data:"));
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join("\n")}\n\n`;
}

async function* framesFrom(reader) {
  let parts = [];
  let lineBytes = 0;
  let eventBytes = 0;
  let lines = [];
  let rawLines = [];
  let skipLF = false;
  let pendingFrame;
  let firstLine = true;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  function append(value) {
    eventBytes += value.byteLength;
    if (eventBytes > MAX_BYTES)
      throw new GuardError("Upstream SSE event exceeds the 32 MiB buffer limit");
    if (value.byteLength) {
      parts.push(value);
      lineBytes += value.byteLength;
    }
  }
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (pendingFrame) {
        yield pendingFrame;
        pendingFrame = null;
        eventBytes = 0;
      }
      if (eventBytes || lineBytes || lines.length)
        throw new GuardError("Upstream SSE ended inside an event");
      return;
    }
    let start = 0;
    if (skipLF && value.length) {
      if (value[0] === 10) {
        eventBytes++;
        if (pendingFrame) pendingFrame.raw += "\n";
        else rawLines[rawLines.length - 1] += "\n";
        start = 1;
      }
      if (eventBytes > MAX_BYTES)
        throw new GuardError("Upstream SSE event exceeds the 32 MiB buffer limit");
      skipLF = false;
      if (pendingFrame) {
        const frame = pendingFrame;
        pendingFrame = null;
        eventBytes = 0;
        yield frame;
      }
    }
    for (let offset = start; offset < value.length; offset++) {
      if (value[offset] !== 10 && value[offset] !== 13) continue;
      append(value.subarray(start, offset));
      if (++eventBytes > MAX_BYTES)
        throw new GuardError("Upstream SSE event exceeds the 32 MiB buffer limit");
      const bytes = new Uint8Array(lineBytes);
      let cursor = 0;
      for (const part of parts) {
        bytes.set(part, cursor);
        cursor += part.length;
      }
      let line;
      try {
        line = decoder.decode(bytes);
      } catch {
        throw new GuardError("Invalid UTF-8 in upstream SSE event");
      }
      parts = [];
      lineBytes = 0;
      let rawLine = line + String.fromCharCode(value[offset]);
      if (firstLine) {
        line = line.replace(/^\uFEFF/, "");
        firstLine = false;
      }
      if (value[offset] === 13) {
        if (value[offset + 1] === 10) {
          rawLine += "\n";
          offset++;
          if (++eventBytes > MAX_BYTES)
            throw new GuardError("Upstream SSE event exceeds the 32 MiB buffer limit");
        } else if (offset + 1 === value.length) skipLF = true;
      }
      start = offset + 1;
      rawLines.push(rawLine);
      if (line) {
        lines.push(line);
      } else {
        const frameLines = lines;
        lines = [];
        let name = "";
        const data = [];
        for (const item of frameLines) {
          const colon = item.indexOf(":");
          const key = colon < 0 ? item : item.slice(0, colon);
          let content = colon < 0 ? "" : item.slice(colon + 1);
          if (content.startsWith(" ")) content = content.slice(1);
          if (key === "event") name = content;
          if (key === "data") data.push(content);
        }
        const frame = {
          lines: frameLines,
          name,
          text: data.join("\n"),
          raw: rawLines.join(""),
        };
        rawLines = [];
        if (skipLF) {
          // Preserve a trailing CRLF even when its LF arrives in the next chunk.
          pendingFrame = frame;
        } else {
          eventBytes = 0;
          yield frame;
        }
      }
    }
    append(value.subarray(start));
  }
}

function guardedStream(response, protocol, checkName) {
  const reader = response.body?.getReader();
  const chat = protocol === "chat" ? chatBuffer(checkName) : null;
  let frames = reader ? framesFrom(reader) : null;
  let completed = false;
  let stopped = false;
  let released = false;
  let cancellation;
  function release() {
    if (reader && !released) {
      reader.releaseLock();
      released = true;
    }
    chat?.clear();
    frames = null;
  }
  function cancel(reason) {
    cancellation ??= (async () => {
      try {
        await reader?.cancel(reason);
      } finally {
        release();
      }
    })();
    return cancellation;
  }
  return new ReadableStream(
    {
      async pull(controller) {
        try {
          while (!stopped) {
            const next = frames ? await frames.next() : { done: true };
            if (stopped) return;
            if (next.done) {
              if (!completed || chat?.size)
                throw new GuardError("Upstream SSE ended without a completion marker");
              stopped = true;
              release();
              controller.close();
              return;
            }
            const frame = next.value;
            if (frame.name !== "error" && !frame.text.trim()) {
              controller.enqueue(encoder.encode(frame.raw));
              return;
            }
            if (frame.name !== "error" && frame.text.trim() === "[DONE]") {
              if (protocol !== "chat")
                throw new GuardError("Unexpected upstream completion marker");
              const final = chat.finish();
              completed = true;
              controller.enqueue(encoder.encode((final ? encodeEvent(final) : "") + frame.raw));
              return;
            }
            const data = frame.name === "error" ? null : parseJSON(frame.text);
            const type = data?.type ?? frame.name;
            if (
              frame.name === "error" ||
              type === "error" ||
              data?.error ||
              type === "response.failed" ||
              data?.response?.status === "failed"
            ) {
              stopped = true;
              try {
                await cancel();
              } catch (cause) {
                controller.error(cause);
                return;
              }
              controller.enqueue(encoder.encode(frame.raw));
              controller.close();
              return;
            }
            let changed;
            let result = data;
            if (chat) {
              const checked = chat.apply(data);
              changed = checked.changed;
              result = checked.data;
            } else {
              changed = checkSnapshots(data, protocol, checkName);
            }
            if (
              (protocol === "responses" &&
                ["response.completed", "response.incomplete"].includes(type)) ||
              (protocol === "anthropic" && type === "message_stop")
            )
              completed = true;
            if (result) {
              controller.enqueue(encoder.encode(changed ? rewrite(frame, result) : frame.raw));
              return;
            }
          }
        } catch (error) {
          if (stopped) return;
          stopped = true;
          if (error instanceof GuardError) {
            try {
              await cancel(error);
            } catch (cause) {
              controller.error(cause);
              return;
            }
            controller.enqueue(
              encoder.encode(
                encodeEvent(
                  failure(protocol, error.message, true),
                  protocol === "chat" ? "" : "error",
                ),
              ),
            );
            controller.close();
          } else {
            release();
            controller.error(error);
          }
        }
      },
      async cancel(reason) {
        stopped = true;
        await cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

export async function guardToolResponse(response, protocol, policy) {
  if (!response.ok) return response;
  if (!["chat", "responses", "anthropic"].includes(protocol))
    throw new TypeError(`Unsupported protocol: ${protocol}`);
  const checkName = nameGuard(policy);
  const headers = headersFor(response);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType === "text/event-stream") {
    return new Response(guardedStream(response, protocol, checkName), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  const text = await response.text();
  let value;
  let status = response.status;
  try {
    value = parseJSON(text);
    checkSnapshots(value, protocol, checkName);
  } catch (error) {
    if (!(error instanceof GuardError)) throw error;
    status = 502;
    value = failure(protocol, error.message);
  }
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(value), { status, headers });
}

