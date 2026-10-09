# Our Free Model 独立本地服务

这是独立产品的源码入口，不需要 DSH、Cordis、DSH profile 或宿主凭据库。
已提供独立 HTTP 服务、网页管理、EAC 和原有十三个账号渠道；独立安装制品尚未发布。
本阶段从完整仓库运行，暂不能仅复制本目录或将它单独作为 npm 包安装。

## 启动

需要符合仓库 `engines` 要求的 Node.js。在仓库根目录执行：

```powershell
npm run start:standalone
```

也可以指定端口和数据目录：

```powershell
npm run start:standalone -- --port 18900 --data-dir F:\ofm-data
```

启动打印管理页面的一次性登录链接、实际 API 地址与密钥文件位置，不打印 API Key。
在浏览器打开管理链接即可使用控制台，链接 10 分钟内有效且仅能兑换一次。
默认端口是 `18900`；
端口被占用时沿用共享监听器的自动选端口逻辑。后续启动优先使用本产品上次保存的端口；
`--port` 可以覆盖，`0` 表示由系统分配。

## 数据与鉴权

- 默认目录：`~/.our-free-model`；环境变量 `OFM_HOME` 或 `--data-dir` 可以覆盖。
- 不读取 `DSH_HOME`，不导入 DSH 的配置或凭据。
- 账号凭据保存在 `channel-credentials.json`，账号池、积分与账本位于 `channel-pack/`；
  EAC 授权保存在 `eac-user.json`，均属于当前独立数据目录。
- 首次启动不会自动搬迁插件账号。需要迁移时，在插件中导出账号备份，再在独立网页的
  “免费账号渠道 → 供应商与备份”手动导入。备份包含明文凭据，请妥善保存。
- API Key 为此产品单独生成，保存在该目录的 `settings.json` 的 `forwardKey` 字段。
- `GET /health` 提供不含凭据的产品状态；推理接口与模型清单需要 `Authorization: Bearer <API Key>`。
- 同一个数据目录只能启动一个本地服务实例。正常退出会清除 `service.lock`。
- 异常退出后若锁仍存在，先检查锁文件记录的 PID，确认旧进程已停止，再移除该锁文件。
- 只监听回环地址，不提供局域网访问。

插件仍使用 `DSH_HOME/our-free-model` 或 `~/.dsh/our-free-model`，两者默认互不影响。
不要主动把独立服务的 `OFM_HOME` 指向插件的数据目录。

## 当前接口与渠道

- `GET /v1/models`
- `POST /v1/chat/completions`，包括流式与非流式请求
- `POST /v1/responses`，包括流式与非流式请求
- 匿名免费模型与 Kilo 免费模型
- EAC 原 GitHub 授权、签名请求和资源池；独立应用使用自己的授权文件
- CodeArts、CodeBuddy（页面显示 WorkBuddy 国内版）、WorkBuddy 国际版、LobsterAI、
  Qoder、Qoder 中国版、TRAE、Cline、Loomy、Raccoon、MiniMax Code、ZCode、Gemini
- 原渠道登录、账号池和轮换、续期、模型开关、每日签到、积分锁定、账本及备份
- 本地模型缓存、用量统计、周期刷新、请求取消与退出清理
- `GET /`：独立中文网页控制台
- `/api/management/*`：同源管理接口，使用管理会话或 API Key 鉴权

启动先绑定监听器，再异步刷新模型清单。首次运行默认不发可用性探测请求；
`--probe` 可启用并保存自动探测设置，以后启动沿用，可在网页设置中关闭。
上游不可达时保留缓存；`--no-refresh` 跳过核心的启动刷新与周期任务，
手动刷新、探测和推理仍可用。账号渠道初始化目录、登录轮询、续期和自动签到沿用渠道自身规则；
`--no-refresh` 不会关闭这些任务，自动签到可在渠道页面关闭。
自动探测遇到限流遵守核心退避；页面主动探测会强制重新检查，并产生推理请求。

独立账号渠道采用每实例 Worker 隔离，通过同一个服务端口和 API Key 提供
`provider/model` 模型 ID。启动先挂载 HTTP，账号清单在后台加载，不等待所有供应商网络响应。
EAC 在独立页面自行授权；不会使用 DSH 的 EAC token。原插件的宿主判定保持原样。
插件热重载、自更新和宿主 Agent 自动续跑不挂载在独立入口。

## 网页管理

独立端已更新概览、渠道管理、模型清单、用量统计、服务设置和公共导航；
API 接入和登录继续保留已有控制逻辑。资源全部由本机服务提供，
渠道、模型、用量统计和服务设置按需加载，不依赖 CDN。视觉与体积记录见
[`第一阶段验收`](../../docs/verification/2026-10-09-standalone-ui-phase1.md)、
[`模型清单验收`](../../docs/verification/2026-10-09-standalone-model-browser.md)和
[`用量统计验收`](../../docs/verification/2026-10-09-standalone-usage-dashboard.md)和
[`服务设置验收`](../../docs/verification/2026-10-09-standalone-settings-page.md)。

修改前端后，在仓库根目录执行：

```powershell
npm ci --prefix packages/standalone --ignore-scripts
npm run typecheck:standalone
npm run build:standalone-ui
node scripts/build-standalone-ui.mjs --check
```

`frontend/` 是源码，`web/` 是提交的构建输出。服务启动时载入这些资源；
重新构建后需要重启服务。开发工具只用于构建，不作为网页资源公开。

模型页使用 TanStack Virtual 按可视区域挂载条目，支持动态行高和长 ID 换行。
聚焦滚动区域后可按 Home/End 到达首尾；复制或测试按钮获得焦点时保留所在条目。
搜索和筛选只改变当前视图，刷新及切页后保留，退出管理后清空。
单模型测试可取消；切页或退出时中断测试请求。刷新和探测属于服务端共享任务，
离开页面会取消前端等待，不承诺停止服务端整个刷新任务。

- **概览**：推理状态、接入地址、模型数量、最近 7 天 Token 用量和本机服务信息。
- **模型清单**：名称/ID 搜索、渠道/能力/状态/公开范围组合筛选、复制模型 ID、
  刷新清单、主动探测，以及可取消的单模型测试和结果展示。
- **用量统计**：累计用户回合、物理请求、输入/输出 Token、失败与恢复回合，
  最近 7/14/30 个本地自然日趋势（默认 14 天），以及按模型搜索、排序和每页 20 条统计。
  历史估算有明确说明，未知性能显示“—”；读取和刷新统计不发送推理请求。
- **免费账号渠道**：十三张原渠道卡片、登录与账号管理；渠道用量、请求日志、
  供应商启停、永久积分锁定、昵称、账号优先级、限流重置与备份导入导出。
- **EAC 协付渠道**：GitHub 授权、状态、取消、退出和资源池。授权页面由用户打开并完成。
- **服务设置**：暂停或恢复推理、地区模型、断流恢复、输出上限、刷新间隔和自动探测。
- **API 接入**：复制地址、主动查看或隐藏密钥、复制调用示例、确认后轮换密钥。

登录链接的临时凭证位于 URL fragment，页面兑换后移除。浏览器使用 8 小时有效的
HttpOnly、SameSite=Strict 管理 Cookie；重启服务或退出管理会清除会话。
链接已使用或过期时，可用 `settings.json` 中的 `forwardKey` 登录。
登录页提供本机获取令牌入口：Windows 打开 PowerShell，macOS 打开系统 Terminal，
读取当前服务实际数据目录中的密钥并复制到剪贴板，再回页面粘贴登录。
该操作只接受本机页面的同源请求，只执行固定动作，不接受网页提供的命令或路径，
也不会把密钥返回给未登录的网页。每次成功打开后 30 秒内不能重复打开。
打开失败时，可展开「手动获取与其他系统」，复制当前系统默认目录的取令牌命令，
或直接从配置文件读取 `forwardKey`；自定义目录以启动参数为准。
macOS 首次打开可能需要允许本地服务控制 Terminal。Linux 使用手动说明
或服务启动时打印的一次性登录链接；Windows 和 macOS 也保留这些备用入口。
轮换密钥会立即使旧密钥及其他管理会话失效，当前管理会话保留，客户端需更新配置。
推理接口仍要求 Bearer API Key，管理 Cookie 不能用于推理。暂停推理后管理页面仍可访问。

页面每 15 秒更新状态，读取状态不发送推理请求。主动探测和模型测试会消耗上游额度；
模型测试限制 64 个输出 Token、60 秒超时，真实用量计入统计。
统计保存用量与性能，不保存提示词和回答；推理内容仍发送至模型上游，
Kilo 免费池的提示词可能被上游记录，请勿发送敏感内容。

服务设置有未保存提示、数字范围校验和撤销修改。后台轮询及切页不会覆盖编辑草稿，
退出管理后草稿清空；撤销恢复最近同步的已保存值。保存期间禁止重复提交，
失败时保留输入，保存成功以服务端返回值为准。自动探测开关仍控制原有周期任务；
以 `--no-refresh` 启动时，保存设置不会恢复自动任务。

## 验证

```powershell
npm run test:standalone
npm run test:management
npm run test:standalone-channels
npm run test:contributor
```

独立服务专项测试只使用本机 HTTP 替身，不访问真实上游。测试覆盖独立数据与密钥、
两个 API 协议、流式响应、缓存、并发刷新、退出清理及进程级 DSH 依赖隔离。
管理专项测试覆盖会话、同源防护、设置校验与持久化、暂停后恢复、模型操作、
密钥轮换、重启与自动刷新调度；浏览器验收使用独立数据目录和本机上游替身。
渠道专项运行真实适配器与原授权逻辑，网络重定向至本机替身，覆盖多实例隔离、
工具和图片、Chat/Responses、积分锁定、备份、用量、取消与退出。未逐家验收外部真实账号登录。

加载本机替身的验收进程会在管理摘要中标记 `networkMode: fixture`，网页显示醒目的测试提示。
替身进程不能用于真实账号登录；实际使用应按上方命令启动独立服务，
并使用正式的独立数据目录，避免将测试账号和模拟额度误当成真实数据。

## 重新生成渠道产物

运行服务无需安装 React 或 esbuild，仓库包含已生成的本地脚本和样式。修改生成器或共享页面后执行：

```powershell
npm ci --prefix packages/standalone --ignore-scripts
npm run build:standalone-channels
npm run build:standalone-ui
node scripts/build-standalone-channels.mjs --check
node scripts/build-standalone-ui.mjs --check
```

生成器只替换平台承载及页面连接方式，不修改原插件的 `client.js` 与渠道包。
原渠道的 WASM 和共享核心仍来自完整仓库；单独复制本目录不能运行。
