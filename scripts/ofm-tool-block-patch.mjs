// Selective port of upstream be4aa21 (#829), applied after stream-wire patches.
export function patchCompletedToolBlocks(source) {
  const edits = [
    [`      held.set(blockIndex, parked)
      return { kind: 'drop' }
    },`, `      held.set(blockIndex, parked)
      return { kind: 'drop' }
    },
    admitBlockEnd(block, blockIndex) {
      if (classified.get(blockIndex) === false) return { kind: 'drop' }
      if (typeof block.name !== 'string' || block.name === '' || !this.executable(block.name)) return { kind: 'drop' }
      classified.set(blockIndex, true)
      const parked = held.get(blockIndex)
      held.delete(blockIndex)
      return { kind: 'forward', openAiIndex: this.indexOf(blockIndex), first: true,
        id: block.id || parked?.id, name: block.name, args: typeof block.arguments === 'string' ? block.arguments : '' }
    },`],
    [`  const outcome = await complete({ model, openAi: body }, (chunk) => {`, `  const opened = new Set()
  const emitTool = action => {
    if (action.kind === 'drop') return
    if (action.first) {
      opened.add(action.openAiIndex)
      sendSse(res, { id, object: 'chat.completion.chunk', created, model,
        choices: [{ index: 0, delta: { tool_calls: [{ index: action.openAiIndex, id: action.id,
          type: 'function', function: { name: action.name, arguments: '' } }] }, finish_reason: null }] })
    }
    if (action.args) sendSse(res, { id, object: 'chat.completion.chunk', created, model,
      choices: [{ index: 0, delta: { tool_calls: [{ index: action.openAiIndex,
        function: { arguments: action.args } }] }, finish_reason: null }] })
  }
  const outcome = await complete({ model, openAi: body }, (chunk) => {`],
  ];
  // Keep the existing authentication, decoy filter, Responses, and error paths.
  const start = source.indexOf("    if (chunk.type === 'tool-call-delta') {\n      const action = tools.admit(chunk)");
  const end = source.indexOf("    if (chunk.type === 'usage') {", start);
  if (start < 0 || end < start) throw new Error('Chat tool delta anchor changed');
  source = source.slice(0, start) + `    if (chunk.type === 'tool-call-delta') {
      emitTool(tools.admit(chunk))
      return
    }
    if (chunk.type === 'block-end' && chunk.block?.type === 'tool-call') {
      const action = tools.admitBlockEnd(chunk.block, chunk.index)
      if (action.kind === 'forward' && !opened.has(action.openAiIndex)) emitTool(action)
      return
    }
` + source.slice(end);
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error('Completed-tool patch anchor changed');
    source = source.replace(before, () => after);
  }
  return patchFinalToolArguments(source);
}

// Port upstream 0512bed (#920) without replacing the newer platform runtime.
export function patchFinalToolArguments(source) {
  const edits = [
    ["  const opened = new Set()\n  const emitTool = action => {", `  const opened = new Set()
  const forwardedArgs = new Map()
  let toolArgsTruncated = false
  const emitTool = action => {`],
    ["    if (action.args) sendSse(res, { id, object: 'chat.completion.chunk', created, model,", `    if (action.args) forwardedArgs.set(action.openAiIndex, (forwardedArgs.get(action.openAiIndex) ?? '') + action.args)
    if (action.args) sendSse(res, { id, object: 'chat.completion.chunk', created, model,`],
    ["      if (action.kind === 'forward' && !opened.has(action.openAiIndex)) emitTool(action)", `      if (action.kind === 'forward') {
        const sent = forwardedArgs.get(action.openAiIndex) ?? ''
        if (!action.args.startsWith(sent)) { toolArgsTruncated = true; return }
        emitTool({ ...action, first: !opened.has(action.openAiIndex), args: action.args.slice(sent.length) })
      }`],
    ["  const calls = executableCalls(outcome, tools)\n  const suppressed = suppressedOnlyNote(outcome, calls)", `  const actualArgsCut = outcome.truncated === true && [...forwardedArgs.values()].some(argumentsCutMidway)
  const wireOutcome = toolArgsTruncated || actualArgsCut ? { ...outcome, toolCalls: [], truncated: true } : outcome
  const calls = executableCalls(wireOutcome, tools)
  const suppressed = suppressedOnlyNote(wireOutcome, calls)`],
    ["choices: [{ index: 0, delta: {}, finish_reason: calls.length ? 'tool_calls' : outcome.truncated ? 'length' : 'stop' }]", "choices: [{ index: 0, delta: {}, finish_reason: calls.length ? 'tool_calls' : wireOutcome.truncated ? 'length' : 'stop' }]"],
    ["/** Per-request tool-wire state: harness block index → OpenAI tool index. */", `// Structural incompleteness is a truncation; schema errors remain tool errors.
function argumentsCutMidway(raw) {
  let depth = 0
  let inString = false
  let escaped = false
  for (const ch of raw) {
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\\\') escaped = true
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') depth += 1
    else if (ch === '}' || ch === ']') depth -= 1
  }
  return inString || depth !== 0
}

/** Per-request tool-wire state: harness block index → OpenAI tool index. */`],
  ];
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error('Final-tool-arguments patch anchor changed');
    source = source.replace(before, () => after);
  }
  return source;
}
