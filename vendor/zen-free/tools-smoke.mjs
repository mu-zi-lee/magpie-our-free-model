import { ZenFreePlugin } from "./index.mjs";
import { collapseResponse } from "./stream.mjs";

const hooks = await ZenFreePlugin({ project: { id: "magpie" } });
const auth = { type: "api", key: "public" };
const models = await hooks.provider.models({ models: {} }, { auth });
const loader = await hooks.auth.loader(async () => auth);
const names = ["Bash", "Read"];
const schema = {
  type: "object",
  properties: { command: { type: "string" } },
  required: ["command"],
};
for (const [id, stream] of [
  ["big-pickle", true],
  ["big-pickle", false],
  ["mimo-v2.6-flash-free", true],
  ["mimo-v2.6-flash-free", false],
  ["muse-spark-1.3-contributor-free", true],
  ["muse-spark-1.3-contributor-free", false],
]) {
  if (!models[id]) {
    console.log(JSON.stringify({ model: id, skipped: "not in current catalog" }));
    continue;
  }
  const protocol = models[id].api.npm === "@ai-sdk/openai" ? "responses" : "chat";
  const path = protocol === "responses" ? "responses" : "chat/completions";
  const tools = names.map((name) =>
    protocol === "chat"
      ? {
          type: "function",
          function: { name, description: `Available client tool ${name}`, parameters: schema },
        }
      : {
          type: "function",
          name,
          description: `Available client tool ${name}`,
          parameters: schema,
        },
  );
  const body = { model: id, stream, tools };
  const prompt = "List the files in the current directory. Use the Bash tool to run ls -la.";
  if (protocol === "responses") {
    body.input = prompt;
    body.max_output_tokens = 512;
  } else {
    body.messages = [{ role: "user", content: prompt }];
    body.max_tokens = 512;
  }
  try {
    const response = await loader.fetch(`${loader.baseURL}/${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    const json = await (await collapseResponse(response, protocol)).json();
    const calls =
      protocol === "chat"
        ? (json.choices ?? [])
            .flatMap((choice) => choice.message?.tool_calls ?? [])
            .map((call) => call.function.name)
        : (json.output ?? [])
            .filter((item) => item.type === "function_call")
            .map((item) => item.name);
    if (calls.some((name) => !names.includes(name)))
      throw new Error(`Undeclared tool leaked: ${calls.join(", ")}`);
    console.log(
      JSON.stringify({
        model: id,
        stream,
        status: response.status,
        calls,
        error: json.error ?? null,
      }),
    );
    if (json.error || !response.ok || !calls.length) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ model: id, stream, error: error.message }));
    process.exitCode = 1;
  }
}

