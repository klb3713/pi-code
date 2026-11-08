# Pi Code · 工程规格（v1）

Pi Code 是一个 Claude Code 桌面版风格的 AI coding 应用：
- **UI**：nsh 0.4 TSX（原生桌面视图，macOS 优先，全部用 `nsh` / `nsh/base` 组件与 Tailwind 4 类）。
- **Agent**：pi（`@earendil-works/pi-coding-agent`，固定 0.74.2），以 `pi --mode rpc` 子进程运行完整 agent loop（read/write/edit/bash 工具、会话、流式输出）。
- **桥接**：Node 进程 `server/bridge.mjs`，由 nsh 应用通过 `process.spawn("node", [...])` 启动，stdin/stdout 走 JSONL 协议。
- **Demo 模型**：没有配置真实 provider 时，bridge 启动本地 OpenAI-compatible mock LLM（`server/mock-llm.mjs`），pi 仍然跑真实 agent loop 与工具调用，仅模型回复来自本地脚本。UI 明确标注「Demo 模型」。

当前目录即工程根目录。`nsh.json`、`theme.json` 已就绪。

---

## 1. 产品范围（v1）

必须包含：
1. **聊天**：消息流（用户/助手/系统）、流式 Markdown、停止生成、错误提示。
2. **工具调用**：`read` / `write` / `edit` / `bash` / `ls` / `grep` / `find` 的工具卡片；状态（运行中/完成/失败）、耗时、可展开输出；write/edit 显示 diff 摘要。
3. **工作区文件树**：右侧面板 Files 标签页，目录展开、文件点击预览（只读、行号、等宽字体）。
4. **变更面板**：Changes 标签页，列出本次会话改动 / git 变更，+/− 行数，点击查看 DiffView。
5. **会话**：新会话、最近会话列表（读取 pi session 文件）、切换会话。
6. **模型**：模型选择器（来自 pi `get_available_models`；Demo 模式为 `pi-demo-1`）、thinking level。
7. **设置**：工作区路径、运行模式（auto/demo/real）、模型、thinking level；应用后可重连。
8. **桌面外观**：自定义标题栏（`Window.setTitleBar({style:"hidden", height:44})`）、左侧栏、主聊天区、右侧面板、底部状态栏；Claude Code 风格深色主题（暖橙 #d97757）。

非目标（v1 不做）：多点编辑审批、附件上传、终端面板、多窗口、移动端适配、插件市场。

---

## 2. 目录结构与写作用域

```
App.tsx                         入口（Lead）
app/
  protocol.ts                   前后端共享协议类型（Lead）
  store.ts                      应用状态与事件归约（Lead）
  bridge-client.ts              nsh 侧 Bridge 客户端（Lead）
  local-config.ts               由 scripts/setup.mjs 生成（不入库）
  lib/
    format.ts                   格式化工具（Lead）
    tree.ts                     文件树工具（Lead/panels）
  components/
    common/                     Icon/Glyph/IconButton/Spinner/Tag 等（Lead）
    shell/                      TitleBar/Sidebar/StatusBar（Lead）
    chat/                       ChatView/MessageRow/ToolCard/Composer/Welcome（chat-ui）
    panels/                     FilesPanel/ChangesPanel/FilePreview/SettingsDialog（panels-ui）
server/                         bridge、pi 集成、mock LLM、workspace API（bridge-engineer）
scripts/                        setup.mjs 等（bridge-engineer）
tests/                          nsh 测试（qa）
docs/                           SPEC/README（Lead）
```

**写作用域规则**：每人只改自己 scope 下的文件；需要改共享文件（App.tsx、nsh.json、theme.json、app/protocol.ts、app/store.ts）先告知 Lead；Lead 负责最终集成。

---

## 3. Bridge JSONL 协议 v1

stdout/stdin 均为「一行一个 JSON」。stdout 只放协议消息，日志走 stderr。

### 3.1 应用 → bridge（请求）

```ts
type BridgeRequest =
  | { id: string; type: "init"; workspace: string; mode: "auto" | "demo" | "real"; dataDir?: string }
  | { id: string; type: "reconnect"; workspace: string; mode: "auto" | "demo" | "real"; dataDir?: string }
  | { id: string; type: "prompt"; message: string }
  | { id: string; type: "abort" }
  | { id: string; type: "new_session" }
  | { id: string; type: "switch_session"; sessionPath: string }
  | { id: string; type: "list_sessions"; limit?: number }
  | { id: string; type: "set_model"; provider: string; modelId: string }
  | { id: string; type: "set_thinking"; level: ThinkingLevel }
  | { id: string; type: "list_files"; maxDepth?: number }
  | { id: string; type: "read_file"; path: string }
  | { id: string; type: "git_status" }
  | { id: string; type: "get_diff"; path: string }
  | { id: string; type: "shutdown" };

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
```

### 3.2 bridge → 应用（响应）

```ts
type BridgeResponse = {
  id: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
};
```

### 3.3 bridge → 应用（事件）

```ts
type BridgeEvent =
  | { type: "ready"; data: ReadyInfo }
  | { type: "status"; status: "starting" | "ready" | "error" | "exited"; message?: string }
  | { type: "agent_start" }
  | { type: "message_start"; message: UiMessage }
  | { type: "assistant_delta"; contentIndex: number; kind: "text" | "thinking"; delta: string }
  | { type: "assistant_toolcall"; contentIndex: number; toolCall: ToolCallInfo }
  | { type: "message_end"; message: UiMessage }
  | { type: "history"; messages: UiMessage[] }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool_update"; toolCallId: string; text: string }
  | { type: "tool_end"; toolCallId: string; toolName: string; resultText: string; isError: boolean; durationMs?: number }
  | { type: "usage"; usage: UsageInfo }
  | { type: "turn_end" }
  | { type: "agent_end"; aborted?: boolean }
  | { type: "queue"; steering: string[]; followUp: string[] }
  | { type: "compaction"; phase: "start" | "end"; reason?: string }
  | { type: "session"; sessionId?: string; sessionPath?: string; sessionName?: string }
  | { type: "error"; message: string };

interface ReadyInfo {
  workspace: string;
  mode: "demo" | "real";
  demo: boolean;
  piVersion: string;
  models: ModelInfo[];
  currentModel?: ModelInfo;
  thinkingLevel: ThinkingLevel;
  sessionId?: string;
  sessionPath?: string;
  git?: { branch?: string };
}

interface ModelInfo {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

interface ToolCallInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

type UiContent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | ({ type: "toolCall" } & ToolCallInfo);

interface UiMessage {
  role: "user" | "assistant" | "toolResult" | "custom";
  content: UiContent[];
  timestamp?: number;
  usage?: UsageInfo;
  stopReason?: string;
  errorMessage?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

interface UsageInfo {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

interface SessionInfo {
  id: string;
  path: string;
  name?: string;
  preview?: string;
  updatedAt: number;
  messageCount?: number;
}

interface FileNode {
  id: string;      // 相对工作区路径
  name: string;
  kind: "dir" | "file";
  children?: FileNode[];
  size?: number;
}

interface GitStatusInfo {
  branch?: string;
  changes: { path: string; status: string }[];
}

interface DiffInfo {
  path: string;
  patch?: string;       // unified diff（优先）
  oldText?: string;
  newText?: string;
  language?: string;
  isBinary?: boolean;
}

interface ReadFileInfo {
  path: string;
  content: string;
  language: string;
  size: number;
  truncated?: boolean;
}
```

### 3.4 各命令响应 data

| command | data |
|---|---|
| `init` / `reconnect` | `ReadyInfo` |
| `prompt` | `{ accepted: true }`（事件继续流） |
| `abort` / `new_session` / `switch_session` | `{}` |
| `list_sessions` | `{ sessions: SessionInfo[] }` |
| `set_model` | `{ model: ModelInfo; thinkingLevel: ThinkingLevel }` |
| `set_thinking` | `{ level: ThinkingLevel }` |
| `list_files` | `{ files: FileNode[] }` |
| `read_file` | `ReadFileInfo` |
| `git_status` | `GitStatusInfo` |
| `get_diff` | `DiffInfo` |
| `shutdown` | `{}` |

### 3.5 事件归约约定

- `message_start`（user）→ 立即显示用户消息。
- 助手消息：`message_start`（assistant）开始流；`assistant_delta` 追加文本/思考；`assistant_toolcall` 添加工具调用块；`message_end` 完成。
- `tool_start` → 工具卡片变 running；`tool_update` 追加输出；`tool_end` → done/error + duration。
- `agent_end` → 整个 run 结束（busy=false）。
- 所有事件必须可安全丢给 UI 多次；未知事件忽略。

---

## 4. 应用状态与渲染约定

`app/store.ts` 暴露：
- `state`：只读 signals（`phase`, `connection`, `workspace`, `mode`, `models`, `model`, `thinking`, `messages`, `activeAssistant`, `tools`, `busy`, `usage`, `files`, `git`, `changedFiles`, `activeFile`, `activeDiff`, `rightPanel`, `settingsOpen`, `sidebarOpen`, `sessions`, `toast`）
- `actions`：`init()`, `send(text)`, `stop()`, `newSession()`, `applySettings()`, `refreshFiles()`, `refreshGit()`, `openFile(path)`, `openDiff(path)`, `switchSession(path)`, `setModel()`, `setThinking()` 等。

组件不直接 spawn 进程，统一用 store/actions。

---

## 5. 视觉规范（Claude Code 桌面风）

- 背景 `bg-background`，侧栏 `bg-sidebar`，卡片 `bg-card`，边框 `border-border`。
- 强调色 `text-primary` / `bg-primary`（暖橙 #d97757）；主按钮用 primary。
- 次要文本 `text-muted-foreground`；成功 `text-success`；错误 `text-destructive`；警告 `text-warning`。
- 圆角：卡片 `rounded-(--radius)`，面板 `rounded-(--radius-card)`。
- 字体：正文 `text-[13px]`，次要 `text-[11px]`，代码 `font-mono`。
- 布局尺寸：自定义标题栏 44pt；左侧栏 260pt；右侧面板 320pt；底部状态栏 28pt。
- 标题栏左侧留 `titleBar().left`（macOS 红绿灯），整条可拖拽 `desktop={{ windowDrag: true }}`。
- 空状态：Logo/星形glyph + 「今天想构建什么？」+ 快捷建议卡片。
- 动效克制：`transition-colors`、`animate-spin`（加载圈）、`animate-pulse`（流式光标）。

常用 glyph（Text 渲染，避免引入图标库）：
`＋`（新建）、`⚙`（设置）、`▤`（文件）、`±`（变更）、`↑`（发送）、`■`（停止）、`▸/▾`（折叠）、`⎇`（分支）、`✓`（完成）、`✕`（失败）、`◌`（忙碌）、`⌘`。

---

## 6. 技术约束（nsh 特有，务必遵守）

- `View` 默认是纵向列；横向用 `class="flex-row"`。`flex` 类等于 row。
- `Text` 只能包文本/嵌套 Text；内部不能放 View。
- `Scroll` 必须 `flex-1` 才能滚动；内容放内部 View。
- 条件渲染用 `{cond && <View/>}` 或 `<If when={...}>`；列表用 `<Each of={items} key={...}>{(item) => ...}</Each>`。
- 信号：`const s = signal(x); s()` 读，`s.set(v)` / `s.update(fn)` 写。组件函数只运行一次。
- 输入框用 `nsh/base` 的 `Input`：`multiline`、`value`、`onChange={({value})=>...}`、`onSubmit={({text})=>...}`、`submitBehavior="submit"`。
- 弹窗用 `nsh/base` 的 `Dialog` 或 `Sheet`；对话框用 `AlertDialog.show()`。
- 不要引入 React/DOM；没有 `window`/`document`。用 `nsh` 提供的 `windowSize`、`colorScheme`。
- 代码中不要写 `localStorage`；设置用 `nsh/storage` 的 `Storage`（如需要）。
- `class` 里只允许 Tailwind 4 + 主题 token；不确定的类会构建警告。
- 类型检查：`nsh check`；测试：`nsh test`（默认 iOS headless，需要桌面能力时 `open(...,{platform:"macos"})`）。
- 不要提交 `.nsh/`、`node_modules`、`server/node_modules`。

---

## 7. 测试策略

- `tests/store.test.tsx`：事件归约（文本流、工具卡片状态、usage、错误）单测（不 spawn）。
- `tests/app.test.tsx`：`open("./tests/test-entry.tsx", { platform: "macos" })` 注入 FakeBridge（或直接使用 test-entry 的 mock store），验证欢迎页、发送消息、消息渲染、面板切换、设置弹窗。
- `tests/e2e.test.tsx`：真实启动 bridge + pi + mock LLM（需要 `scripts/setup.mjs` 已完成），输入「创建一个演示文件」，等待工具卡片完成与助手回复，断言文件存在于临时工作区。
- 视觉检查：`nsh test --target macos` + `app.screenshot(path)` 截屏，人工查看布局。

---

## 8. 启动方式

```bash
npm run setup       # 安装 server 依赖（pi 0.74.2），生成 app/local-config.ts
nsh run App.tsx     # 启动桌面应用
nsh test            # 跑测试
```

环境变量：真实 provider 的 API Key 通过 `ANTHROPIC_API_KEY` 等传入（nsh.json 已授权这些变量）。没有 Key 时自动进入 Demo 模式。

自定义 OpenAI 兼容网关：设置 `OPENAI_BASE_URL` 与 `OPENAI_API_KEY`（可选 `OPENAI_MODEL`）。bridge 会请求 `${OPENAI_BASE_URL}/models` 自动发现模型，写入隔离的 `openai-gateway-agent/models.json`，并以 `openai-gateway` provider 启动 pi；`auto` 模式优先使用它，`demo` 模式忽略它。
