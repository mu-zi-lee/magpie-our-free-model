import { guardToolResponse } from '../vendor/zen-free/tool-response.mjs';
import { collapseResponse } from '../vendor/zen-free/stream.mjs';
import { normalizeResponse } from './response.mjs';

export function baseURL(value, loopback = false) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      !['http:', 'https:'].includes(url.protocol) ||
      (url.protocol === 'http:' && !local) || (loopback && !local)) {
    throw new Error(loopback ? '请输入本机地址，例如 http://127.0.0.1:18900/v1' : 'Endpoint must use HTTPS (HTTP is allowed only on loopback)');
  }
  return url.href.replace(/\/+$/, '');
}

export function cleanHeaders(input) {
  const headers = new Headers(input);
  for (const name of ['authorization', 'x-api-key', 'x-goog-api-key', 'proxy-authorization',
    'cookie', 'host', 'content-length', 'content-encoding', 'connection']) headers.delete(name);
  return headers;
}

export async function listModels(base, key, signal) {
  const headers = { accept: 'application/json', 'user-agent': 'magpie-our-free-model/0.2.0' };
  if (key) headers.authorization = `Bearer ${key}`;
  const response = await fetch(`${base}/models`, {
    headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel();
    const error = new Error(`Model discovery returned HTTP ${response.status}`);
    if (key && response.status === 401) error.signIn = 'expired';
    throw error;
  }
  const value = await response.json();
  if (!Array.isArray(value?.data)) throw new Error('Invalid model listing: expected data array');
  return value.data;
}

export function safeID(value) {
  return typeof value === 'string' && value.trim() !== '' &&
    !['__proto__', 'constructor', 'prototype'].includes(value.trim());
}

export function fallback(models) {
  const out = { ...models };
  out[Symbol.for('magpie.fellBack')] = true;
  return out;
}

export function positive(value, defaultValue) {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : defaultValue;
}

export async function forwardChat(request, body, { key, publicLane = false } = {}) {
  const streaming = body.stream === true;
  // One streaming upstream path also handles callers requesting ordinary JSON.
  body.stream = true;
  body.stream_options = { ...body.stream_options, include_usage: true };
  const headers = cleanHeaders(request.headers);
  headers.set('content-type', 'application/json');
  headers.set('accept', 'text/event-stream');
  headers.set('user-agent', 'magpie-our-free-model/0.2.0');
  if (key) headers.set('authorization', `Bearer ${key}`);
  const response = await fetch(request.url, {
    method: 'POST', headers, body: JSON.stringify(body), signal: request.signal, redirect: 'error',
  });
  if (!response.ok) {
    if (publicLane && response.status === 401) {
      const h = new Headers(response.headers);
      h.set('X-Magpie-Sign-In', 'kept');
      return new Response(response.body, { status: response.status, headers: h });
    }
    return response;
  }
  const names = new Set((body.tools ?? []).map(t => t?.function?.name).filter(n => typeof n === 'string'));
  for (const t of body.functions ?? []) if (typeof t?.name === 'string') names.add(t.name);
  const guarded = await guardToolResponse(await normalizeResponse(response), 'chat', { declared: names, injected: new Set() });
  return streaming ? guarded : collapseResponse(guarded, 'chat');
}

export async function chatRequest(input, init, base) {
  const request = new Request(input, init);
  if (request.method !== 'POST' || request.url !== `${base}/chat/completions`) {
    throw new Error('Unsupported endpoint or method');
  }
  request.signal.throwIfAborted();
  const body = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body) || !safeID(body.model)) throw new Error('Invalid chat request');
  if (body.tools !== undefined && !Array.isArray(body.tools)) throw new Error('tools must be an array');
  if (body.functions !== undefined && !Array.isArray(body.functions)) throw new Error('functions must be an array');
  return { request, body };
}
