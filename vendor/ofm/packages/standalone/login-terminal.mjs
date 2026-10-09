import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const runFile = promisify(execFile)
const encode = command => Buffer.from(command, 'utf16le').toString('base64')
const quote = value => `'${value.replaceAll("'", "''")}'`
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`

/** 只运行固定的本机取令牌动作，不接受网页传入的路径或命令。 */
export async function openLoginTerminal(dataDir, {
  platform = process.platform, exec = runFile, execPath = process.execPath,
  systemRoot = process.env.SystemRoot ?? 'C:\\Windows',
} = {}) {
  const keyFile = (platform === 'win32' ? path.win32 : path.posix).join(dataDir, 'settings.json')
  if (platform === 'darwin') {
    const copy = [
      'const fs = require("node:fs");',
      'const { execFileSync } = require("node:child_process");',
      'const key = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).forwardKey;',
      'if (typeof key !== "string" || !key.trim()) throw new Error("missing login token");',
      'execFileSync("/usr/bin/pbcopy", [], { input: key, timeout: 5000, stdio: ["pipe", "ignore", "ignore"] });',
    ].join(' ')
    // 命令行只包含固定脚本和配置路径；令牌只经 stdin 传给 pbcopy。
    const command = [
      `if ${shellQuote(execPath)} -e ${shellQuote(copy)} ${shellQuote(keyFile)} 2>/dev/null; then`,
      `  printf '%s\\n' ${shellQuote('登录令牌已复制。回到网页，粘贴到登录令牌输入框即可。')}`,
      `  printf '%s\\n' ${shellQuote('完成后可以关闭此窗口，请勿向他人分享令牌。')}`,
      'else',
      `  printf '%s\\n' ${shellQuote('获取令牌失败，请检查本地 settings.json 或使用页面的手动入口。')}`,
      'fi',
    ].join('\n')
    const script = [
      'on run argv',
      '  tell application "Terminal"',
      '    do script (item 1 of argv)',
      '    activate',
      '  end tell',
      'end run',
    ].join('\n')
    await exec('/usr/bin/osascript', ['-e', script, `/bin/sh -c ${shellQuote(command)}`], { timeout: 10000 })
    return
  }
  if (platform !== 'win32') {
    throw Object.assign(new Error('自动打开终端仅支持 Windows 和 macOS，请按页面说明手动获取令牌。'), { statusCode: 400 })
  }
  const powershell = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const command = [
    "$Host.UI.RawUI.WindowTitle = 'Our Free Model - 获取登录令牌'",
    "$ErrorActionPreference = 'Stop'",
    'try {',
    `  $ofmLoginKey = (Get-Content -LiteralPath ${quote(keyFile)} -Raw -Encoding UTF8 | ConvertFrom-Json).forwardKey`,
    "  if ([string]::IsNullOrWhiteSpace($ofmLoginKey)) { throw '配置文件没有登录令牌' }",
    '  Set-Clipboard -Value $ofmLoginKey',
    '  $ofmLoginKey = $null',
    "  Write-Host '登录令牌已复制。回到网页，粘贴到登录令牌输入框即可。' -ForegroundColor Green",
    "  Write-Host '完成后可以关闭此窗口，请勿向他人分享令牌。'",
    "} catch { Write-Host '获取令牌失败，请检查本地 settings.json 或使用页面的手动入口。' -ForegroundColor Red }",
  ].join('\n')
  const launch = `Start-Process -FilePath ${quote(powershell)} -WindowStyle Normal -ArgumentList '-NoProfile -STA -NoExit -EncodedCommand ${encode(command)}' -ErrorAction Stop`
  await exec(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(launch)], {
    windowsHide: true, timeout: 10000,
  })
}
