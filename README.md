# Our Free Model — Magpie 插件

版本 0.1.0。一个安装包提供三个供应商：

| 供应商 ID | 功能 | 需要什么 |
|---|---|---|
| `our-free-zen` | OpenCode Zen 免费模型，原生 Chat Completions / Responses / Anthropic Messages | 启用免费访问，填写 `public`；不需要个人 API Key |
| `our-free-kilo` | Kilo 免费池，动态筛选 `isFree: true`，支持推理档位 | 启用免费访问，填写 `public`；不会向 Kilo 发送这个标记 |
| `our-free-local` | 可选：连接原项目独立服务里的 EAC / 十三个账号渠道 | 原项目独立服务、本机地址及其 API Key |

Zen 和 Kilo 直接请求各自上游，不需要安装 DSH，也不需要启动独立服务。
本机桥接是可选功能；EAC 和账号渠道的登录、续期、签到仍由原项目独立服务处理，
这一版没有把它们的账号管理原生移植进 Magpie。

## 安装（图形界面）

1. 在本仓库点击 Code → Download ZIP 并解压，也可解压已提供的 `magpie-our-free-model-0.1.0.zip`。
2. 将解压后的项目文件夹放到固定位置；Magpie 会就地加载，之后不要删除或移动它。
3. 在 Magpie 的 Plugins / 插件 页面选择 Add a plugin / 添加插件，填写该文件夹的完整路径。
   选的是包含 `package.json` 和 `index.mjs` 的文件夹，不是 ZIP 文件。
4. 在 `our-free-zen` 和 `our-free-kilo` 的供应商行启用登录，密钥栏填写 `public`。
   这里是免费渠道的激活标记，不需要注册账号或申请个人密钥。
5. 刷新模型列表，给你的 Agent 选择对应供应商下的模型。

插件文件已经是可执行 ESM，无需 `npm install`、无需编译。
Magpie 本身会按自己的流程准备 Bun 插件运行时。

## 安装（终端）

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
```

首次运行时 Magpie 可能需要下载 Bun；可设置 `MAGPIE_TEST_CACHE` 指向一个专用测试缓存目录。

测试使用本机 HTTP 替身，覆盖三种 Zen 协议、Kilo、网关桥接、工具调用、缓存、
取消、推理参数与错误语义。它们不访问真实上游，也不证明所有免费模型当前可用。
真实 Magpie 宿主验证结果与环境见 `VALIDATION.md`。

上游来源、固定提交与 MIT 许可见 `NOTICE.md` 和 `vendor/zen-free/LICENSE`。
