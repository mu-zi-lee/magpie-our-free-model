import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/** 独立应用凭据仓库。同步原子写入，失败冒泡；从不读取 DSH 文件。 */
export function createCredentials(dataDir) {
  const file = path.join(dataDir, 'channel-credentials.json')
  let values = {}
  if (fs.existsSync(file)) {
    const loaded = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) throw new Error('独立凭据文件格式错误')
    values = loaded
  }
  let closed = false
  const key = ref => {
    if (typeof ref !== 'string' || !/^[A-Za-z0-9_.-]{1,200}$/.test(ref)) throw new TypeError('凭据引用无效')
    return ref
  }
  const save = next => {
    if (closed) throw new Error('凭据仓库已停止')
    const temp = `${file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
    try {
      fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600, flag: 'wx' })
      fs.renameSync(temp, file)
      values = next
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
  }
  return {
    async resolve(ref) {
      const value = values[key(ref)]
      return typeof value === 'string' ? { value, source: 'local' } : undefined
    },
    async describe(ref) { return { source: typeof values[key(ref)] === 'string' ? 'local' : undefined } },
    async set(ref, value) {
      if (typeof value !== 'string') throw new TypeError('凭据必须为字符串')
      save({ ...values, [key(ref)]: value })
    },
    async unset(ref) {
      const next = { ...values }
      delete next[key(ref)]
      save(next)
    },
    dispose() { closed = true; values = {} },
  }
}
