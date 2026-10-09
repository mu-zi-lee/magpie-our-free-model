export const protocols = [
  { protocol: "chat", path: "chat/completions", model: "chat-free" },
  { protocol: "responses", path: "responses", model: "responses-free" },
  { protocol: "anthropic", path: "messages", model: "messages-free" },
];

export function declaredTools(protocol) {
  return ["Bash", "Read"].map((name) => {
    const schema = { type: "object", properties: { command: { type: "string" } } };
    const tool = { name, description: `Client ${name}` };
    if (protocol === "chat") return { type: "function", function: { ...tool, parameters: schema } };
    if (protocol === "anthropic") return { ...tool, input_schema: schema };
    return { type: "function", ...tool, parameters: schema };
  });
}

export function toolReply(protocol, name, sse = true) {
  const args = JSON.stringify({ command: "ls -la" });
  const event = (value) => `data: ${JSON.stringify(value)}\n\n`;
  if (protocol === "chat") {
    const tool = { id: "call_1", type: "function", function: { name, arguments: args } };
    if (!sse)
      return JSON.stringify({
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: null, tool_calls: [tool] },
            finish_reason: "tool_calls",
          },
        ],
      });
    return (
      event({
        id: "c1",
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, ...tool }] }, finish_reason: null },
        ],
      }) +
      event({ id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }) +
      "data: [DONE]\n\n"
    );
  }
  if (protocol === "responses") {
    const item = {
      id: "fc1",
      type: "function_call",
      call_id: "call_1",
      name,
      arguments: args,
      status: "completed",
    };
    const response = { id: "r1", object: "response", status: "completed", output: [item] };
    if (!sse) return JSON.stringify(response);
    return (
      event({
        type: "response.output_item.added",
        output_index: 0,
        item: { ...item, arguments: "", status: "in_progress" },
      }) +
      event({ type: "response.output_item.done", output_index: 0, item }) +
      event({ type: "response.completed", response })
    );
  }
  const block = { type: "tool_use", id: "call_1", name, input: JSON.parse(args) };
  const message = {
    id: "m1",
    type: "message",
    role: "assistant",
    content: [block],
    stop_reason: "tool_use",
    usage: { input_tokens: 1, output_tokens: 2 },
  };
  if (!sse) return JSON.stringify(message);
  return (
    event({ type: "message_start", message: { ...message, content: [], stop_reason: null } }) +
    event({ type: "content_block_start", index: 0, content_block: block }) +
    event({ type: "content_block_stop", index: 0 }) +
    event({ type: "message_delta", delta: { stop_reason: "tool_use" } }) +
    event({ type: "message_stop" })
  );
}

