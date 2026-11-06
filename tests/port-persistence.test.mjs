import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { startStandalone } from '../vendor/ofm/packages/standalone/service.mjs'

test('standalone fallback ports are not persisted over the configured port', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ofm-port-'))
  const execArgv = process.execArgv
  process.execArgv = []
  const blocker = net.createServer()
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve))
  const requested = blocker.address().port
  let service
  try {
    service = await startStandalone({ dataDir, host: '127.0.0.1', port: requested, refresh: false,
      logger: { info() {}, warn() {}, error() {} } })
    assert.notEqual(service.port, requested)
    const settings = JSON.parse(await fs.readFile(path.join(dataDir, 'settings.json'), 'utf8'))
    assert.equal(settings.standalonePort, undefined)
  } finally {
    await service?.close()
    await new Promise(resolve => blocker.close(resolve))
    await fs.rm(dataDir, { recursive: true, force: true })
    process.execArgv = execArgv
  }
})
