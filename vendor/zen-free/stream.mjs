const MAX_BYTES = 32 * 1024 * 1024;

function jsonResponse(source, protocol, value, error) {
  const headers = new Headers(source.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("content-type", "application/json");
  if (error) {
    const detail = { type: "upstream_error", message: error };
    value =
      protocol === "anthropic"
        ? { type: "error", error: detail }
        : { error: { ...detail, param: null, code: null } };
  }
  return new Response(JSON.stringify(value), {
    status: error ? 502 : source.status,
    headers,
  });
}

function errorMessage(value, fallback = "Upstream stream failed") {
  if (typeof value === "string" && value) return value;
  return value?.message || value?.error?.message || fallback;
}

function index(value) {
  const result = value ?? 0;
  if (!Number.isInteger(result) || result < 0 || result > 65535) {
    throw new Error("Invalid stream item index");
  }
  return result;
}

function sorted(map) {
  return [...map].sort(([a], [b]) => a - b).map(([, value]) => value);
}

function appendFunction(target, delta) {
  for (const key of ["name", "arguments"]) {
    if (typeof delta[key] === "string") target[key] = (target[key] ?? "") + delta[key];
  }
}

function chatAccumulator() {
  const body = { object: "chat.completion", choices: [] };
  const choices = new Map();
  const tools = new Map();
  return {
    apply(data) {
      for (const key of ["id", "created", "model", "system_fingerprint", "service_tier"]) {
        if (data[key] !== undefined) body[key] = data[key];
      }
      if (data.usage) body.usage = { ...body.usage, ...data.usage };
      for (const part of data.choices ?? []) {
        const position = index(part.index);
        if (!choices.has(position)) {
          choices.set(position, {
            index: position,
            message: { role: "assistant", content: null },
            finish_reason: null,
          });
          tools.set(position, new Map());
        }
        const choice = choices.get(position);
        const message = choice.message;
        const delta = part.delta ?? {};
        if (delta.role) message.role = delta.role;
        for (const key of ["content", "reasoning_content", "reasoning", "refusal"]) {
          if (typeof delta[key] === "string") message[key] = (message[key] ?? "") + delta[key];
        }
        if (delta.function_call) {
          message.function_call ??= { name: "", arguments: "" };
          appendFunction(message.function_call, delta.function_call);
        }
        for (const fragment of delta.tool_calls ?? []) {
          const toolIndex = index(fragment.index);
          const calls = tools.get(position);
          if (!calls.has(toolIndex))
            calls.set(toolIndex, { type: "function", function: { name: "", arguments: "" } });
          const call = calls.get(toolIndex);
          for (const key of ["id", "type"]) {
            if (fragment[key] !== undefined) call[key] = fragment[key];
          }
          if (fragment.function) appendFunction(call.function, fragment.function);
        }
        if (part.finish_reason != null) choice.finish_reason = part.finish_reason;
        if (part.logprobs) {
          choice.logprobs ??= {};
          for (const [key, value] of Object.entries(part.logprobs)) {
            if (Array.isArray(value))
              choice.logprobs[key] = [...(choice.logprobs[key] ?? []), ...value];
            else choice.logprobs[key] = value;
          }
        }
      }
    },
    finish() {
      for (const [position, choice] of choices) {
        if (tools.get(position).size) choice.message.tool_calls = sorted(tools.get(position));
      }
      body.choices = sorted(choices);
      return body;
    },
  };
}

function responsesAccumulator() {
  let body = { object: "response", output: [] };
  let final;
  const output = new Map();
  function item(data, type = "message") {
    let position = data.output_index;
    if (position === undefined && data.item_id) {
      position = [...output].find(([, value]) => value.id === data.item_id)?.[0];
    }
    position = index(position);
    if (!output.has(position)) {
      const value = { type };
      if (data.item_id) value.id = data.item_id;
      if (type === "message") Object.assign(value, { role: "assistant", content: [] });
      if (type === "function_call") value.arguments = "";
      if (type === "reasoning") value.summary = [];
      output.set(position, value);
    }
    return output.get(position);
  }
  return {
    apply(data, type) {
      if (type === "response.created" || type === "response.in_progress") {
        if (data.response) {
          body = { ...body, ...data.response };
          for (const [position, value] of (data.response.output ?? []).entries())
            output.set(position, value);
        }
      } else if (type === "response.output_item.added" || type === "response.output_item.done") {
        if (data.item) output.set(index(data.output_index), data.item);
      } else if (type === "response.content_part.added" || type === "response.content_part.done") {
        const value = item(data);
        value.content ??= [];
        value.content[index(data.content_index)] = data.part;
      } else if (
        type === "response.output_text.delta" ||
        type === "response.output_text.done" ||
        type === "response.refusal.delta" ||
        type === "response.refusal.done"
      ) {
        const value = item(data);
        value.content ??= [];
        const refusal = type.startsWith("response.refusal.");
        const field = refusal ? "refusal" : "text";
        const part = (value.content[index(data.content_index)] ??= refusal
          ? { type: "refusal", refusal: "" }
          : { type: "output_text", text: "", annotations: [] });
        if (type.endsWith(".delta")) part[field] = (part[field] ?? "") + (data.delta ?? "");
        else if (data[field] !== undefined) part[field] = data[field];
      } else if (
        type === "response.function_call_arguments.delta" ||
        type === "response.function_call_arguments.done"
      ) {
        const value = item(data, "function_call");
        if (type.endsWith(".delta")) value.arguments = (value.arguments ?? "") + (data.delta ?? "");
        else if (data.arguments !== undefined) value.arguments = data.arguments;
      } else if (
        type === "response.reasoning_summary_part.added" ||
        type === "response.reasoning_summary_part.done"
      ) {
        const value = item(data, "reasoning");
        value.summary ??= [];
        value.summary[index(data.summary_index)] = data.part;
      } else if (/^response\.reasoning_(summary_)?text\.(delta|done)$/.test(type)) {
        const value = item(data, "reasoning");
        const summary = type.includes("summary");
        const field = summary ? "summary" : "content";
        value[field] ??= [];
        const part = (value[field][index(summary ? data.summary_index : data.content_index)] ??= {
          type: summary ? "summary_text" : "reasoning_text",
          text: "",
        });
        if (type.endsWith(".delta")) part.text += data.delta ?? "";
        else if (data.text !== undefined) part.text = data.text;
      } else if (type === "response.reasoning_content.delta") {
        body.reasoning_content = (body.reasoning_content ?? "") + (data.delta ?? "");
      } else if (type === "response.completed" || type === "response.incomplete") {
        if (data.response && typeof data.response === "object") final = data.response;
        body.status = type === "response.completed" ? "completed" : "incomplete";
        for (const key of ["incomplete_details", "finish_reason"]) {
          if (data[key] !== undefined) body[key] = data[key];
        }
      }
      if (data.usage) body.usage = { ...body.usage, ...data.usage };
    },
    finish() {
      if (final) return final;
      body.output = sorted(output);
      return body;
    },
  };
}

function anthropicAccumulator() {
  let body = {
    type: "message",
    role: "assistant",
    content: [],
    stop_reason: null,
    stop_sequence: null,
  };
  const blocks = new Map();
  const argumentsJSON = new Map();
  return {
    apply(data, type) {
      if (type === "message_start") {
        body = { ...body, ...data.message };
        for (const [position, block] of (data.message?.content ?? []).entries())
          blocks.set(position, block);
      } else if (type === "content_block_start") {
        blocks.set(index(data.index), data.content_block);
      } else if (type === "content_block_delta") {
        const position = index(data.index);
        const block = blocks.get(position);
        if (!block) throw new Error("Content delta without a content block");
        const delta = data.delta ?? {};
        const field = {
          text_delta: "text",
          thinking_delta: "thinking",
          signature_delta: "signature",
        }[delta.type];
        if (field) block[field] = (block[field] ?? "") + (delta[field] ?? "");
        if (delta.type === "input_json_delta") {
          argumentsJSON.set(
            position,
            (argumentsJSON.get(position) ?? "") + (delta.partial_json ?? ""),
          );
        }
      } else if (type === "message_delta") {
        Object.assign(body, data.delta);
        if (data.usage) body.usage = { ...body.usage, ...data.usage };
      }
    },
    finish() {
      for (const [position, value] of argumentsJSON) {
        try {
          blocks.get(position).input = JSON.parse(value);
        } catch {
          throw new Error("Invalid tool input JSON in upstream stream");
        }
      }
      body.content = sorted(blocks);
      return body;
    },
  };
}

export async function collapseResponse(response, protocol) {
  if (!response.ok) return response;
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "text/event-stream") return response;
  const factories = {
    chat: chatAccumulator,
    responses: responsesAccumulator,
    anthropic: anthropicAccumulator,
  };
  if (!Object.hasOwn(factories, protocol)) throw new TypeError(`Unsupported protocol: ${protocol}`);
  const accumulator = factories[protocol]();
  let completed = false;
  let failure;
  let eventName = "";
  let dataLines = [];
  let lineParts = [];
  let skipLF = false;

  function dispatch() {
    const name = eventName;
    const text = dataLines.join("\n");
    eventName = "";
    dataLines = [];
    if (failure) return;
    if (name === "error") {
      let value = text;
      try {
        value = JSON.parse(text);
      } catch {
        /* Error events may contain plain text. */
      }
      failure = errorMessage(value);
      return;
    }
    if (!text.trim()) return;
    if (text.trim() === "[DONE]") {
      if (protocol === "chat") completed = true;
      return;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      failure = "Invalid JSON in upstream SSE event";
      return;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      failure = "Invalid JSON object in upstream SSE event";
      return;
    }
    const type = data.type ?? name;
    if (
      data.error ||
      type === "error" ||
      type === "response.failed" ||
      data.response?.status === "failed"
    ) {
      failure = errorMessage(data.error ?? data.response?.error ?? data);
      return;
    }
    if (completed) return;
    try {
      accumulator.apply(data, type);
    } catch (error) {
      failure = errorMessage(error, "Invalid upstream SSE event");
      return;
    }
    if (
      (protocol === "responses" &&
        (type === "response.completed" || type === "response.incomplete")) ||
      (protocol === "anthropic" && type === "message_stop")
    )
      completed = true;
  }

  function line(value) {
    if (value === "") return dispatch();
    if (value.startsWith(":")) return;
    const colon = value.indexOf(":");
    const field = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? "" : value.slice(colon + 1);
    if (content.startsWith(" ")) content = content.slice(1);
    if (field === "data") dataLines.push(content);
    if (field === "event") eventName = content;
  }

  function feed(text) {
    let start = 0;
    if (skipLF && text.length) {
      if (text[0] === "\n") start = 1;
      skipLF = false;
    }
    const endings = /[\r\n]/g;
    endings.lastIndex = start;
    let match;
    while ((match = endings.exec(text))) {
      lineParts.push(text.slice(start, match.index));
      line(lineParts.join(""));
      lineParts = [];
      start = match.index + 1;
      if (match[0] === "\r") {
        if (text[start] === "\n") start++;
        else if (start === text.length) skipLF = true;
      }
      endings.lastIndex = start;
    }
    if (start < text.length) lineParts.push(text.slice(start));
  }

  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) {
          failure = "Upstream SSE exceeds the 32 MiB buffer limit";
          await reader.cancel();
          break;
        }
        feed(decoder.decode(value, { stream: true }));
        if (failure) {
          await reader.cancel();
          break;
        }
      }
      feed(decoder.decode());
    } finally {
      reader.releaseLock();
    }
  }
  if (!failure && !completed) failure = "Upstream SSE ended without a completion marker";
  let body;
  if (!failure) {
    try {
      body = accumulator.finish();
    } catch (error) {
      failure = errorMessage(error);
    }
  }
  return jsonResponse(response, protocol, body, failure);
}

