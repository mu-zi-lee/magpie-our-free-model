// Some upstreams mislabel SSE as JSON. Inspect only the prefix and replay every
// consumed byte, preserving streaming and downstream backpressure.
export async function normalizeResponse(response) {
  if (!response.ok || !response.body) return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const prefix = [];
  let text = '';
  let bytes = 0;
  let done = false;
  let type;
  try {
    while (bytes < 4096) {
      const part = await reader.read();
      done = part.done;
      if (part.value) { prefix.push(part.value); bytes += part.value.byteLength; text += decoder.decode(part.value, { stream: true }); }
      const head = text.replace(/^\uFEFF/, '').trimStart();
      if (/^(?:data:|event:|:)/.test(head)) { type = 'text/event-stream'; break; }
      if (/^[{[]/.test(head)) { type = 'application/json'; break; }
      if (done) break;
    }
  } catch (error) {
    try { await reader.cancel(error); } catch { /* keep the read error */ }
    throw error;
  }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  if (type) headers.set('content-type', type);
  let index = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (index < prefix.length) { controller.enqueue(prefix[index++]); return; }
      if (done) { controller.close(); return; }
      try {
        const part = await reader.read();
        done = part.done;
        if (done) controller.close(); else controller.enqueue(part.value);
      } catch (error) { controller.error(error); }
    },
    cancel(reason) { return reader.cancel(reason); },
  }, { highWaterMark: 0 });
  return new Response(stream, { status: response.status, statusText: response.statusText, headers });
}
