# Web WebSocket bridge 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [x]`）语法来跟踪进度。

**目标：** 让浏览器 UI 通过本机 WebSocket 服务使用现有 pi bridge，桌面路径保持兼容。

**架构：** WS 服务为每个连接代理一个独立 bridge 子进程；web transport 实现现有 `BridgeTransport`，store 按 `isAvailable` 选择桌面或 WebSocket。

**技术栈：** Node.js >=22.19、ws 8、TypeScript/TSX、nsh 0.4。

**规格：** `docs/superpowers/specs/2026-11-08-web-websocket-bridge-design.md`

## 全局约束

- 不改动未跟踪的 `hello.ts`，不提交用户文件。
- 桌面 `process.spawn` 行为保持原样。
- WS 仅绑定 `127.0.0.1`，默认端口 8787，路径 `/bridge`。
- 每个测试先因功能缺失失败，再写最小实现。

## 审查重点（Review Focus）

- 恶意网页的 Origin 必须被拒绝，且服务仍健康。
- 浏览器在 `open` 前发送 init 不得丢失或报“未运行”。
- 旧 socket 的迟到事件不得拒绝新连接的请求。
- UI  shutdown/页面卸载不得杀掉 WS 服务或其他连接的会话。
- 无效 JSON、二进制帧和超大消息不得导致未处理异常。

---

### 任务 1：WebSocket 服务

**文件：** 创建 `server/websocket-server.mjs`、`server/test-websocket.mjs`；修改 `server/package.json` 与 lockfile。

- [x] 写 Node 集成测试，覆盖恶意 Origin 403、demo init/list_files、shutdown 后第二个连接仍可用。
- [x] 运行 `node server/test-websocket.mjs`，预期因服务模块不存在而失败。
- [x] 实现 `startWebSocketBridge(options)` 与 CLI，添加直接依赖 `ws`。
- [x] 重跑测试预期全绿，再跑 `node server/test-bridge.mjs` 确认桌面桥接不变。

### 任务 2：浏览器 transport

**文件：** 创建 `app/bridge-web.ts`、`tests/bridge-web.test.ts`。

- [x] 用可控 socket 替身写测试：open 前排队、响应与事件、断开拒绝、重启隔离、stop 清理。
- [x] 运行 `nsh test tests/bridge-web.test.ts`，预期模块不存在。
- [x] 实现 `WebSocketBridgeTransport` 和默认 `webBridge`，URL 为 `ws://127.0.0.1:8787/bridge`。
- [x] 重跑该测试和 `nsh test tests/store.test.tsx`，预期全绿。

### 任务 3：平台接入与文档

**文件：** 修改 `app/store.ts`、`nsh.json`、根 `package.json`、`README.md`。

- [x] 增加平台选择测试/可执行集成场景，确认 web 默认 transport 不调用 process。
- [x] 运行目标测试，预期在 web 默认仍选择子进程时失败。
- [x] 按 `isAvailable` 选择 transport，仅桌面做 `fs.exists`；补 network capabilities、脚本和双终端文档。
- [x] 运行 `nsh check` 与 `npm test`，预期全绿。

### 任务 4：双目标验证与审查

- [x] `npm run test:web` 临时启动 WS 服务，运行 `nsh test tests/platform-bootstrap.test.tsx --target web`，等待“pi 已连接”。另用 `nsh run App.tsx --target web` 的默认 Origin 做真实 Chrome smoke，验证正常白名单路径。
- [x] 运行同一真实启动检查的 macOS target，预期成功；随后停止后台服务。
- [x] 运行全部 Node/nsh 测试并检查最终 diff。
- [x] 独立审查已完成，无 Critical/Important；测试覆盖建议在审查期间已补齐，两项 Minor 延后（罕见 server 级错误的常驻日志处理、CLI 空/零端口误用提示）。
