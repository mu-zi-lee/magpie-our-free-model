#!/usr/bin/env node
import path from 'node:path'
import { startStandalone } from './service.mjs'

const usage = `Our Free Model 独立本地服务
用法：node packages/standalone/cli.mjs [选项]

  --port <端口>       监听端口，默认 18900（冲突时自动选择可用端口）
  --data-dir <目录>   数据目录，默认 OFM_HOME 或 ~/.our-free-model
  --no-refresh        跳过启动与周期刷新；仍可手动刷新和推理
  --probe             启用并保存自动探测设置，会产生上游请求
  --help              显示帮助
`

async function main() {
  const options = {}
  for (let index = 2; index < process.argv.length; index++) {
    const flag = process.argv[index]
    if (flag === '--help') { process.stdout.write(usage); return }
    if (flag === '--no-refresh') { options.refresh = false; continue }
    if (flag === '--probe') { options.probe = true; continue }
    if (!['--port', '--data-dir'].includes(flag) || !process.argv[index + 1] || process.argv[index + 1].startsWith('--')) {
      throw new Error(`未知选项或缺少参数：${flag}`)
    }
    const value = process.argv[++index]
    if (flag === '--port') {
      if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error('端口必须为 0 到 65535 的整数')
      options.port = Number(value)
    } else options.dataDir = path.resolve(value)
  }
  const service = await startStandalone(options)
  let stopping = false
  const shutdown = () => {
    if (stopping) return
    stopping = true
    void service.close().catch(error => {
      process.stderr.write(`停止失败：${error.message}\n`)
      process.exitCode = 1
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  process.stdout.write(`${service.product} ${service.version}\n管理页面（10 分钟内一次性登录）：${service.managementUrl}\nAPI：${service.url}/v1\nAPI Key 保存在：${service.keyFile}\n`)
}

main().catch(error => {
  process.stderr.write(`启动失败：${error.code === 'EEXIST' ? '数据目录已被服务占用，请检查 service.lock 中的进程；异常退出后确认旧进程停止再移除锁文件。' : error.message}\n`)
  process.exitCode = 1
})
