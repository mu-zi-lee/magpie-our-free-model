# Our Free Model — Magpie 插件

> **原项目：[`Ebony-Vinyl/dsh-our-free-model`](https://github.com/Ebony-Vinyl/dsh-our-free-model)，作者 [Ebony-Vinyl](https://github.com/Ebony-Vinyl)。**
> 本仓库是它的第三方 **Magpie 适配版本**，不是原项目官方发布。
> 账号渠道、EAC 授权流程、本地服务与管理界面来自原项目；这些功能的主要实现归原作者及其上游贡献者。
> 本仓库新增 Magpie 供应商接口、自动服务管理、浏览器管理入口和兼容测试。

版本 **0.5.0**，包名 **`magpie-our-free-model`**。正常安装只显示 **Our Free Model** 一个供应商，统一提供匿名/Kilo、EAC 与账号渠道。
插件图标使用 `assets/icon.png` 的无损 WebP 副本（像素和尺寸相同，满足 Magpie 的 1 MB 限制），随包加载，无需联网获取图标。
原项目运行代码固定于 [`f8974369c5904858c696b520d8b9b82ad4425f78`](https://github.com/Ebony-Vinyl/dsh-our-free-model/tree/f8974369c5904858c696b520d8b9b82ad4425f78)，
随包保存在 `vendor/ofm/`。57 个保留文件中 52 个保持原始字节；5 个有明确适配改动：
移除内置 Google OAuth 默认凭据和 Loomy 微信 App ID、将 EAC 凭据模块替换为空实现、增加 EAC 来源入口及安装诊断。
两个 EAC 加密凭据数据文件不随包分发。原始 SHA-256、改动摘要和省略清单见 `vendor/ofm/UPSTREAM.json`。
首次启用时从原项目下载固定版本的 EAC 来源模块与依赖，校验后缓存到本机；不执行远程安装脚本，不需要另外安装 DSH。

## 一体化安装与使用（推荐）

1. 从本仓库 Code → Download ZIP 解压，或执行下方 `git clone`。把项目目录放到固定位置。
2. 在 Magpie 插件页面添加该目录，启用插件；不需要 `npm install` 或编译。
3. 在 **Our Free Model** 供应商点击 **启用模型 / 打开账号管理控制台**。
   插件自动启动随包携带的服务；桌面打开本机控制台，SSH/无桌面 Linux 默认提供 Tailscale 临时 HTTPS 控制台；无需填写本地 API Key。
4. 匿名 Zen/Kilo 模型可直接刷新使用。EAC 来源会自动安装，在控制台完成原项目的 GitHub 授权及 Star 校验后使用；
   账号渠道在控制台分别登录，完成后回 Magpie 刷新模型，并为 Agent 选用 `our-free-model` 下的模型。

```sh
git clone https://github.com/mu-zi-lee/magpie-our-free-model.git
magpie plugin add ./magpie-our-free-model
```

桌面 Magpie、`magpie web` 或 `magpie serve` 需要保持运行，内置服务随插件宿主运行。
终端可使用 `magpie plugin login our-free-model`，但短命 CLI 命令退出后其服务也会关闭；
要完成浏览器渠道登录，请优先使用正在运行的 Magpie 界面。
控制台链接为十分钟内一次性链接；再次点击供应商登录按钮会生成新链接。
链接换取 HttpOnly 管理会话，服务 API Key 不进入 URL。

### 一体化版本覆盖范围

| 功能 | 实现与位置 |
|---|---|
| 匿名 Zen 与 Kilo 免费池 | 统一供应商发现模型和推理，沿用原项目路由 |
| 十三个账号渠道的实现 | CodeArts、CodeBuddy、WorkBuddy 国际版、LobsterAI、Qoder、Qoder 中国版、TRAE、Cline、Loomy、Raccoon、MiniMax Code、ZCode、Gemini；**Gemini 需额外配置自有 OAuth 客户端，Loomy 微信扫码需额外配置 App ID** |
| 渠道登录、账号池、轮换和续期 | 原项目渠道后端与控制台；账号凭据只保存在本机 |
| 签到/领取积分、模型开关、积分锁定、账本与备份 | 原控制台与渠道实现；供应商停用及模型停用会阻止实际调用 |
| EAC 登录、Star 校验、资源池 | 自动安装原项目固定版本来源（也可指定本机目录），沿用原服务端授权；不修改服务端校验逻辑 |
| 模型上下文、图片、思考档位 | 根据真实运行目录映射到 Magpie，保留上游档位 ID |
| 用量、请求日志、服务设置 | 本机控制台；Magpie 也记录经过自身网关的请求用量 |
| Chat Completions / Responses | 内置服务支持两种；Magpie 插件使用 Chat 接口，Magpie 负责其他客户端协议转换 |
| 本机 API 转发 | 控制台 API 接入页复制地址和密钥；其他本机工具可调用 |
| 生命周期与密钥轮换 | 插件启动/停止服务；控制台轮换密钥后，插件下次请求自动读取新密钥 |

**仍有边界：**Magpie 没有插件自定义页面接口，所以管理界面在本机浏览器，不能嵌入 Magpie 窗口。
原 DSH 的公告推送、插件自更新/热重载、宿主 Agent 自动续跑和局域网中继尚未迁移。
本机服务只监听回环地址；更新此仓库后需通过 Magpie 重载插件或重启。
原项目的 OpenCode 账号渠道仍默认停用。
没有逐家使用真实账号验收，也不保证上游模型、登录接口和免费额度一直有效。

### Node 自动安装

Magpie 提供 Bun，但原项目渠道 Worker 需要 Node。插件先使用可用的 **Node.js 22.19+ 或 24+**；
服务器没有合适的 Node 时，首次启用自动从 **nodejs.org** 下载固定版本 **24.21.0**，
使用代码中固定的官方 SHA-256 校验，通过后解压并检查能否运行，再启动服务。
安装到数据目录的 `runtime/`，之后直接复用；无需 root、不改系统 Node/PATH、不执行远程安装脚本。
首次下载约 50–65 MB，需要访问 nodejs.org，解压后占用更多磁盘空间。
Linux/macOS 需要系统自带的 `tar`。支持 Linux x64/arm64、macOS x64/arm64 和 Windows x64/arm64；
Alpine 自动安装目前支持 x64。Windows/macOS 尚未实机验收。
下载失败、架构不支持或系统 libc 不兼容时会显示原因，修复后可重试，或指定已安装的 `managed.nodePath`。
显式设置了 `nodePath` 时会使用该路径；路径无效会报错，避免悄悄替换你指定的运行环境。
可设 `managed.autoInstallNode: false` 关闭自动下载。
官方运行环境与许可来自 [Node.js](https://nodejs.org/)；Unix 压缩包中的许可随运行环境保留。

### 更新已有版本

路径安装可在仓库目录运行 `git pull --ff-only`，随后完全退出并重启 Magpie，重新读取包名和入口。
ZIP 安装请用新版文件替换旧目录，保留自己的账号数据目录。
升级后主入口不再注册 `our-free-zen`、`our-free-kilo`、`our-free-local`；它们原有登录数据不会被插件删除。
若 Agent 仍选用了这些旧 ID，请改选 **Our Free Model** 下的模型。
若界面仍保留旧行，先重载插件；必要时移除旧插件条目，再添加同一目录。

### 服务器部署与浏览器控制台

默认 `managed.consoleAccess: "auto"`：检测到 SSH 环境，或没有 DISPLAY/WAYLAND_DISPLAY 的 Linux 时，
供应商登录入口使用 **临时远程控制台（Tailscale）**。自动判断只是环境启发式；
判断不符合实际时可在登录方式中选择本机/SSH 入口，或显式设置 `"local"`、`"tailscale"`。

1. 在持续运行的 Magpie 界面点击 **临时远程控制台（Tailscale）**。
2. 优先复用已连接的 Tailscale。Linux 缺少可用客户端/守护进程时，自动从官方
   [下载源](https://dl.tailscale.com/stable/) 下载固定 **1.102.4** 的静态二进制，按代码中固定 SHA-256 校验，缓存到插件数据目录 `runtime/`。
   自动下载支持 **Linux x64/arm64**，需要 `tar` 和访问官方下载源；不需要 root，不修改系统 PATH/服务。
3. 未加入网络时，会给出 Tailscale 官方授权链接。在自己电脑的浏览器登录你的 Tailscale 账号并授权，
   然后回 Magpie 再次点击同一入口。可能还需要按下一次链接启用 HTTPS/Funnel。
   **账号登录和管理员授权无法由插件代替**；浏览器无需安装 Tailscale。
4. 准备好后得到 `https://设备名.网络名.ts.net[:端口]/open/…`，直接在浏览器打开。
   链接十分钟有效、只能使用一次；首次公网 DNS 生效可能需要几分钟。
5. 完成账号管理后点击页面顶部 **结束远程访问**。页面退出登录、通道启动后满 **30 分钟**、
   或宿主退出都会关闭本次入口；重新点击可开启新通道。模型服务继续在服务器本机运行。

可选配置：

```json
{
  "managed": {
    "consoleAccess": "auto",
    "autoInstallTailscale": true
  }
}
```

可用 `tailscalePath` 指定已有 CLI，Linux 可用 `tailscaledPath` 指定守护进程。
macOS/Windows 的远程入口需要先安装并连接官方 Tailscale 客户端；本版不自动运行这些系统的提权安装器。
`autoInstallTailscale: false` 禁止自动下载，缺少客户端时直接显示原因。

管理服务仍只监听回环地址。Funnel 转发到插件独立的管理网关；网关校验 HTTPS Host/Origin、一次性链接和
Secure/HttpOnly 会话，拒绝模型 API 和本机终端登录入口。已有 Tailscale 节点使用空闲的 443/8443/10000 端口，
以前台会话运行，只撤销自己的会话，**不执行全局 reset/logout**。没有已连接节点的 Linux 使用独立 socket、
userspace networking 和内存状态，退出时注销临时节点。[Funnel](https://tailscale.com/docs/features/tailscale-funnel)、
[临时节点](https://tailscale.com/docs/features/ephemeral-nodes) 的账户权限和网络限制仍适用。

Funnel 解决管理页面可达性，不会改写厂商的 OAuth 注册规则。某些渠道（如 Gemini）仍使用独立的 localhost 回调端口，
这类登录仍需额外 SSH 转发该回调端口；本版未逐家使用真实账号验证远程登录。控制台 API 接入页显示的是服务器本机 API 地址，
不会通过这个临时入口公开模型 API。

如果不使用 Tailscale，可以保留 SSH 方式。在自己电脑上转发管理服务和一次性交接服务两个端口。
可设置固定端口，避免每次查找交接端口：

```json
{ "managed": { "consoleAccess": "local", "port": 18900, "consolePort": 18901 } }
```

重启服务器上的 Magpie，在你电脑的终端执行：

```sh
ssh -N -L 18900:127.0.0.1:18900 -L 18901:127.0.0.1:18901 your-user@your-server
```

保持这个终端运行，再打开 Magpie 给出的 `http://127.0.0.1:18901/open/…` 链接；
浏览器随后跳转到本机 18900，经 SSH 到达服务器控制台。交接链接只能使用一次，失效后重新生成。
两端对应端口需空闲；服务端 18900 若被占用会选择其他端口，以实际地址为准并调整转发。
部分账号渠道还依赖浏览器登录或其他回调端口，应按该渠道提示额外转发；Node 自动安装不会替你登录厂商账号。

### Loomy 微信扫码的额外配置

GitHub 告警中的 WeChat App ID 来自上游 Loomy 的微信二维码登录 URL，并非读取你的本机账号后上传。
本仓库已经移除这一固定值，未将它拆分或编码隐藏。Loomy 微信扫码登录需要本机显式配置。
在一体化数据目录保存 `loomy-wechat.json`，重启 Magpie：

```json
{ "appId": "YOUR_AUTHORIZED_LOOMY_WECHAT_APP_ID" }
```

也可在启动 Magpie 前设置 `OFM_LOOMY_WECHAT_APP_ID`。
该 ID 必须与 Loomy 现有回调服务匹配；随意创建一个微信应用 ID 不保证可用。
未配置时扫码会给出明确错误，其他渠道不受影响。此配置与真实 Loomy 微信登录尚未验收。
该文件不要放入源码或提交到 GitHub。旧提交的扫描告警需在 GitHub 安全页面单独审核处理；
最新代码移除固定值不会抹除 Git 历史。

### Gemini 的额外配置

GitHub 的仓库密钥检查拦截了上游渠道包中的固定 Google OAuth 客户端凭据。
本仓库已移除这两项内置默认值，使用原渠道已有的环境变量覆盖接口；不绕过仓库规则。
**Gemini 在本版不是开箱即用**：需要你自己的、被相应 Google 服务接受的 OAuth 客户端，
客户端配置和真实 Code Assist 访问资格尚未验收。其他渠道不需要这项 Google 配置。

将下列文件保存在一体化数据目录下，命名为 `gemini-oauth.json`，然后重启 Magpie：

```json
{ "clientId": "YOUR_GOOGLE_OAUTH_CLIENT_ID", "clientSecret": "YOUR_GOOGLE_OAUTH_CLIENT_SECRET" }
```

这个文件是本机私有配置，不要放入插件源码目录或提交到 GitHub。
也可在启动 Magpie 前设置 `CMDC_PAK_GOOGLE_CLIENT_ID` 和 `CMDC_PAK_GOOGLE_CLIENT_SECRET`。
更换 OAuth 客户端后需要重新登录 Gemini；旧客户端签发的 refresh token 通常不能跨客户端使用。

### EAC 自动接入

默认 `managed.autoInstallEac: true`。首次启动自动从原项目的 **raw.githubusercontent.com**
下载固定提交 `f8974369c5904858c696b520d8b9b82ad4425f78` 的 `src/vault.js`、两份数据依赖及 MIT 许可，
按代码中固定的 SHA-256 校验完整文件集合后，保存到本机数据目录的 `runtime/eac-<提交>/`。
原文件保持原样；类 Unix 系统目录权限为 0700、文件为 0600。每次启动复核缓存，之后可离线复用。
这些原始来源文件不放进本插件的公开仓库或发布包，解封结果不写入磁盘、日志或网页。
安装不需要 root、git、DSH 或手动填写路径，Linux/macOS/Windows 使用同一下载逻辑。

打开控制台 **EAC 协付渠道 → 使用 GitHub 登录**，在原项目授权页完成 GitHub 登录与 Star 校验。
授权成功后原服务自动刷新 EAC 清单；回 Magpie 刷新模型后即可选用。
**安装来源不等于已授权**；授权、Star 校验、请求签名、资源池与实际模型可用性均由原项目网关决定。
本插件沿用原项目独立服务的 `openSeal` 入口，不伪装 DSH 宿主，也不绕过服务端检查。
Tailscale 仅提供控制台入口，不影响原网关的浏览器授权流程。

服务器需能访问 raw.githubusercontent.com 及原 EAC 网关。下载有总计 20 秒的超时和大小限制，
来源安装失败会在 EAC 页面显示原因，匿名/Kilo 与账号渠道继续运行。
修复网络或数据目录权限后重启 Magpie 重试；不修改远端地址或跟随上游 main 自动执行新代码。
固定来源版本被网关撤销或不再兼容时，需要更新本插件或明确选用新版本来源。
可设 `managed.autoInstallEac: false` 关闭自动安装及自动来源使用。

已有完整原项目源码时，仍可显式指定本机目录，优先于自动安装：

```json
{ "managed": { "eacSourceDir": "/absolute/path/to/dsh-our-free-model" } }
```

该目录需要完整原项目的 `src/vault.js` 及数据依赖，只使用你信任的原项目版本。
插件会执行这份本机模块；目录需保持固定，配置后重启 Magpie，再完成原项目授权。
原项目地址是 [Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model)。
真实用户 GitHub 登录及授权后的 EAC 推理尚未实机验收。

### 配置、数据与停止

默认数据目录是 **Magpie 配置目录下的 `our-free-model/`**，与 DSH 和原独立服务默认目录隔离。
包括本地密钥、渠道账号、EAC 授权、统计和设置；卸载源码不会主动删除账号数据。
只有启用一体化供应商后才启动服务。完全退出 Magpie 时子服务会关闭；
关闭一个界面窗口可能只是退到托盘，并不等于退出宿主。
退出供应商登录会停止该账号在 Magpie 中的访问；Magpie 没有调用插件退出钩子，
已启动的本机服务会继续存在至宿主退出，仍可从控制台退出具体渠道账号。

插件选项示例（全部可省略，默认自动准备运行环境）：

```json
{
  "managed": { "autoInstallNode": true, "consoleAccess": "auto", "autoInstallTailscale": true, "dataDir": "/absolute/path/to/ofm-data", "port": 18900, "consolePort": 18901 }
}
```

Windows 的 `nodePath` 在 JSON 中例如 `C:\\Program Files\\nodejs\\node.exe`。
默认首次使用端口 18900，冲突时自动选用可用端口，并保存实际端口；`port: 0` 每次启动自动分配。
修改 `managed` 的运行设置后重启 Magpie。同一个数据目录只允许一个服务实例。
若上次被强制关闭，插件只会清理经 PID 检查确认已停止的本产品锁文件。

## 可选兼容入口（默认不加载）

旧的三个独立供应商保存在 `compatibility.mjs`，仅供需要直接连接 Zen/Kilo 或已有外部服务的高级用法。
它们不由正常插件入口加载。只有主动添加这个文件才会显示三个供应商：

```sh
magpie plugin add /absolute/path/magpie-our-free-model/compatibility.mjs
```

| 供应商 ID | 功能 | 登录 |
|---|---|---|
| `our-free-zen` | Zen 免费模型，原生 Chat / Responses / Anthropic | 免费访问标记 `public` |
| `our-free-kilo` | Kilo 免费池，支持推理档位 | 免费访问标记 `public` |
| `our-free-local` | 连接已有原项目独立服务 | 回环地址及该服务 API Key |

兼容入口选项 `zen`、`kilo`、`local` 可为配置对象或 `false`。
这里的 Zen 实际服务仍为 OpenCode Zen；厂商端点、协议标识与第三方来源不会因本插件改名而改变。
截图中的 `opencode-doubao-translate` 是另一个插件，不在本仓库中。

## 已实现

- 动态模型发现和失败时保留缓存；成功返回空列表时会清空旧模型。
- Zen 的三种原生协议，以及 Magpie 负责的 Agent 协议转换。
- SSE 流式输出与普通 JSON 输出；思考字段、工具调用和用量保留。
- 响应体前缀识别，兼容上游错误标注 Content-Type；已读取字节全部回放。
- Zen 的会话关联、客户端标识和工具声明兼容；未声明的工具调用被拒绝。
- Kilo 的 Low / Medium / High 推理参数转换；仅向允许关闭的模型提供 Disabled。
- 请求取消、上游 HTTP 状态与 Retry-After 透传。
- 隔离本地服务账号清单，向本地服务换用其自己的密钥。

免费模型列表不等于无限额度。插件没有厂商的剩余额度数据，`quota` 不会伪造百分比。
Kilo 免费池的提示词可能被上游记录；对话、工具定义与结果会发往对应模型服务。
插件不写入对话日志，不自动创建账号或绕过账号授权。

## 开发与验证

Node.js 22+，不需要额外依赖：

```sh
npm run check
npm test
```

可选的真实 Magpie 宿主测试（会创建隔离配置，使用本机 HTTP 替身）：

```sh
MAGPIE_BIN=/absolute/path/to/magpie node scripts/magpie-smoke.mjs
MAGPIE_BIN=/absolute/path/to/magpie node scripts/managed-magpie-smoke.mjs
```

首次运行时 Magpie 可能需要下载 Bun；可设置 `MAGPIE_TEST_CACHE` 指向一个专用测试缓存目录。

测试使用本机 HTTP 替身，覆盖三种 Zen 协议、Kilo、网关桥接、工具调用、缓存、
取消、推理参数与错误语义。它们不访问真实上游，也不证明所有免费模型当前可用。
真实 Magpie 宿主验证结果与环境见 `VALIDATION.md`。

一体化服务管理已在 Linux 验证；Windows/macOS 尚需各自平台验收。
测试不代表逐家真实账号或当前免费额度已验收。

## 来源、贡献与许可证

| 组成 | 来源与归属 |
|---|---|
| OFM 核心、独立服务、渠道集成和控制台 | **[Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model)**；原作者及贡献者；MIT，原许可保存在 `vendor/ofm/LICENSE` |
| 原项目吸收的渠道包 | [iJetLi/deepseek-harness-codearts](https://gitee.com/iJetLi/deepseek-harness-codearts)，提交 `345f0a07b22713c0ae189ca7d8b97ec4f64626c6`；原说明与 MIT 许可保留在 `vendor/ofm/vendor/channel-pack/` |
| 兼容 Zen 供应商和流式/工具处理 | [magpie-community/plugins 的 zen-free](https://github.com/magpie-community/plugins/tree/5189b287e7aedd413a3332ef3c5da247a48193a0/packages/zen-free)；MIT，见 `vendor/zen-free/LICENSE` |
| Magpie 自动运行、统一供应商、控制台安全交接和适配测试 | 本仓库的 Magpie 适配代码；MIT，见根目录 `LICENSE` |

第三方组件的原始许可也随包保留，详见 `NOTICE.md`。
欢迎支持并向原项目作者致谢；本仓库不把上游功能宣称为独立原创，也不代表其维护者。
