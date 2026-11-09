# Pi Code 开发目标与任务拆解

## 目标

**一句话**：用 pi（AI coding agent 内核）+ nsh（跨平台原生 UI）做出一个 Claude Code 桌面版风格的 AI coding 应用，v1 可在 macOS 上真实运行：能对话、能调用工具读写工作区文件、能看文件树与 diff、能管理会话和模型。

### 成功标准（v1）

| 编号 | 标准 | 验证方式 |
|---|---|---|
| G1 | 应用可在 macOS 桌面启动，呈现 Claude Code 风格三栏布局 | `nsh run App.tsx` + 截图 |
| G2 | 输入任务后 pi 真实执行 agent loop 并流式显示回复 | 真实 bridge e2e：输入「创建 hello.ts」→ 文件出现、工具事件可见 |
| G3 | 文件树、文件预览、变更列表、DiffView 可用 | `nsh test --target macos` 截图与 UI 测试 |
| G4 | 会话（新建/历史/切换）、模型、thinking、工作区设置可用 | UI 测试 + bridge 测试 |
| G5 | 无 API Key 时可开箱演示（Demo 模型），有 Key 时可切换真实模型 | `auto` 模式探测 + 设置切换 |
| G6 | 类型检查、bridge 自测、nsh 测试全部通过 | `nsh check`、`node server/test-bridge.mjs`、`nsh test` |

## 阶段与任务

### Phase 0 · 技术调研（Lead）
- [x] nsh 0.4 能力盘点：TSX、signals、Tailwind 4、`nsh/base`（Tree/DiffView/TextView/Dialog/Select）、`process.spawn`、`fs/promises`、`net`。
- [x] pi 1.5.0 调研：`--mode rpc` JSONL 协议、事件类型、内置工具、custom provider / `PI_CODING_AGENT_DIR`、session 文件格式。
- [x] 关键验证：nsh headless test 中 `process.spawn` 双向 stdin/stdout 可用；pi + 本地 mock OpenAI 服务可完成 write 工具调用。
- [x] 架构决策：nsh UI ↔ Node bridge（JSONL）↔ pi RPC；Demo 模式让 pi 指向本地 mock LLM（agent loop 保持真实）。

### Phase 1 · 工程基础（Lead）
- [x] `nsh.json`：应用元数据、dark appearance、Claude 风格 theme、Tailwind 扩展、capabilities（process=node、fs=home/plugin/data）。
- [x] `theme.json`：暖橙 #d97757 + 深色中性色 tokens。
- [x] `app/protocol.ts`：请求/响应/事件/UiMessage/FileNode/DiffInfo 等完整类型。
- [x] `app/store.ts`：signals（messages/activeAssistant/tools/files/changedFiles/sessions/settings/usage/busy…）、事件归约、actions、测试注入 seam。
- [x] `app/bridge-client.ts`：spawn node、JSONL framing、请求超时、进程退出处理。
- [x] 应用骨架与通用组件：BrandMark/Glyph/IconButton/Spinner/Tag；标题栏/侧边栏/状态栏。

### Phase 2 · Bridge（bridge-engineer）
- [x] `server/bridge.mjs`：协议分发、init/reconnect 生命周期、auto/demo/real 模式探测、会话列表。
- [x] `server/pi-session.mjs`：pi RPC 子进程、事件归一化（剥离 cumulative 字段）、prompt/abort/new_session/switch_session/set_model/set_thinking。
- [x] `server/mock-llm.mjs`：OpenAI-compatible SSE Mock；意图识别 → write 工具 → 中文最终回复。
- [x] 自定义 OpenAI 兼容网关：`OPENAI_BASE_URL` + `OPENAI_API_KEY` → 自动发现模型 → 注册 `openai-gateway` provider（`OPENAI_MODEL` 可选默认模型）。
- [x] `server/workspace.mjs`：list_files（忽略目录）、read_file、git_status、get_diff（tracked/untracked）。
- [x] `scripts/setup.mjs`：npm install + 生成 `app/local-config.ts`。
- [x] `server/test-bridge.mjs`：11 项独立 Node 端到端测试，全部 PASS。

### Phase 3 · 聊天 UI（chat-ui）
- [x] `ChatView`：滚动消息区 + 自动滚底 + Welcome 空状态 + Composer。
- [x] `MessageRow`：用户气泡、助手 markdown（TextView streaming）、系统消息。
- [x] `ToolCard`：工具图标/目标/状态/耗时/可展开输出/write 预览/变更统计。
- [x] `Composer`：multiline Input、模型/thinking chip、发送/停止、快捷键提示。
- [x] `Welcome`：品牌 + 三个建议任务。
- [x] `ThinkingBlock`：thinking 折叠。

### Phase 4 · 右侧面板（panels-ui）
- [x] `RightPanel`：文件/变更 Tabs、刷新/关闭、预览切换。
- [x] `FilesPanel`：Tree 文件树 + 类型徽标 + 目录展开。
- [x] `ChangesPanel`：变更列表 + 状态字母 + +/− 统计。
- [x] `FilePreview`：只读、行号、400 行截断。
- [x] `DiffPreview`：DiffView patch 优先、统计、空态。
- [x] `SettingsDialog`：工作区/模式/模型/thinking/保存。

### Phase 5 · 集成与 QA（Lead + qa-engineer）
- [x] App 根组件：自定义标题栏、三栏布局、快捷键（⌘N / ⌘, / ⌘B）、窗口标题同步。
- [x] 全局 Toast、错误态、启动 loading。
- [x] 真实 bridge + pi + Mock 模型端到端跑通（创建 hello.ts、工具卡、Diff）。
- [x] `nsh check`、`nsh build App.tsx`。
- [x] `nsh test` 全量：19/19 PASS（headless 与 `--target macos`）。

### Phase 6.1 · 依赖升级（pi 1.5.0）
- [x] pi 0.74.2 → 1.5.0；Node 22.17 → 26.13（LTS）。
- [x] 运行生命周期改用 `agent_settled`（含 2s 兜底），一次 run 只发一次 `agent_end`。
- [x] 工具耗时采用 pi 上报的 `durationMs`。
- [x] 停止时先 `clear_queue` 再 `abort`（对齐 pi 的 Esc 行为）。
- [x] 新增 bridge `get_state` 命令。
- [x] 修复嵌套工作区（git 子目录）下 `git_status` 路径为仓库根相对的问题。
- [x] Bridge 自测 13/13、`nsh test` 19/19（headless 与 `--target macos`）、网关实测通过。

### Phase 6.2 · 外观主题（深色 / 浅色 / 跟随系统）
- [x] 深色 / 浅色 / 跟随系统主题切换：`AppConfig.theme` 持久化，设置窗口新增「外观」选择器。
- [x] `theme.json` 补齐 Claude Code 风格浅色调色板（象牙白 #faf9f5、石板墨 #141413、暖灰边框 #e8e6dc、clay #c6613f）。
- [x] 移除 `nsh.json` 中写死的深色 surface / code / success / warning / info，统一使用 theme.json 自适应 tokens。

### Phase 6 · 交付
- [x] README（功能、架构、启动、路线图、限制）。
- [x] `docs/SPEC.md`（协议与视觉规范）。
- [x] 应用图标 `assets/icon.png`。
- [x] 截图 `docs/screenshots/`。
- [x] 最终演示与验收记录（截图 + 测试输出，见 README / docs/screenshots）。

## 后续迭代（v1.1+）

1. **权限与审批**：write/bash 前弹确认，允许「本会话允许」。
2. **计划模式 / 子 agent**：参考 pi 扩展机制实现 plan mode。
3. **多文件 diff 审阅**：hunk 级 accept/reject（DiffView 已支持 `renderHunkActions`）。
4. **终端面板**：直接复用 pi bash 工具输出或独立 PTY。
5. **@ 文件引用与附件**：Input 的 `onCaretMove` + `Picker`。
6. **打包分发**：`nsh package --target macos`、签名、自动更新。
7. **跨平台验证**：Windows/Linux（nsh 原生支持，需逐一验证 process/fs/capabilities）。
