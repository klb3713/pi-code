# Pi Code

> 一个 Claude Code 桌面版风格的 AI coding 应用：**nsh** 原生界面 + **pi** agent 运行时。

Pi Code 用 [pi](https://github.com/earendil-works/pi)（`@earendil-works/pi-coding-agent` 1.5.0）作为 AI coding agent 内核，用 [nsh](https://nsh.dev/zh-CN/docs/) 的 TSX 原生 UI 构建桌面界面。pi 以 `--mode rpc` 子进程运行完整的 agent loop（read / write / edit / bash / grep / find 工具、流式输出、会话持久化、上下文压缩），nsh 应用通过一个本地 Node bridge 与它通信。

![Pi Code 对话界面](docs/screenshots/chat.png)

## 功能（v1）

- **流式对话**：Markdown 渲染、代码块（复制按钮）、thinking 折叠、停止生成、错误提示。
- **工具调用可视化**：工具卡片显示 read/write/edit/bash 等调用的目标、运行状态、耗时、可展开输出，write/edit 带变更统计。
- **工作区文件树**：右侧 Files 面板浏览、展开目录、打开只读文件预览（行号 + 等宽字体）。
- **变更与 Diff**：Changes 面板汇总本次会话/git 变更，点击用 `DiffView` 查看 unified diff。
- **会话管理**：新建会话、最近会话列表、切换历史会话（读取 pi session 文件）。
- **模型与设置**：默认模型选择、thinking level、工作区路径、运行模式（auto / demo / real）、自定义 OpenAI 兼容网关；全部设置持久化到 `~/.pi-code/config.json`。
- **桌面体验**：自定义标题栏（macOS 红绿灯内嵌）、三栏布局、状态栏（模型 / token / 成本 / 分支）、⌘N / ⌘, / ⌘B 快捷键。
- **Demo 模式**：没有配置真实 provider 时自动启动本地 OpenAI-compatible Mock LLM——**pi 的 agent loop 与工具执行仍然是真实的**，只有模型回复由本地脚本生成，便于开箱即用与端到端测试。

| 欢迎页 | 设置 |
| --- | --- |
| ![欢迎页](docs/screenshots/welcome.png) | ![设置](docs/screenshots/settings.png) |

| 文件预览 | 变更 Diff |
| --- | --- |
| ![文件预览](docs/screenshots/file-preview.png) | ![变更 Diff](docs/screenshots/changes.png) |

## 快速开始

环境要求：macOS 14+（nsh 桌面）、Node.js **>= 22.19**（pi 1.5.0 的最低版本，推荐当前 LTS）、`nsh` CLI 0.4+（`nsh --version` 验证）。

```bash
# 1. 安装 bridge 依赖（pi 1.5.0）并生成本机路径配置
npm run setup

# 2. 启动桌面应用（nsh 热更新）
nsh run App.tsx
# 或 npm run dev

# 3. 运行测试
npm test          # nsh test
node server/test-bridge.mjs   # bridge 独立端到端测试
```

首次启动会连接本地 bridge：如果 pi 没有可用模型，会自动进入 **Demo 模式**，可以直接输入「创建一个 hello.ts 并打印 Hello」体验真实工具调用与文件变更。

### 在浏览器中运行（Web）

浏览器无法创建本机子进程。Web 版保留相同 UI，通过本机 WebSocket 服务连接 Node bridge / pi；不是无需后端的纯静态应用。

```bash
# 首次运行或更新依赖后
npm run setup

# 一个命令同时启动本机 bridge 与 Web UI，保持此终端运行
npm run dev:web
# 等同于 node scripts/dev-web.mjs
```

打开 `http://127.0.0.1:8790/`（或 `http://localhost:8790/`）。一键启动会先启动 bridge 再启动 nsh，按 **Ctrl+C** 同时停止两者；nsh 意外退出也会关闭 bridge。8787 或 8790 已被占用时会提示并退出，不会主动替换或杀掉已有服务。一键命令使用固定端口，不接受额外参数。

仍可分开运行：终端 1 执行 `npm run bridge:web`，终端 2 执行 `npm run dev:web:ui`（即 `nsh run App.tsx --target web`）。

bridge 固定只监听本机 `ws://127.0.0.1:8787/bridge`，不开放局域网；每个页面连接拥有独立 bridge / pi 进程，关闭页面后清理对应进程，其他页面不受影响。

- **工作区是 Node 所在机器的真实路径**，不是浏览器 OPFS 路径。Web 版会话数据默认保存在 `~/.pi-code`；不会把浏览器的 `/app-data` 发给 Node。桌面端仍使用原有 nsh 数据目录，两者默认不共享会话库。
- **真实模型的环境变量要设在执行 `npm run dev:web` 的同一个终端**；启动器及其 bridge 会继承它们。分开运行时则设置在 `bridge:web` 所在终端。浏览器不会读取本机 API Key。
- **Origin 检查**默认只允许上面两个页面来源。自定义 UI 端口时，例如 `nsh run App.tsx --target web --port 8791`，先在终端 1 设置 `PI_CODE_BRIDGE_ORIGINS=http://127.0.0.1:8791,http://localhost:8791` 再启动 bridge。此变量替换默认白名单；只加入你信任的本机页面，不支持通配符。
- 若修改 bridge 端口，需同时调整 web transport URL 与 `nsh.json` 的 network 授权；只改服务端端口不会自动通知前端。
- `WebSocket 连接失败`：检查启动终端是否报错、8787 是否被占用、页面来源是否在白名单中；分开运行时确认 `bridge:web` 已启动。Origin 被拒绝时服务端 stderr 会显示具体来源。启动服务后刷新浏览器即可重连。

验证命令：

```bash
npm run check
npm test              # 隔离配置目录后运行完整 nsh 测试
npm run test:config   # 配置校验 / 原子写入 / 首次迁移单测
npm run test:bridge   # 配置单测 + stdio / WS 的真实 pi / mock LLM 集成测试
npm run test:web      # 自动启动临时 WS 服务，再跑 nsh --target web
npm run test:macos    # 在真正的 macOS host 上验证桌面连接
npm run test:launcher # 一键启动、Ctrl+C 清理、端口冲突与 UI 退出回归
```

`npm test` 通过 `scripts/test.mjs` 以临时 `PI_CODE_CONFIG_DIR` 运行 `nsh test`，因此真实 bridge 测试（`tests/e2e.test.tsx`、`tests/platform-bootstrap.test.tsx`）不会读取或覆盖你本机的 `~/.pi-code/config.json`。`test:web` / `test:macos` 同样使用临时配置目录。若直接运行 `nsh test`，测试会检测到非 Demo 模式并在发送任何消息前失败，避免误用你的真实网关。

`test:web` 需要本机 Chrome / Edge / Chromium，并独占 8787；先停止 `dev:web` 或手动启动的 `bridge:web`。`test:launcher` 需要 8787 / 8790 都空闲。测试专用服务仅在运行期间允许随机端口的 loopback 页面来源，正常 `bridge:web` 的白名单不变。

### 使用自定义 OpenAI 兼容网关（推荐）

启动后打开「设置」（⌘,），在「自定义 OpenAI 兼容网关」中填写：

- **Base URL**：例如 `http://127.0.0.1:3425/v1`；留空则使用 pi 原生 provider。
- **API Key**：网关密钥；无需认证的本地网关可以留空。
- **运行模式**：选择「自动」或「真实」，然后保存。保存后立即重新连接，无需重启应用。

bridge 会请求 `${Base URL}/models` 并刷新「默认模型」下拉框。选择模型并再次保存，即可把它设为之后启动时使用的默认模型。状态栏显示 `LIVE`，模型 chip 显示当前网关模型。

所有设置（工作区、运行模式、默认模型、Thinking、网关地址与密钥）统一保存在 **`~/.pi-code/config.json`**，桌面与 Web 传输都由本机 bridge 读写同一份文件。API Key 只通过本机 bridge 使用，不会显示在日志中；请像对待其他本机凭据文件一样保护该配置。

首次启动仍会读取 `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` 作为初始网关配置，旧版 nsh Storage 中的工作区、模式、模型与 Thinking 也会迁移。配置文件一旦存在便以文件为准，之后在设置窗口修改即可，不再依赖启动环境变量。

如果网关不可用：`auto` 模式会回退 Demo；`real` 模式会在设置窗口显示明确错误，可修改后立即重试。

### 使用其他 pi provider

Pi Code 也复用 pi 的原生 provider 配置。可以设置 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY` 等环境变量，或在 `~/.pi/agent/auth.json` 中持久化（由 pi CLI 的 `/login` 生成）。启动后在设置里把运行模式切到「真实」；「自动」模式会优先使用可用模型，否则回退 Demo。

## 架构

```
┌────────────────────────────── nsh 原生窗口 ──────────────────────────────┐
│  App.tsx / app/**（TSX + signals + Tailwind 4）                          │
│  TitleBar · Sidebar · ChatView · Composer · RightPanel · Settings         │
│        │  store.ts（signals / actions / 事件归约）                        │
│        │  bridge-client.ts（JSONL over stdio）                            │
└────────┼─────────────────────────────────────────────────────────────────┘
         │ process.spawn("node", server/bridge.mjs)
┌────────▼──────────────────── server/bridge.mjs ──────────────────────────┐
│  init / prompt / abort / new_session / list_files / read_file /          │
│  git_status / get_diff ...（docs/SPEC.md §3 协议）                        │
│        │ spawn(process.execPath, pi --mode rpc --session-dir ...)        │
│        ▼                                                                 │
│  pi 1.5.0 agent loop（工具执行、会话、压缩、流式事件）                    │
│        │ OpenAI-compatible                                              │
│        ▼                                                                 │
│  真实 provider  ··· 或 ···  server/mock-llm.mjs（Demo 模式）              │
└──────────────────────────────────────────────────────────────────────────┘
```

- **UI 与运行时解耦**：nsh 应用只依赖 `app/protocol.ts` 定义的 JSONL 协议，不直接依赖 pi 的 API；bridge 可以独立测试（`server/test-bridge.mjs`）。
- **Demo 仍是真实 agent**：Demo 模式让 pi 指向本地 mock LLM，工具调用、文件写入、会话记录全部由 pi 真实执行。
- **Web 传输**：`app/bridge-web.ts` → `ws://127.0.0.1:8787/bridge` → `server/websocket-server.mjs` → 每连接独立的 `server/bridge.mjs`。桌面仍使用 stdio 子进程，协议保持一致。
- **安全边界**：nsh 的 `capabilities` 授权 `process.execute: ["node"]`、所需文件读写以及仅本机 8787 `/bridge` 的网络访问；WS 服务只绑定 loopback，校验浏览器 Origin。pi 子进程以当前用户权限运行（与 Claude Code / pi CLI 的本地 agent 模型一致）。本机非浏览器客户端可连接，Origin 不是对本机其他进程的身份认证。

更多细节见 [docs/SPEC.md](docs/SPEC.md)（协议、状态机、视觉规范、nsh 使用约定）。

## 目录结构

```
App.tsx                 入口：mount(App)
app/
  App.tsx               根组件（标题栏 / 三栏布局 / 快捷键）
  protocol.ts           bridge JSONL 协议类型
  store.ts              全局 signals、事件归约、actions
  bridge-client.ts      桌面 stdio 子进程客户端
  bridge-web.ts         浏览器 WebSocket transport
  components/
    shell/              TitleBar / Sidebar / StatusBar
    chat/               ChatView / MessageRow / ToolCard / Composer / Welcome
    panels/             RightPanel / FilesPanel / ChangesPanel / FilePreview / DiffPreview / SettingsDialog
  lib/format.ts         格式化工具
server/
  bridge.mjs            JSONL 请求分发 + 生命周期
  config.mjs            ~/.pi-code/config.json 读取、校验与原子写入
  pi-session.mjs        pi RPC 子进程封装与事件归一化
  mock-llm.mjs          OpenAI-compatible Demo 模型（SSE）
  workspace.mjs         文件树 / 读取 / git / diff
  websocket-server.mjs  loopback WS → 独立 bridge 子进程
  test-config.mjs       配置校验 / 原子写入 / 迁移单测
  test-bridge.mjs       stdio bridge 端到端自测（含运行时切换网关）
  test-websocket.mjs    WS 协议 / Origin / 生命周期自测
  test-targets.mjs      真正 web / macOS host 的启动验证
scripts/setup.mjs       安装 server 依赖、生成本机路径
tests/                  nsh 测试（fake transport + 真实 e2e）
theme.json              Claude 风格深色主题 tokens
nsh.json                nsh 应用配置、Tailwind 扩展、capabilities
```

## 开发路线图

**v1（已完成）**
1. 调研 nsh / pi 能力，确定「nsh UI + Node bridge + pi RPC + 本地 Demo 模型」架构。
2. 工程基础：主题、协议、store、bridge client、应用骨架。
3. Bridge：pi RPC 接入、Demo LLM、workspace/git/diff API。
4. 聊天界面：消息流、Markdown、工具卡片、Composer。
5. 侧边栏、文件树、变更/Diff、设置。
6. 集成、nsh 测试、真实 pi e2e、视觉验收。

**版本升级**

- pi 从 0.74.2 升级到 **1.5.0**（Node ≥ 22.19）：采用 `agent_settled` 作为一次 run 的真正结束（自动重试/压缩/排队不再让 UI 提前变空闲），工具耗时改用 pi 上报的 `durationMs`，停止时先清空排队消息再中止，并新增 bridge `get_state` 命令。

**后续可做**
- 工具权限确认（write/bash 审批）、计划模式、多文件 diff 审阅。
- 终端面板、@ 文件引用、图片/附件输入。
- 会话分支/恢复、成本面板、项目多开。
- `nsh package --target macos` 打包与签名、Windows/Linux 验证。

## 已知限制

- Desktop-first：当前主要验证 macOS；nsh 可跨平台，但 Windows/Linux 未验证。
- 文件预览最多渲染 400 行；大文件读取截断 64KB。
- 变更面板为平铺列表；diff 依赖 git（非 git 工作区对未跟踪文件显示全文）。
- Demo 模型是固定脚本回复，仅用于演示/测试，不代表真实模型能力。
