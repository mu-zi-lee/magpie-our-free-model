import path from 'node:path'
import crypto from 'node:crypto'
import { openSeal } from '../../src/vault.js'
import { readEacUser, writeEacUser, clearEacUser, EAC_USER_FILE } from '../../src/eac-user.js'
import { createEacLoginPoller } from '../../src/eac-login.js'
import { directFetch } from '../../src/eac.js'

/** 独立产品自己的 EAC 入口；插件仍走 unlockSealedLane 的宿主判定。 */
export function createStandaloneEac({ dataDir, onSaved = () => {}, credentialOf = openSeal, fetch = directFetch }) {
  const file = path.join(dataDir, EAC_USER_FILE)
  const readUser = () => readEacUser(file)
  let closed = false
  let generation = 0
  let cached = { available: credentialOf() !== null, authorized: false, login: '' }
  let poolCache
  const controllers = new Set()
  const credential = () => closed ? null : credentialOf()
  const rootOf = lane => lane.base.replace(/\/v1\/?$/, '')
  async function hop(url, options = {}, timeout = 15000) {
    const controller = new AbortController()
    controllers.add(controller)
    try {
      return await fetch(url, { ...options, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout), ...options.signal ? [options.signal] : []]) })
    } finally { controllers.delete(controller) }
  }
  const poller = createEacLoginPoller({
    credentialOf: credential, fetch: hop, readUser,
    writeUser: user => closed ? null : writeEacUser(user, file),
    onSaved: saved => {
      generation++
      cached = { ...cached, available: true, authorized: true, local: true, login: saved.login, avatar: saved.avatar, savedAt: saved.savedAt }
      onSaved()
    },
  })
  return {
    credential() {
      const lane = credential()
      const user = readUser()
      // 未授权安装不在启动时访问 EAC 上游；授权入口仍可查询网关状态。
      if (lane?.mode === 'worker' && user === null) return null
      // 未登录时显式传 null，防止读取插件的默认凭据文件。
      return lane === null ? null : { ...lane, flavor: 'standalone', userToken: user?.token ?? null }
    },
    cached: () => cached,
    async status() {
      const lane = credential()
      if (lane === null || lane.mode !== 'worker') return { available: lane !== null, mode: lane?.mode ?? null, authorized: lane?.mode === 'direct', login: '' }
      const user = readUser()
      const started = generation
      const base = { available: true, mode: 'worker', local: user !== null, login: user?.login ?? '', avatar: user?.avatar ?? '', savedAt: user?.savedAt ?? 0 }
      try {
        const response = await hop(`${rootOf(lane)}/auth/status`, { headers: { accept: 'application/json', ...user ? { 'x-ofm-user': user.token } : {} } })
        const data = await response.json()
        if (!response.ok || !data || typeof data !== 'object') throw new Error('bad answer')
        if (closed || started !== generation) return cached
        cached = {
          ...base, configured: data.configured === true, required: data.required === true,
          authorized: data.authorized === true, starred: data.starred === true,
          login: typeof data.login === 'string' && data.login !== '' ? data.login : base.login,
          avatar: typeof data.avatar === 'string' && data.avatar !== '' ? data.avatar : base.avatar,
          lastCheck: Number.isFinite(data.lastCheck) ? data.lastCheck : 0,
          reason: typeof data.reason === 'string' ? data.reason : null,
          repo: typeof data.repo === 'string' ? data.repo : '', checkedAt: Date.now(),
        }
      } catch {
        if (closed || started !== generation) return cached
        cached = { ...base, authorized: user !== null, unverified: true, checkedAt: Date.now() }
      }
      return cached
    },
    async start() {
      const lane = credential()
      if (lane?.mode !== 'worker') return { error: 'no-lane' }
      const link = crypto.randomBytes(24).toString('base64url')
      const prepared = await poller.prepare(link)
      if (prepared.error) return prepared
      return { link, url: `${rootOf(lane)}/auth/github/start?link=${link}`, opened: false }
    },
    poll: link => poller.poll(link),
    cancel: link => poller.cancel(link),
    async logout() {
      poller.reset()
      const lane = credential()
      const user = readUser()
      // 先清除本地授权；网关不可达也不能继续以旧身份发出请求。
      if (!clearEacUser(file)) return { ok: false }
      generation++
      cached = { available: lane !== null, authorized: false, login: '', local: false }
      onSaved()
      if (user && lane?.mode === 'worker') {
        try { await hop(`${rootOf(lane)}/auth/logout`, { method: 'POST', headers: { 'x-ofm-user': user.token } }, 8000) } catch {}
      }
      return { ok: true }
    },
    async pool() {
      if (poolCache && Date.now() - poolCache.at < 30000) return poolCache.data
      const lane = credential()
      if (lane?.mode !== 'worker') throw Object.assign(new Error('no-lane'), { statusCode: 404 })
      try {
        const response = await hop(`${rootOf(lane)}/pool`, { headers: { accept: 'application/json' } }, 20000)
        const data = await response.json()
        if (!response.ok || data?.ok !== true || !Number.isFinite(data.inflight)) throw new Error('gateway-status')
        poolCache = { data, at: Date.now() }
        return data
      } catch {
        if (poolCache && Date.now() - poolCache.at < 600000) return poolCache.data
        throw Object.assign(new Error('unreachable'), { statusCode: 502 })
      }
    },
    dispose() {
      closed = true
      generation++
      poller.reset()
      for (const controller of controllers) controller.abort()
      controllers.clear()
    },
  }
}
