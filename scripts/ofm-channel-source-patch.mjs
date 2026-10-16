// Select a verified upstream bundle without modifying its channel/login logic.
export function patchChannelSource(file, source) {
  const pairs = file.endsWith('/service.mjs') ? [
    ['probe, eacCredential, eacSetup,', 'probe, eacCredential, eacSetup, channelBusiness, pluginVersion,'],
    ["import { createChannelRuntime } from './channels/runtime.mjs'\n",
      "import { createChannelRuntime } from './channels/runtime.mjs'\nimport { setSessionStoreRoot } from '../../src/upstream.js'\n"],
    ['  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })\n  const releaseLock = await acquireServiceLock(dataDir)',
      '  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })\n  setSessionStoreRoot(dataDir)\n  const releaseLock = await acquireServiceLock(dataDir)'],
    ['      ...stores, logger, attributionUserAgent: `${PRODUCT}/${VERSION}`,',
      '      ...stores, logger, attributionUserAgent: `ofm-standalone/${VERSION}`,'],
    ['      info: () => ({\n        product: PRODUCT, version: VERSION, dataDir,',
      '      info: () => ({\n        product: PRODUCT, version: VERSION, pluginVersion, dataDir,'],
    ['createChannelRuntime({ dataDir, logger, stats: stores.stats })', 'createChannelRuntime({ dataDir, logger, stats: stores.stats, businessPath: channelBusiness })'],
  ] : file.endsWith('/runtime.mjs') ? [
    ['createChannelRuntime({ dataDir, logger = console, stats })', 'createChannelRuntime({ dataDir, logger = console, stats, businessPath })'],
    ['workerData: { dataDir }', 'workerData: { dataDir, businessPath }'],
  ] : [
    ["import {\n  apply,", "const {\n  apply,"],
    ["} from './business.mjs'", "} = await import(workerData.businessPath ?? new URL('./business.mjs', import.meta.url).href)"],
    ['const body = { ...request.responsesBody ?? request.openAi, model: request.model }',
      `// Anthropic forwarding already supplies harness messages and tools.
  const harness = request.openAi === undefined && request.responsesBody === undefined
  const body = harness
    ? { max_tokens: request.maxTokens, reasoning_effort: request.reasoningEffort }
    : { ...request.responsesBody ?? request.openAi, model: request.model }`],
    ['const options = await convert(body, signal, effort, maxTokens, { bridge: attachments }, dropped => logger.warn(`忽略无法表达的工具类型：${dropped.type}`))',
      `const options = harness
    ? { provider, model, messages: request.messages, tools: request.tools, signal,
        ...request.temperature === undefined ? {} : { temperature: request.temperature },
        ...effort == null ? {} : { reasoningEffort: effort },
        ...maxTokens === undefined ? {} : { maxTokens } }
    : await convert(body, signal, effort, maxTokens, { bridge: attachments }, dropped => logger.warn(\`忽略无法表达的工具类型：\${dropped.type}\`))`],
  ];
  for (const [before, after] of pairs) {
    if (source.split(before).length !== 2) throw new Error('Upstream channel source integration changed');
    source = source.replace(before, after);
  }
  return source;
}
