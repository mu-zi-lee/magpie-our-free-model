import assert from "node:assert/strict";
import test from "node:test";

const subject = import("./models.mjs").catch(() => ({}));
const provider = {
  npm: "@ai-sdk/openai-compatible",
  models: {
    "coder-free": {
      name: "Coder Free",
      cost: { input: 0, output: 0 },
      limit: { context: 200000, input: 160000, output: 32000 },
      reasoning: true,
      tool_call: true,
      modalities: { input: ["text", "image"], output: ["text"] },
      reasoning_options: [{ type: "effort", values: ["low", "high"] }],
    },
    "zero-cost": { cost: { input: 0, output: 0 } },
    paid: { cost: { input: 1, output: 3 } },
    "old-free": { status: "deprecated", cost: { input: 0, output: 0 } },
    "decision-free": { provider: { npm: "@vendor/systemone" } },
    "responses-free": { provider: { npm: "@ai-sdk/openai" } },
    "messages-free": { provider: { npm: "@ai-sdk/anthropic" } },
    "gone-free": {},
  },
};
const ids = Object.keys(provider.models).filter((id) => id !== "gone-free");
const baseURL = "https://opencode.ai/zen/v1";

test("lists only live free models with supported protocols and excludes retired models", async () => {
  const { buildModels } = await subject;
  assert.equal(typeof buildModels, "function", "model discovery must be implemented");
  const models = buildModels(ids, provider, {}, baseURL);
  assert.deepEqual(Object.keys(models).sort(), [
    "coder-free",
    "messages-free",
    "responses-free",
    "zero-cost",
  ]);
  assert.equal(models["coder-free"].free, true);
  assert.equal(models["coder-free"].providerID, "our-free-zen");
  assert.deepEqual(models["coder-free"].limit, { context: 200000, input: 160000, output: 32000 });
  assert.equal(models["coder-free"].capabilities.input.image, true);
  assert.equal(models["coder-free"].capabilities.toolcall, true);
  assert.deepEqual(Object.keys(models["coder-free"].variants), ["low", "high"]);
  assert.equal(models["responses-free"].api.npm, "@ai-sdk/openai");
  assert.equal(models["messages-free"].api.npm, "@ai-sdk/anthropic");
});

test("endpoint documentation overrides inherited SDK and excludes SystemOne", async () => {
  const { buildModels, parseProtocolDocs } = await subject;
  assert.equal(typeof parseProtocolDocs, "function", "protocol parsing must be implemented");
  const protocols = parseProtocolDocs(
    [
      "| Coder | coder-free | `https://opencode.ai/zen/v1/messages` | sdk |",
      "| Decision | decision-free | `https://opencode.ai/zen/v1/systemone` | - |",
    ].join("\n"),
  );
  const models = buildModels(ids, provider, protocols, baseURL);
  assert.equal(models["coder-free"].api.npm, "@ai-sdk/anthropic");
  assert.equal(models["decision-free"], undefined);
});

test("unknown models require a known protocol rather than a guessed chat endpoint", async () => {
  const { buildModels } = await subject;
  assert.equal(typeof buildModels, "function", "model discovery must be implemented");
  assert.deepEqual(Object.keys(buildModels(["new-free", "unknown-paid"], {}, {}, baseURL)), []);
  const models = buildModels(["new-free"], {}, { "new-free": "chat" }, baseURL);
  assert.equal(models["new-free"].api.url, baseURL);
  assert.equal(models["new-free"].cost.input, 0);
});

