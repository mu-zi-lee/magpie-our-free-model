# Our Free Model — Magpie 插件

> **原项目：[`Ebony-Vinyl/dsh-our-free-model`](https://github.com/Ebony-Vinyl/dsh-our-free-model)，作者 [Ebony-Vinyl](https://github.com/Ebony-Vinyl)。**
> 本仓库是它的第三方 **Magpie 适配版本**，不是原项目官方发布。
> 账号渠道、EAC 授权流程、本地服务与管理界面来自原项目；这些功能的主要实现归原作者及其上游贡献者。
> 本仓库新增 Magpie 供应商接口、自动服务管理、浏览器管理入口和兼容测试。

版本 **0.2.0**。推荐只安装这一个插件，启用 **`our-free-model`** 统一供应商。
原项目运行代码固定于 [`f8974369c5904858c696b520d8b9b82ad4425f78`](https://github.com/Ebony-Vinyl/dsh-our-free-model/tree/f8974369c5904858c696b520d8b9b82ad4425f78)，
随包保存在 `vendor/ofm/`。57 个保留文件中 54 个保持原始字节；3 个有明确适配改动：
移除内置 Google OAuth 默认凭据、将 EAC 凭据模块替换为空实现、增加可选本机 EAC 来源入口。
两个 EAC 加密凭据数据文件不随包分发。原始 SHA-256、改动摘要和省略清单见 `vendor/ofm/UPSTREAM.json`。
运行时不下载原项目、不执行远程安装脚本、不需要另外安装 DSH。

## 一体化安装与使用（推荐）

1. 安装 **Node.js 22.19+ 或 24+**。Magpie 自带 Bun，但原渠道 Worker 需要 Node；插件会自动检查。
2. 从本仓库 Code → Download ZIP 解压，或执行下方 `git clone`。把项目目录放到固定位置。
3. 在 Magpie 插件页面添加该目录，启用插件。
4. 在 **Our Free Model · 一体化（全部渠道）** 供应商点击 **启用全部渠道 / 打开账号管理控制台**。
   插件自动启动随包携带的服务，并打开本机网页控制台；无需填写本地 API Key。
5. 匿名 Zen/Kilo 模型可直接刷新使用。EAC 先配置下方的本机原项目来源，再在控制台完成原项目的 GitHub 授权；
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

| 功能 | 0.2.0 的实现与位置 |
|---|---|
| 匿名 Zen 与 Kilo 免费池 | 统一供应商发现模型和推理，沿用原项目路由 |
| 十三个账号渠道的实现 | CodeArts、CodeBuddy、WorkBuddy 国际版、LobsterAI、Qoder、Qoder 中国版、TRAE、Cline、Loomy、Raccoon、MiniMax Code、ZCode、Gemini；**Gemini 需额外配置自有 OAuth 客户端** |
| 渠道登录、账号池、轮换和续期 | 原项目渠道后端与控制台；账号凭据只保存在本机 |
| 签到/领取积分、模型开关、积分锁定、账本与备份 | 原控制台与渠道实现；供应商停用及模型停用会阻止实际调用 |
| EAC 登录、Star 校验、资源池 | 可选本机原项目来源及原服务端授权；凭据材料不公开打包，不修改服务端校验逻辑 |
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

### EAC 的本机来源（可选）

公开仓库不会携带原项目的 EAC 加密凭据及解封材料。
如果你已合法获取原项目源码，可在插件选项中指定其本机目录：

```json
{ "managed": { "eacSourceDir": "/absolute/path/to/dsh-our-free-model" } }
```

该目录需要保留完整原项目的 `src/vault.js` 及其数据依赖。只加载你信任的、已获授权的原项目版本；
插件会执行这份本机模块来使用原有 EAC 来源，来源目录需保持固定。
配置后重启 Magpie，在控制台完成 GitHub 授权与原项目要求的 Star 校验。
无需运行原项目独立服务，也不需要 DSH。未配置时 EAC 不可用，其余渠道不受影响。
原项目地址仍是 [Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model)。
插件不会自动下载或公开上传这部分材料，也不会显示其明文凭据。

### 配置、数据与停止

默认数据目录是 **Magpie 配置目录下的 `our-free-model/`**，与 DSH 和原独立服务默认目录隔离。
包括本地密钥、渠道账号、EAC 授权、统计和设置；卸载源码不会主动删除账号数据。
只有启用一体化供应商后才启动服务。完全退出 Magpie 时子服务会关闭；
关闭一个界面窗口可能只是退到托盘，并不等于退出宿主。
退出供应商登录会停止该账号在 Magpie 中的访问；Magpie 没有调用插件退出钩子，
已启动的本机服务会继续存在至宿主退出，仍可从控制台退出具体渠道账号。

插件选项示例（`nodePath` 可省略；自动从 PATH 查找 Node）：

```json
{
  "managed": { "nodePath": "/absolute/path/to/node", "dataDir": "/absolute/path/to/ofm-data", "port": 18900 },
  "zen": false,
  "kilo": false,
  "local": false
}
```

Windows 的 `nodePath` 在 JSON 中例如 `C:\\Program Files\\nodejs\\node.exe`。
默认首次使用端口 18900，冲突时自动选用可用端口，并保存实际端口；`port: 0` 每次启动自动分配。
修改 `managed` 的运行设置后重启 Magpie。同一个数据目录只允许一个服务实例。
若上次被强制关闭，插件只会清理经 PID 检查确认已停止的本产品锁文件。

## 兼容供应商（已有 0.1.0 安装可继续使用）

下面三个供应商属于同一个安装包，用于不启动内置服务或连接已有外部服务；
它们不需要同时登录。新用户优先选择上面的 `our-free-model`。

| 供应商 ID | 功能 | 需要什么 |
|---|---|---|
| `our-free-zen` | OpenCode Zen 免费模型，原生 Chat Completions / Responses / Anthropic Messages | 启用免费访问，填写 `public`；不需要个人 API Key |
| `our-free-kilo` | Kilo 免费池，动态筛选 `isFree: true`，支持推理档位 | 启用免费访问，填写 `public`；不会向 Kilo 发送这个标记 |
| `our-free-local` | 可选：连接原项目独立服务里的 EAC / 十三个账号渠道 | 原项目独立服务、本机地址及其 API Key |

Zen 和 Kilo 直接请求各自上游，不需要安装 DSH，也不需要启动独立服务。
本机桥接是可选功能；EAC 和账号渠道的登录、续期、签到仍由原项目独立服务处理，
这三个兼容入口不管理账号；0.2.0 的账号管理由上面的一体化入口提供。

## 兼容入口安装（图形界面）

1. 在本仓库点击 Code → Download ZIP 并解压。
2. 将解压后的项目文件夹放到固定位置；Magpie 会就地加载，之后不要删除或移动它。
3. 在 Magpie 的 Plugins / 插件 页面选择 Add a plugin / 添加插件，填写该文件夹的完整路径。
   选的是包含 `package.json` 和 `index.mjs` 的文件夹，不是 ZIP 文件。
4. 在 `our-free-zen` 和 `our-free-kilo` 的供应商行启用登录，密钥栏填写 `public`。
   这里是免费渠道的激活标记，不需要注册账号或申请个人密钥。
5. 刷新模型列表，给你的 Agent 选择对应供应商下的模型。

插件文件已经是可执行 ESM，无需 `npm install`、无需编译。
Magpie 本身会按自己的流程准备 Bun 插件运行时。

## 兼容入口安装（终端）

从 GitHub 克隆后，运行：

```sh
git clone https://github.com/mu-zi-lee/magpie-our-free-model.git
magpie plugin add ./magpie-our-free-model
magpie plugin login our-free-zen
magpie plugin login our-free-kilo
magpie plugin --json
```

已经克隆过时不必再次执行 `git clone`。使用 ZIP 时，将 `plugin add` 的路径换成实际解压目录。

登录时填写 `public`。随后测试：

```sh
magpie provider test our-free-zen
magpie provider test our-free-kilo
```

测试会向真实上游发送小请求，受到网络、地区和上游限流影响。
模型 ID 来自实时清单，不能保证某个固定模型一直存在。

## 接入 EAC 和账号渠道（可选）

1. 获取原项目完整源码：https://github.com/Ebony-Vinyl/dsh-our-free-model
2. 按该项目要求安装 Node.js，在原项目根目录执行 `npm run start:standalone`。
   其独立安装制品尚未发布，不能只复制 `packages/standalone` 目录来运行。
3. 打开终端打印的独立控制台链接，在控制台完成 EAC 授权或需要的渠道登录。
4. 在控制台的 API 接入页面取得实际地址和 API Key。默认地址通常为
   `http://127.0.0.1:18900/v1`，端口占用时以控制台显示为准。
5. 运行 `magpie plugin login our-free-local`，按提示填写本机服务地址和该服务的 API Key。
6. 刷新模型列表；`our-free-local` 下会出现独立服务当前提供的模型。

独立服务需与 Magpie 在同一台电脑运行。此插件仅接受 localhost、127.0.0.1 或 ::1；
不读取原项目密钥文件，不自动启动服务，不内置 EAC 签名材料。
本机桥接的 `/models` 元数据有限，未知能力采用保守值；本版不为它宣称图片支持或推理档位。
图文或高级推理需求优先使用原生 Zen/Kilo，或在本机服务完成具体模型验证后扩展能力。

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

## 设置与升级

可关闭某一供应商：

```sh
magpie plugin options /absolute/path/magpie-our-free-model '{"local": false}'
```

把路径替换为实际安装路径。Windows PowerShell 的引号规则不同，可在 Magpie 设置界面编辑同一 JSON。
插件第二参数支持 `zen`、`kilo`、`local`：每项可为 `false` 或配置对象。
配置示例：

```json
{
  "zen": {},
  "kilo": {},
  "local": { "baseURL": "http://127.0.0.1:18901/v1" }
}
```

已有本机账号登录时保存的地址优先于 `local.baseURL`；地址变化后重新登录或重载。
以路径安装后，更换源码可通过插件开关重载。此包尚未发布到 npm，不能用它的包名从 npm 安装。

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
