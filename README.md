# Our Free Model — Magpie 插件

[![Star History Chart](https://api.star-history.com/svg?repos=mu-zi-lee/magpie-our-free-model&type=Date)](https://star-history.com/#mu-zi-lee/magpie-our-free-model&Date)

> **原项目：[`Ebony-Vinyl/dsh-our-free-model`](https://github.com/Ebony-Vinyl/dsh-our-free-model)，作者 [Ebony-Vinyl](https://github.com/Ebony-Vinyl)。**
> 本仓库是它的第三方 **Magpie 适配版本**，不是原项目官方发布。
> 账号渠道、EAC 授权流程、本地服务与管理界面来自原项目；这些功能的主要实现归原作者及其上游贡献者。
> 本仓库新增 Magpie 供应商接口、自动服务管理、浏览器管理入口和兼容测试。

版本 **0.8.0**，包名 **`magpie-our-free-model`**。正常安装只显示 **Our Free Model** 一个供应商，统一提供匿名/Kilo、EAC 与账号渠道。
插件图标使用 `assets/icon.png` 的无损 WebP 副本（像素和尺寸相同，满足 Magpie 的 1 MB 限制），随包加载，无需联网获取图标。

[首次打开管理页面](#在-magpie-中打开管理页面) · [服务器访问](#服务器部署与浏览器控制台) · [页面打不开](#页面打不开时) · [更新](#更新已有版本) · [卸载清理](#卸载与自动清理)

## 安装与首次使用

不需要手动启动 Our Free Model，也不需要 `npm install` 或编译。插件会准备运行环境、启动服务，并把模型接入 Magpie。

```sh
git clone https://github.com/mu-zi-lee/magpie-our-free-model.git
magpie plugin add ./magpie-our-free-model
```

也可以在本仓库 **Code → Download ZIP** 下载并解压，然后在 Magpie 的 **插件（Plugins）** 页面添加解压后的项目目录、启用插件。安装目录需要保持固定。

### 在 Magpie 中打开管理页面

**当前界面使用远程入口的顺序：启用插件 → 选择远程连接 → 等首次弹窗结束 → 再点开 Our Free Model → 打开管理链接。**

1. 在 Magpie 的 **插件（Plugins）** 页面确认本插件已启用。
2. 打开 **供应商（Providers）** 页面，找到 **Our Free Model**，进入登录／连接入口。也可以从插件卡片的登录入口进入该供应商。
3. 选择适合安装位置的方式：

   | Magpie 安装在哪里 | 选择哪个入口 | 浏览器打开的地址 |
   |---|---|---|
   | 自己正在使用的电脑 | **启用模型 / 打开账号管理控制台** | `http://127.0.0.1:端口/open/…` |
   | 服务器、SSH 或远程容器 | **临时远程控制台（免登录）**，或 **启用模型 / 临时远程控制台（免登录）** | `https://随机名称.trycloudflare.com/open/…` |
   | 服务器，已自行建立 SSH 端口转发 | **本机控制台 / SSH 转发** | 经 SSH 转发的本机地址，见[转发步骤](#通过-ssh-转发访问) |

4. 首次使用需要下载 Node、原渠道包等缺少的组件；远程入口还会准备 Cloudflare 客户端并建立临时通道。等待完成，保持 Magpie 运行。
5. **如果首次选择远程连接后只是弹出登录提示，然后返回供应商页面，没有自动跳转：再次点开 Our Free Model，重新进入登录／连接入口，选择同一个远程方式。** 此时可打开管理链接。若界面提供 **再次打开（Open again）** 或复制链接按钮，也可直接使用；没有自动打开浏览器时，复制当前完整链接到自己电脑的浏览器。
6. 进入网页后，在控制台完成 EAC 授权或添加渠道账号。回到 Magpie 刷新供应商模型，再为 Agent 选择 `our-free-model` 下的模型。

**Magpie 显示供应商已连接，只表示插件已启用。** 匿名 Zen/Kilo 模型可直接刷新使用；EAC 还需要在网页完成 GitHub 授权与 Star 校验，账号渠道则要分别登录厂商账号。
“远程控制台免登录”指无需 Cloudflare 账号；渠道本身的登录要求仍由原项目和厂商决定。

### 以后如何重新打开

回到 Magpie 的 **供应商 → Our Free Model → 登录／连接入口**，再次选择本机或远程控制台方式。
该入口也用于重新打开管理页，无需卸载插件或退出已有渠道账号。界面的按钮文字可能随 Magpie 版本、语言和连接状态略有变化。

使用本次生成的完整 `/open/…` 链接，不要只打开域名首页，也不要反复打开旧链接。
链接十分钟内有效、只能使用一次；它换取浏览器管理会话，服务 API Key 不进入 URL。
远程通道最多保持 30 分钟，结束后重新从 Magpie 生成入口。

### 使用时保持 Magpie 运行

桌面 Magpie、`magpie web` 或 `magpie serve` 需要持续运行，内置服务随插件宿主运行。
终端的 `magpie plugin login our-free-model` 是短命命令，命令退出后服务也会关闭；
完成网页里的渠道登录，请优先使用正在运行的 Magpie 界面。
关闭窗口可能只是退到托盘；完全退出 Magpie 才会停止服务。

### 一体化版本覆盖范围

| 功能 | 实现与位置 |
|---|---|
| 匿名 Zen 与 Kilo 免费池 | 统一供应商发现模型和推理，沿用原项目路由 |
| 十三个账号渠道的实现 | CodeArts、CodeBuddy、WorkBuddy 国际版、LobsterAI、Qoder、Qoder 中国版、TRAE、Cline、Loomy、Raccoon、MiniMax Code、ZCode、Gemini；完整渠道包与默认登录配置直接来自原仓库 |
| 渠道登录、账号池、轮换和续期 | 原项目渠道后端与控制台；账号凭据只保存在本机 |
| 签到/领取积分、模型开关、积分锁定、账本与备份 | 原控制台与渠道实现；供应商停用及模型停用会阻止实际调用 |
| EAC 登录、Star 校验、资源池 | 自动安装原项目固定版本来源（也可指定本机目录），沿用原服务端授权；不修改服务端校验逻辑 |
| 模型上下文、图片、思考档位 | 根据真实运行目录映射到 Magpie，保留上游档位 ID |
| 用量、请求日志、服务设置 | 本机控制台；Magpie 也记录经过自身网关的请求用量 |
| Chat Completions / Responses | 内置服务支持两种；Magpie 插件使用 Chat 接口，Magpie 负责其他客户端协议转换 |
| 本机 API 转发 | 控制台 API 接入页复制地址和密钥；其他本机工具可调用 |
| 生命周期与密钥轮换 | 插件启动/停止服务；控制台轮换密钥后，插件下次请求自动读取新密钥 |

**覆盖范围：**管理界面在独立浏览器页面中打开；服务器部署使用临时 HTTPS 地址访问。Magpie 没有插件自定义页面接口，管理界面不能嵌入 Magpie 窗口。
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
若界面仍保留旧行，请重载插件或重启 Magpie。新版卸载会删除账号数据，更新时请保留安装条目。

### 卸载与自动清理

**需要支持 `package.json` 中 `magpie.uninstall` 回调的 Magpie。** 配套实现见 [Magpie PR #1](https://github.com/mu-zi-lee/magpie/pull/1)，对应分支 `codex/plugin-uninstall-cleanup`；
原有 Magpie 仅移除插件条目并跳过包脚本，单独更新插件不能让旧宿主自动清理。

使用支持回调的 Magpie，在插件页面点击卸载，或运行 `magpie plugin rm <安装路径或包名>`，会先停止该插件的服务与临时 Cloudflare 控制台，再删除：

- 本插件自动下载的 Node、cloudflared、原渠道包、EAC 来源及未完成的下载目录；旧版本下载的 Tailscale 也会清理。
- 设置、模型缓存、统计、渠道账号、EAC 登录、旧版 Gemini OAuth 和 Loomy 配置文件、临时文件。
- 本插件在 Magpie 中的统一供应商及旧兼容供应商登录记录。
- 0.6.0 起登记过的历史 `managed.dataDir`，即使后来改了路径或停用了插件。

首次使用会在 Magpie 配置目录保存清理登记，并在专用数据目录写入归属标记；卸载成功后这些登记也会删除。
升级前的旧版本没有历史目录登记，卸载时只能识别当前配置指向的旧 OFM 数据目录。
系统已有 Node/cloudflared/Tailscale、自行指定的外部 EAC 源码、其他供应商账号，以及自定义目录中的无关文件会保留。
路径安装的源码目录由用户管理，Magpie 保留该目录；包管理器安装的插件包由 Magpie 移除。
共享的 Magpie Bun 和缓存由 Magpie 管理，不属于本插件的下载。

清理失败会保留插件安装条目供重试，可能已经清理的文件不会恢复。
若另一个 Magpie 实例仍在使用同一数据目录，请关闭它后重试。
普通停用、退出、重启和升级保留账号与运行环境；只有卸载执行清理。

### 服务器部署与浏览器控制台

默认 `managed.consoleAccess: "auto"`：检测到 SSH 环境，或没有 DISPLAY/WAYLAND_DISPLAY 的 Linux 时，
供应商登录入口使用 **临时远程控制台（免登录）**。自动判断只是环境启发式；
判断不符合实际时可在登录方式中选择本机/远程入口，或显式设置 `"local"`、`"cloudflare"`。

按上面的[Magpie 操作步骤](#在-magpie-中打开管理页面)选择远程入口：先完成供应商启用，若首次没有跳转，再点开 **Our Free Model** 并重新选择同一入口。
无需 Cloudflare 账号、登录、域名或 Tailscale；客户端连接后会给出随机的
`https://随机名称.trycloudflare.com/open/…`，在自己电脑浏览器中打开。
临时域名可能需要一两分钟才能访问，实测首次约 80 秒；遇到 DNS 错误时先稍等再刷新。

插件优先使用已有 `cloudflared`。缺少可用客户端时，自动从
[Cloudflare 官方发行页](https://github.com/cloudflare/cloudflared/releases/tag/2026.10.0)
下载固定 **2026.10.0**，校验固定大小和 SHA-256，再缓存到插件数据目录 `runtime/`。
自动下载支持 **Linux/macOS x64、arm64 和 Windows x64**，macOS 解压需要 `tar`。
首次下载约 20–55 MB；不需要 root，不修改系统 PATH，不安装系统服务。

完成账号管理后点击页面顶部 **结束远程访问**。退出控制台登录、通道启动后满 **30 分钟**、
或宿主退出都会关闭本次入口；重新从 Magpie 打开可开启新通道。模型服务继续在服务器本机运行。

若服务器没有被自动识别，可在插件选项中强制使用远程入口：

```json
{
  "managed": {
    "consoleAccess": "cloudflare",
    "autoInstallCloudflared": true
  }
}
```

命令行可写入同样的插件选项（替换为自己的安装路径；已有其他选项时一并保留），保存后重启 Magpie：

```sh
magpie plugin options /absolute/path/to/magpie-our-free-model '{"managed":{"consoleAccess":"cloudflare"}}'
```

可用 `cloudflaredPath` 指定已有官方客户端（2024 或更新版本）。
`autoInstallCloudflared: false` 禁止自动下载，缺少客户端时直接显示原因。
旧配置 `consoleAccess: "tailscale"` 自动迁移为 Cloudflare，不再运行或下载 Tailscale；
旧 `tailscalePath`、`tailscaledPath` 和 `autoInstallTailscale` 配置不再生效。

管理服务仍只监听回环地址。Quick Tunnel 转发到插件独立的管理网关；网关校验 HTTPS Host/Origin、
一次性链接和 Secure/HttpOnly 会话，拒绝模型 API 和本机终端登录入口。
客户端使用独立临时配置，忽略已有具名隧道的 token/配置环境变量；关闭时结束本次进程并删除临时配置。
服务器需要能访问 GitHub 发行文件和 Cloudflare 隧道服务。
[Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) 用于临时访问，
不保证可用性，不支持 SSE；本插件只用它管理账号，模型流式请求仍走本机服务。

远程控制台会将 Loomy 原生微信扫码页和轮询/绑定接口转发到当前临时 HTTPS 地址，直接使用原渠道包的 App ID。
Gemini 保留原项目的 `http://localhost:<端口>/oauth-callback`，符合 Google 桌面应用回调规则。
Google 授权后，若你的电脑无法打开 localhost 页面，复制地址栏中的完整回调地址，回到远程控制台，
展开 **Gemini 服务器登录回调**，粘贴并回传。原渠道包继续处理 state 校验、令牌交换与账号保存；
不需要再为这个回调端口建立 SSH 转发。回传限于当前管理会话启动的登录，端口、路径和 state 必须匹配。
其他渠道的独立回调仍沿用上游流程；本版未逐家使用真实账号验证远程登录。
控制台 API 接入页显示的是服务器本机 API 地址，不会通过这个临时入口公开模型 API。

#### 通过 SSH 转发访问

如果不使用临时公网通道，可以保留 SSH 方式。在自己电脑上转发管理服务和一次性交接服务两个端口。
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

### 页面打不开时

| 现象 | 处理方法 |
|---|---|
| 选择远程连接后弹窗结束，没有打开网页 | 再点开 **Our Free Model**，重新选择同一远程入口；有链接时也可复制到浏览器打开 |
| 在自己电脑打开服务器给出的 `127.0.0.1` 链接失败 | `127.0.0.1` 指向浏览器所在的电脑。改选远程控制台，或先建立 SSH 端口转发 |
| `trycloudflare.com` 显示 DNS 错误 | 保持 Magpie 运行，等一两分钟再刷新；若持续失败，检查服务器到 Cloudflare 的出站网络 |
| 提示“管理链接已失效” | 链接已使用过或超过十分钟。回 Magpie 重新生成完整链接 |
| 打开临时域名首页提示需要一次性链接 | 使用 Magpie 给出的完整 `/open/…` 地址进入，不能只复制域名 |
| `127.0.0.1` 显示“拒绝连接”，或旧远程地址打不开 | 确认 Magpie 仍在运行，且临时通道未结束；重开入口。短命 CLI 测试退出后生成的链接无法继续使用 |
| 网页中已经添加账号，但 Magpie 没显示对应模型 | 回 Magpie 刷新模型，确认网页里渠道、账号及模型已启用 |

### 直接使用原仓库渠道包

默认 `managed.autoInstallChannels: true`。首次启动自动下载固定提交
`f8974369c5904858c696b520d8b9b82ad4425f78` 的完整 `business.mjs`、contracts、Qoder WASM 与许可文件，
来源固定为原仓库的 **raw.githubusercontent.com**。完整文件集合通过固定大小和 SHA-256 校验后才会加载，
保存在专用数据目录的 `runtime/channels-<提交>/`；原文件不做内容改写，类 Unix 系统目录/文件权限为 0700/0600。
每次启动复核缓存，缓存完整时可离线加载。首次下载失败会明确报错，请检查网络并重启；不会悄悄换用其他登录配置。

十三个渠道、Gemini 的默认 OAuth 客户端、Loomy 微信扫码配置及账号处理都直接使用这个原包。
本插件不再读取旧版新增的 `gemini-oauth.json`、`loomy-wechat.json`，也不再增加 Loomy App ID 环境变量覆盖。
旧文件不影响升级启动；现有账号按原项目保存，升级不会删除账号。
Google 原项目已有的环境变量接口仍属于上游行为，插件不额外设置它们。
厂商账号登录、服务资格和额度仍遵循原项目及厂商规则，不代表免登录或无限免费。

公开发布包中的渠道副本继续移除内置 OAuth/App ID 默认值；正常运行加载经过校验的原包。
`managed.autoInstallChannels: false` 是明确关闭原包加载的受限模式，用于离线隔离测试；
此模式不提供 Gemini 默认客户端及 Loomy 微信扫码能力，正常使用请保留默认值。
下载的原包也纳入插件卸载清理。上游代码固定在上述提交，后续更新须重新核对版本与哈希。

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
临时远程通道仅提供控制台入口，不影响原网关的浏览器授权流程。

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
包括本地密钥、渠道账号、EAC 授权、统计和设置。手动删除源码目录不会触发自动清理；通过 Magpie 卸载的行为见[卸载与自动清理](#卸载与自动清理)。
只有启用一体化供应商后才启动服务。完全退出 Magpie 时子服务会关闭；
关闭一个界面窗口可能只是退到托盘，并不等于退出宿主。
退出供应商登录会停止该账号在 Magpie 中的访问；Magpie 没有调用插件退出钩子，
已启动的本机服务会继续存在至宿主退出，仍可从控制台退出具体渠道账号。

下面是传给本插件的选项，和 OFM 网页里的服务设置分开。使用 `magpie plugin options <安装路径或包名> '<JSON>'` 保存，修改后重启 Magpie。
全部可省略，默认自动准备运行环境：

```json
{
  "managed": { "autoInstallNode": true, "consoleAccess": "auto", "autoInstallCloudflared": true, "dataDir": "/absolute/path/to/ofm-data", "port": 18900, "consolePort": 18901 }
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

## 兼容入口的协议能力

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

Node.js 22.19+ 或 24+，不需要额外依赖：

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
这些测试使用隔离配置，并拦截自动打开浏览器的操作，不会弹出测试登录页面。

测试使用本机 HTTP 替身，覆盖三种 Zen 协议、Kilo、网关桥接、工具调用、缓存、
取消、推理参数与错误语义。它们不访问真实上游，也不证明所有免费模型当前可用。
真实 Magpie 宿主验证结果与环境见 `VALIDATION.md`。

一体化服务管理已在 Linux 和 macOS 验证；Cloudflare 公网入口已在 macOS arm64 使用测试服务验证。
Windows 运行及 Linux/Windows 上的真实 Cloudflare 通道仍需对应平台验收。
测试不代表逐家真实账号或当前免费额度已验收。

## 来源、贡献与许可证

原项目运行代码固定于 [`f8974369c5904858c696b520d8b9b82ad4425f78`](https://github.com/Ebony-Vinyl/dsh-our-free-model/tree/f8974369c5904858c696b520d8b9b82ad4425f78)，
随包保存在 `vendor/ofm/`。57 个保留文件中 50 个保持原始字节；7 个有明确适配改动：
移除内置 Google OAuth 默认凭据和 Loomy 微信 App ID、将 EAC 凭据模块替换为空实现、增加 EAC 来源入口及安装诊断，以及原渠道包加载入口。
两个 EAC 加密凭据数据文件不随包分发。原始 SHA-256、改动摘要和省略清单见 `vendor/ofm/UPSTREAM.json`。
首次启用时从原项目下载固定版本的完整渠道包、EAC 来源模块与依赖，校验后缓存到私有数据目录；不执行远程安装脚本，不需要另外安装 DSH。

| 组成 | 来源与归属 |
|---|---|
| OFM 核心、独立服务、渠道集成和控制台 | **[Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model)**；原作者及贡献者；MIT，原许可保存在 `vendor/ofm/LICENSE` |
| 原项目吸收的渠道包 | [iJetLi/deepseek-harness-codearts](https://gitee.com/iJetLi/deepseek-harness-codearts)，提交 `345f0a07b22713c0ae189ca7d8b97ec4f64626c6`；原说明与 MIT 许可保留在 `vendor/ofm/vendor/channel-pack/` |
| 兼容 Zen 供应商和流式/工具处理 | [magpie-community/plugins 的 zen-free](https://github.com/magpie-community/plugins/tree/5189b287e7aedd413a3332ef3c5da247a48193a0/packages/zen-free)；MIT，见 `vendor/zen-free/LICENSE` |
| Magpie 自动运行、统一供应商、控制台安全交接和适配测试 | 本仓库的 Magpie 适配代码；MIT，见根目录 `LICENSE` |

第三方组件的原始许可也随包保留，详见 `NOTICE.md`。
欢迎支持并向原项目作者致谢；本仓库不把上游功能宣称为独立原创，也不代表其维护者。
