# Web WebSocket bridge 设计

## 目标

让 `nsh run App.tsx --target web` 在浏览器中连接本机 pi，同时保持桌面端现有 `process.spawn` 路径不变。浏览器只承担 UI；pi、工作区文件和 git 操作仍由用户本机 Node 进程执行。

## 非目标

- 不支持纯静态托管后直接连接 pi。
- 不把 pi 或 Node 桥接逻辑移植进浏览器。
- 不开放局域网或公网访问。

## 已确认方案

用户选择方案 B，顺序为：bridge 增加 WS 服务模式、新增 web transport、平台分支、补充 capabilities，并分别验证桌面和 web。

## 实现决定

- 新增 `server/websocket-server.mjs`，默认监听 `ws://127.0.0.1:8787/bridge`。
- 每个 WebSocket 连接启动一个独立的现有 `server/bridge.mjs` 子进程；文本帧与 JSONL 行一一转换。这样复用现有协议和会话生命周期，不重写桌面核心。
- 服务只绑定 loopback。带 `Origin` 的连接必须属于允许列表，默认允许 `http://127.0.0.1:8790` 与 `http://localhost:8790`；无 `Origin` 的本机非浏览器客户端允许连接。`PI_CODE_BRIDGE_ORIGINS` 设置时替换默认白名单。测试 runner 的临时服务可通过编程回调允许随机端口的 HTTP loopback 来源，正常 CLI 不开启此回调。
- 新增 `app/bridge-web.ts`，实现现有 `BridgeTransport`。`start()` 建立连接；连接打开前排队的请求在打开后发送；断开时拒绝未完成请求并通知 exit listener。
- `app/store.ts` 根据 `nsh/desktop` 的 `isAvailable` 选择 transport；桌面保留 `realBridge`，非桌面路径使用 `webBridge`（移动端非本任务支持目标）。仅桌面执行本机 `fs.exists` 工作区校验。
- Web init 的 `dataDir` 传空，Node 默认使用 `~/.pi-code`，不转发浏览器 OPFS 的 `/app-data`；桌面数据目录行为不变。
- `nsh.json` 仅授权 `127.0.0.1:8787` 的 HTTP/WS `/bridge` 路径。
- 根 `package.json` 增加 `bridge:web` 和 `dev:web` 脚本；README 记录双终端启动方式及本机后端限制。

## 安全与可靠性

- Origin 校验用于阻止其他网站从浏览器跨站连接本机服务；服务不监听 `0.0.0.0`。
- 客户端入站单帧上限 1 MiB，仅接受文本 JSON，整帧解析后重序列化成一条 JSONL，禁止一帧注入多条命令；出站可容纳现有 list_files / diff 较大响应，不套用 1 MiB 限制。
- 连接关闭先用 stdin EOF 触发 bridge 正常清理，1.5 秒后 SIGTERM，3.5 秒后 SIGKILL 兜底；service.close() 等待对应 child 的 close。child 关闭后 WS close，transport 拒绝未完成请求并通知 exit listener。
- `shutdown` 只关闭当前连接对应的 bridge，不停止整个 WS 服务。
- 老连接的事件不得影响重启后的新连接；挂起请求必须在超时或断开时清理。

## 验证

- Node 集成测试：Origin 拒绝、demo init、文件读取、shutdown 后服务仍可接受新连接。
- nsh 单元测试：请求排队/响应、事件分发、断开拒绝、重启隔离、停止清理。
- 全套 `nsh check`、`npm test`、两个 Node 测试。
- 通过 `nsh test App.tsx --target macos` 和 `--target web` 驱动真实应用，均等待到“pi 已连接”。
