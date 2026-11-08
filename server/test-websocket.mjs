// End-to-end tests for the browser WebSocket bridge service.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import WebSocket from "ws";
import { startWebSocketBridge } from "./websocket-server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_PATH = path.join(HERE, "bridge.mjs");
const ALLOWED_ORIGIN = "http://127.0.0.1:8790";
const results = [];
let failures = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    failures += 1;
    results.push({ name, ok: false });
    console.error(`FAIL  ${name} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

class Client {
  constructor(socket) {
    this.socket = socket;
    this.counter = 0;
    this.pending = new Map();
    this.events = [];
    this.waiters = [];
    this.closed = new Promise((resolve) => socket.once("close", resolve));
    const rejectPending = (error) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    };
    socket.on("error", rejectPending);
    socket.on("close", () => rejectPending(new Error("WebSocket closed")));
    socket.on("message", (data, isBinary) => {
      assert(!isBinary, "bridge 不应发送二进制帧");
      const record = JSON.parse(data.toString());
      if (record.type === "response") {
        const pending = this.pending.get(record.id);
        if (!pending) return;
        this.pending.delete(record.id);
        clearTimeout(pending.timer);
        pending.resolve(record);
        return;
      }
      this.events.push(record);
      for (const waiter of this.waiters.slice()) {
        if (!waiter.predicate(record)) continue;
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve(record);
      }
    });
  }

  static async connect(url, origin = ALLOWED_ORIGIN) {
    const socket = new WebSocket(url, { origin });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new Client(socket);
  }

  request(type, payload = {}, timeoutMs = 90_000) {
    const id = `ws-test-${++this.counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${type} 超时`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, type, ...payload }));
    });
  }

  waitFor(predicate, timeoutMs = 10_000, since = 0) {
    const existing = this.events.slice(since).find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          reject(new Error("等待事件超时"));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  send(text) {
    this.socket.send(text);
  }

  close() {
    this.socket.close();
    return this.closed;
  }
}

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "pi-code-ws-workspace-"));
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-code-ws-data-"));
await fs.writeFile(path.join(workspace, "seed.txt"), "websocket seed\n", "utf8");
let service;
let first;
let second;

try {
  await check("rejects a browser origin outside the allowlist", async () => {
    service = await startWebSocketBridge({
      port: 0,
      bridgePath: BRIDGE_PATH,
      allowedOrigins: [ALLOWED_ORIGIN],
    });
    const socket = new WebSocket(service.url, { origin: "https://evil.example" });
    const error = await new Promise((resolve) => socket.once("error", resolve));
    assert(String(error.message).includes("403"), `应返回 403，实际 ${error.message}`);
    return "HTTP 403";
  });

  await check("serves the existing demo protocol over WebSocket", async () => {
    first = await Client.connect(service.url);
    const init = await first.request("init", { workspace, dataDir, mode: "demo" }, 120_000);
    assert(init.success, `init 失败：${init.error}`);
    assert(init.data?.demo === true, "应进入 demo 模式");
    const files = await first.request("list_files", { maxDepth: 2 });
    assert(files.success, `list_files 失败：${files.error}`);
    assert(files.data?.files?.some((file) => file.id === "seed.txt"), "文件树缺少 seed.txt");
    return `workspace=${init.data.workspace}`;
  });

  await check("streams a real pi write tool over WebSocket and reads its file back", async () => {
    const response = await first.request("prompt", { message: "创建一个 ws-demo.md 演示文件" });
    assert(response.success, `prompt 失败：${response.error}`);
    await first.waitFor((event) => event.type === "tool_end" && event.toolName === "write" && !event.isError, 60_000);
    await first.waitFor((event) => event.type === "agent_end", 60_000);
    assert(first.events.some((event) => event.type === "assistant_delta" && event.delta), "未收到流式文本");
    const read = await first.request("read_file", { path: "ws-demo.md" });
    assert(read.success && read.data?.content?.includes("Pi Code Demo"), "WS read_file 回读失败");
    const disk = await fs.readFile(path.join(workspace, "ws-demo.md"), "utf8");
    assert(disk.includes("Pi Code Demo"), "文件必须由真实 pi 工具写入磁盘");
    return "stream → write → disk → read_file";
  });

  await check("malformed input returns an error without dropping the connection", async () => {
    first.send("{not-json");
    const event = await first.waitFor((item) => item.type === "error" && item.message.includes("无效 JSON"));
    assert(event.message, "缺少无效 JSON 错误");
    const unknown = await first.request("not_a_command");
    assert(unknown.success === false, "未知命令应返回失败响应");
    return "连接保持可用";
  });

  await check("one WebSocket frame cannot inject multiple JSONL requests", async () => {
    const since = first.events.length;
    first.send('{"id":"injected-a","type":"get_state"}\n{"id":"injected-b","type":"get_state"}');
    const event = await first.waitFor((item) => item.type === "error" && item.message.includes("一条 JSON"), 1500, since);
    assert(event.message, "应拒绝含两条 JSON 的一帧");
    const response = await first.request("get_state");
    assert(response.success, `连接应仍可用：${response.error}`);
    return "整帧校验，未拆成两条命令";
  });

  await check("binary frames are rejected while text requests remain usable", async () => {
    first.socket.send(Buffer.from([1, 2, 3]));
    await first.waitFor((item) => item.type === "error" && item.message.includes("文本 JSON"));
    const response = await first.request("get_state");
    assert(response.success, `二进制帧不应破坏连接：${response.error}`);
    return "文本请求仍正常";
  });

  await check("closing the service waits for a stubborn bridge child to exit", async () => {
    const fixturePath = path.join(dataDir, "stubborn-bridge.mjs");
    await fs.writeFile(fixturePath, [
      'process.on("SIGTERM", () => {});',
      'setInterval(() => {}, 1000);',
      'process.stdout.write(JSON.stringify({type:"status",status:"ready",message:String(process.pid)})+"\\n");',
    ].join("\n"));
    const fixtureService = await startWebSocketBridge({ port: 0, bridgePath: fixturePath });
    let client;
    let pid;
    try {
      client = await Client.connect(fixtureService.url);
      const event = await client.waitFor((item) => item.type === "status" && item.status === "ready");
      pid = Number(event.message);
      assert(Number.isInteger(pid) && pid > 0, "fixture 应提供有效 pid");
      await fixtureService.close();
      let alive = false;
      try { process.kill(pid, 0); alive = true; } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      assert(!alive, `close() 返回后 bridge 子进程 ${pid} 仍在运行`);
      return "已等待并回收子进程";
    } finally {
      client?.socket.terminate();
      if (pid) { try { process.kill(pid, "SIGKILL"); } catch {} }
      await fixtureService.close();
    }
  });

  await check("oversized frames close only their connection with code 1009", async () => {
    const oversized = await Client.connect(service.url);
    const closed = oversized.closed;
    oversized.socket.send("x".repeat(1024 * 1024 + 1));
    const code = await closed;
    assert(code === 1009, `超大帧应得到 1009，实际 ${code}`);
    const state = await first.request("get_state");
    assert(state.success, "超大帧不得影响其他会话");
    return "1009，其他会话健康";
  });

  await check("shutdown closes one session but not the WebSocket service", async () => {
    second = await Client.connect(service.url);
    const shutdown = await first.request("shutdown", {}, 15_000);
    assert(shutdown.success, `shutdown 失败：${shutdown.error}`);
    await first.closed;
    first = null;
    const response = await second.request("also_not_a_command");
    assert(response.success === false, "第二个连接应能收到协议响应");
    return "第二个连接已接受";
  });
} catch (error) {
  failures += 1;
  console.error(`FAIL  unexpected test crash — ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  if (first) first.socket.terminate();
  if (second) second.socket.terminate();
  if (service) await service.close();
  if (failures === 0) {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
  } else {
    console.error(`work dirs kept: ${workspace} ${dataDir}`);
  }
}

console.log(`\n${results.filter((item) => item.ok).length}/${results.length} checks passed, ${failures} failed`);
console.log(failures === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failures === 0 ? 0 : 1);
