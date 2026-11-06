// Attach to a standalone service another Magpie host already started, instead
// of starting a second one against the same data directory. The service owns
// the lock and the port; this module only speaks its existing management API.
import fs from 'node:fs';
import path from 'node:path';

const READ_TIMEOUT = 10000;

function settingsOf(dataDir) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
}

/** The address the running service bound, per its own persisted settings. */
function baseOf(dataDir, settings) {
  const port = Number.isInteger(settings.standalonePort) ? settings.standalonePort : 18900;
  return `http://127.0.0.1:${port}`;
}

/**
 * Verify the lock owner's service really answers before adopting it, so a
 * crashed-but-lingering lock falls back to the normal spawn path instead of
 * leaving this host attached to nothing.
 */
async function probe(base, signal) {
  const response = await fetch(`${base}/health`, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(READ_TIMEOUT)]),
  });
  if (!response.ok) throw new Error(`内置服务健康检查失败（HTTP ${response.status}）`);
  const health = await response.json();
  if (health?.service !== 'our-free-model-standalone') throw new Error('占用数据目录的进程不是 Our Free Model 内置服务');
  return health;
}

async function getJson(base, key, route, signal) {
  const response = await fetch(`${base}${route}`, {
    headers: { accept: 'application/json', authorization: `Bearer ${key}`, origin: base },
    redirect: 'error',
    signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(READ_TIMEOUT)]),
  });
  if (!response.ok) throw new Error(`内置服务读取 ${route} 失败（HTTP ${response.status}）`);
  return response.json();
}

/**
 * `managedModels` is the authoritative row set the plugin's own runner emits,
 * served by the management summary. `/v1/models` must not be used for
 * discovery: it drops the display name, the thinking menu and the input
 * modalities, so copying it declares wrong capabilities to the agent.
 */
async function modelRows(base, key, signal) {
  const summary = await getJson(base, key, '/api/management/summary', signal);
  const rows = Array.isArray(summary?.managedModels) ? summary.managedModels : [];
  const routable = new Set((Array.isArray(summary?.catalog) ? summary.catalog : [])
    .filter(row => row.routable === true)
    .map(row => row.id));
  return {
    rows,
    routable,
  };
}

async function rpc(base, key, method, payload, signal) {
  const response = await fetch(`${base}/api/management/channels/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, origin: base },
    body: JSON.stringify({ method, payload }),
    redirect: 'error',
    signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(30000)]),
  });
  if (!response.ok) throw new Error(`内置服务渠道请求失败（HTTP ${response.status}）`);
  const value = await response.json();
  return value?.ok === true ? value.value : undefined;
}

/**
 * Adopt the running service. Throws when the lock owner is not actually
 * serving, so `ensure()` can fall back to starting its own.
 */
export async function attachLiveService(dataDir, { signal } = {}) {
  const settings = settingsOf(dataDir);
  if (typeof settings.forwardKey !== 'string' || settings.forwardKey === '') throw new Error('内置服务密钥不可用');
  const base = baseOf(dataDir, settings);
  await probe(base, signal);
  const key = settings.forwardKey;
  const cached = await modelRows(base, key, signal);
  return {
    url: base,
    keyFile: path.join(dataDir, 'settings.json'),
    managementBase: base,
    async managementSession() {
      return {
        key,
        login: settings.managementLoginToken ?? '',
        routable: cached.routable,
        models: async () => (await modelRows(base, key, signal)).rows,
      };
    },
    async models() { return cached.rows; },
  };
}
