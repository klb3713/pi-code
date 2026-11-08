// Standalone end-to-end test for the Pi Code bridge.
//
//   node server/test-bridge.mjs
//
// It spawns server/bridge.mjs (demo mode), then verifies:
//   init → prompt (write tool creates a file) → list_files → read_file →
//   git_status → get_diff → shutdown.
//
// No nsh dependency: plain Node 22 + the pi package in server/node_modules.

import { spawn, execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_PATH = path.join(HERE, "bridge.mjs");

const results = [];
let failures = 0;

function pass(name, detail = "") {
  results.push({ ok: true, name, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, error) {
  failures += 1;
  results.push({ ok: false, name, detail: String(error) });
  console.log(`FAIL  ${name} — ${String(error)}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    pass(name, typeof detail === "string" ? detail : "");
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class BridgeClient {
  constructor(child) {
    this.child = child;
    this.buffer = "";
    this.pending = new Map();
    this.events = [];
    this.waiters = [];
    this.counter = 0;
    this.maxLineBytes = 0;
    this.stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      for (;;) {
        const index = this.buffer.indexOf("\n");
        if (index < 0) break;
        const line = this.buffer.slice(0, index).replace(/\r$/, "");
        this.buffer = this.buffer.slice(index + 1);
        if (!line.trim()) continue;
        this.maxLineBytes = Math.max(this.maxLineBytes, Buffer.byteLength(line));
        this.handleLine(line);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    child.once("exit", (code, signal) => {
      const error = new Error(`bridge 进程退出（code=${code ?? "null"}, signal=${signal ?? "null"}）`);
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    });
  }

  handleLine(line) {
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(`bridge emitted bad JSON: ${line.slice(0, 200)} (${String(error)})`);
    }
    if (record.type === "response") {
      const pending = this.pending.get(record.id);
      if (pending) {
        this.pending.delete(record.id);
        clearTimeout(pending.timer);
        pending.resolve(record);
      }
      return;
    }
    this.events.push(record);
    for (const waiter of this.waiters.slice()) {
      if (waiter.since <= this.events.length - 1 && waiter.predicate(record)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve(record);
      }
    }
  }

  request(type, payload = {}, timeoutMs = 90_000) {
    const id = `test-${++this.counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${type} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, type, ...payload })}\n`);
    });
  }

  waitFor(predicate, { since = 0, timeoutMs = 60_000, label = "event" } = {}) {
    for (let i = since; i < this.events.length; i += 1) {
      if (predicate(this.events[i])) return Promise.resolve(this.events[i]);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        since,
        predicate,
        resolve,
        timer: setTimeout(() => {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          reject(new Error(`等待 ${label} 超时（${timeoutMs}ms）`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  since() {
    return this.events.length;
  }

  async shutdown() {
    try {
      await this.request("shutdown", {}, 10_000);
    } catch {
      // best effort
    }
    this.child.stdin.end();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Pi Code Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Pi Code Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();
}

async function main() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "pi-code-bridge-test-"));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-code-bridge-data-"));
  let child;
  let client;

  try {
    // A small git repo so git_status/get_diff exercise real git.
    git(workspace, ["init", "-b", "main"]);
    await fs.writeFile(path.join(workspace, ".gitignore"), "node_modules/\n", "utf8");
    await fs.writeFile(path.join(workspace, "seed.txt"), "seed line one\n", "utf8");
    await fs.mkdir(path.join(workspace, "node_modules", "pkg"), { recursive: true });
    await fs.writeFile(path.join(workspace, "node_modules", "pkg", "index.js"), "ignored\n", "utf8");
    git(workspace, ["add", ".gitignore", "seed.txt"]);
    git(workspace, ["commit", "-m", "initial"]);

    child = spawn(process.execPath, [BRIDGE_PATH], {
      cwd: workspace,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    client = new BridgeClient(child);
    child.once("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`bridge exited unexpectedly: code=${code} signal=${signal}`);
      }
    });

    // ── init ────────────────────────────────────────────────────────────
    let initResponse;
    await check("init (demo)", async () => {
      initResponse = await client.request("init", { workspace, mode: "demo", dataDir }, 120_000);
      assert(initResponse.success, `init 失败：${initResponse.error}`);
      const data = initResponse.data;
      assert(data.demo === true, "init.data.demo 应为 true");
      assert(data.mode === "demo", `mode 应为 demo，实际 ${data.mode}`);
      assert(data.piVersion === "0.74.2", `piVersion 应为 0.74.2，实际 ${data.piVersion}`);
      assert(data.workspace === workspace, "workspace 不匹配");
      assert(Array.isArray(data.models) && data.models.length >= 1, "models 为空");
      assert(
        data.models.some((model) => model.id === "pi-demo-1" && model.provider === "pi-demo"),
        "models 中没有 pi-demo-1",
      );
      assert(data.currentModel?.id === "pi-demo-1", `currentModel 应为 pi-demo-1，实际 ${JSON.stringify(data.currentModel)}`);
      return `mode=demo, model=${data.currentModel.provider}/${data.currentModel.id}, thinking=${data.thinkingLevel}`;
    });

    await check("ready/session events emitted", async () => {
      await client.waitFor((event) => event.type === "ready", { timeoutMs: 15_000, label: "ready event" });
      const session = await client.waitFor((event) => event.type === "session", {
        timeoutMs: 15_000,
        label: "session event",
      });
      assert(session.sessionId || session.sessionPath, "session 事件缺少 id/path");
      return `session=${session.sessionId ?? session.sessionPath}`;
    });

    // ── prompt ──────────────────────────────────────────────────────────
    await check("prompt (write tool creates hello.md)", async () => {
      const since = client.since();
      const response = await client.request("prompt", { message: "创建一个演示文件 hello.md" }, 30_000);
      assert(response.success, `prompt 失败：${response.error}`);
      assert(response.data?.accepted === true, "prompt 响应应包含 accepted=true");

      const toolStart = await client.waitFor(
        (event) => event.type === "tool_start" && event.toolName === "write",
        { since, timeoutMs: 60_000, label: "tool_start(write)" },
      );
      assert(toolStart.args?.path === "hello.md", `write 路径应为 hello.md，实际 ${JSON.stringify(toolStart.args?.path)}`);

      const toolEnd = await client.waitFor(
        (event) => event.type === "tool_end" && event.toolCallId === toolStart.toolCallId,
        { since, timeoutMs: 60_000, label: "tool_end(write)" },
      );
      assert(toolEnd.isError === false, "write 工具返回错误");

      const messageEnd = await client.waitFor(
        (event) =>
          event.type === "message_end" &&
          event.message?.role === "assistant" &&
          event.message.content?.some((block) => block.type === "text" && block.text.length > 0),
        { since, timeoutMs: 60_000, label: "message_end(assistant text)" },
      );
      const finalText = messageEnd.message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      assert(finalText.includes("hello.md"), "最终回复中应提到 hello.md");

      await client.waitFor((event) => event.type === "agent_end", { since, timeoutMs: 60_000, label: "agent_end" });

      const content = await fs.readFile(path.join(workspace, "hello.md"), "utf8");
      assert(content.includes("Pi Code Demo"), "hello.md 内容不是 demo 内容");
      assert(content.length > 10, "hello.md 内容过短");

      const deltas = client.events
        .slice(since)
        .filter((event) => event.type === "assistant_delta" && event.kind === "text");
      assert(deltas.length > 0, "没有收到 assistant_delta 文本增量");
      return `tool_start/tool_end/message_end/agent_end 全部收到，${deltas.length} 个文本 delta`;
    });

    await check("protocol event size stays bounded", async () => {
      assert(client.maxLineBytes < 200_000, `单行 JSON 过大：${client.maxLineBytes} bytes（疑似未剥离 cumulative partial）`);
      const leaked = client.events.some((event) => JSON.stringify(event).includes("partialArgs"));
      assert(!leaked, "事件中泄漏了 pi 的 partialArgs/cumulative 字段");
      return `最大单行 ${client.maxLineBytes} bytes`;
    });

    // ── list_files ──────────────────────────────────────────────────────
    await check("list_files", async () => {
      const response = await client.request("list_files", { maxDepth: 6 });
      assert(response.success, `list_files 失败：${response.error}`);
      const files = response.data.files;
      assert(Array.isArray(files), "files 不是数组");
      const flatten = (nodes) => nodes.flatMap((node) => [node, ...(node.children ? flatten(node.children) : [])]);
      const all = flatten(files);
      const names = all.map((node) => node.id);
      assert(names.includes("hello.md"), "文件树缺少 hello.md");
      assert(names.includes("seed.txt"), "文件树缺少 seed.txt");
      assert(!names.some((name) => name.includes("node_modules")), "文件树不应包含 node_modules");
      assert(!names.some((name) => name === ".git" || name.startsWith(".git/")), "文件树不应包含 .git");
      const dir = all.find((node) => node.id === "node_modules");
      assert(!dir, "node_modules 不应出现");
      return `root entries=${files.map((node) => node.name).join(", ")}`;
    });

    // ── read_file ───────────────────────────────────────────────────────
    await check("read_file", async () => {
      const response = await client.request("read_file", { path: "hello.md" });
      assert(response.success, `read_file 失败：${response.error}`);
      const data = response.data;
      assert(data.path === "hello.md", `path 不匹配：${data.path}`);
      assert(data.language === "markdown", `language 应为 markdown，实际 ${data.language}`);
      assert(data.content.includes("Pi Code Demo"), "内容缺少 demo 标记");
      assert(typeof data.size === "number" && data.size > 0, "size 无效");
      return `language=${data.language}, size=${data.size}`;
    });

    // ── git_status ──────────────────────────────────────────────────────
    await check("git_status", async () => {
      await fs.appendFile(path.join(workspace, "seed.txt"), "seed line two\n", "utf8");
      const response = await client.request("git_status");
      assert(response.success, `git_status 失败：${response.error}`);
      const data = response.data;
      assert(data.branch === "main", `branch 应为 main，实际 ${data.branch}`);
      const paths = data.changes.map((change) => change.path);
      assert(paths.includes("hello.md"), "git_status 缺少 hello.md");
      assert(paths.includes("seed.txt"), "git_status 缺少 seed.txt");
      const seed = data.changes.find((change) => change.path === "seed.txt");
      assert(seed.status.includes("M"), `seed.txt 状态应为 M，实际 ${seed.status}`);
      const hello = data.changes.find((change) => change.path === "hello.md");
      assert(hello.status.includes("?"), `hello.md 状态应为 ??，实际 ${hello.status}`);
      return `branch=${data.branch}, changes=${data.changes.map((c) => `${c.status}:${c.path}`).join(", ")}`;
    });

    // ── get_diff (untracked) ────────────────────────────────────────────
    await check("get_diff (untracked file)", async () => {
      const response = await client.request("get_diff", { path: "hello.md" });
      assert(response.success, `get_diff 失败：${response.error}`);
      const data = response.data;
      assert(data.path === "hello.md", "path 不匹配");
      assert(data.oldText === "", "未跟踪文件 oldText 应为空串");
      assert(data.newText.includes("Pi Code Demo"), "newText 缺少内容");
      assert(data.language === "markdown", `language 应为 markdown，实际 ${data.language}`);
      assert(!data.patch, "未跟踪文件不应返回 patch");
      return `oldText="" newText=${data.newText.length}B language=${data.language}`;
    });

    // ── get_diff (tracked modification) ─────────────────────────────────
    await check("get_diff (tracked patch)", async () => {
      const response = await client.request("get_diff", { path: "seed.txt" });
      assert(response.success, `get_diff 失败：${response.error}`);
      const data = response.data;
      assert(typeof data.patch === "string" && data.patch.includes("+seed line two"), "patch 缺少新增行");
      assert(data.patch.includes("-") || data.patch.includes("@@"), "patch 不是 unified diff");
      return `patch=${data.patch.length}B language=${data.language}`;
    });

    await check("session list after run", async () => {
      const response = await client.request("list_sessions", { limit: 10 });
      assert(response.success, `list_sessions 失败：${response.error}`);
      const sessions = response.data.sessions;
      assert(Array.isArray(sessions) && sessions.length >= 1, "没有找到会话文件");
      const current = sessions.find((session) => session.path === initResponse.data.sessionPath);
      assert(current, `列表里缺少当前会话 ${initResponse.data.sessionPath}`);
      assert(current.messageCount >= 2, `messageCount 应 >= 2，实际 ${current.messageCount}`);
      return `sessions=${sessions.length}, current messages=${current.messageCount}`;
    });

    await client.shutdown();
    await check("shutdown", async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert(child.exitCode === 0 || child.exitCode === null, `退出码 ${child.exitCode}`);
      return `bridge exited (${child.exitCode ?? "running"})`;
    });
  } catch (error) {
    fail("unexpected test crash", error);
  } finally {
    if (client) await client.shutdown().catch(() => {});
    if (child && child.exitCode === null) child.kill("SIGKILL");
    if (client && client.stderr && failures > 0) {
      console.error("\n── bridge stderr ──");
      console.error(client.stderr.slice(-6000));
    }
    if (failures === 0) {
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    } else {
      console.error(`\nwork dirs kept for debugging:\n  workspace=${workspace}\n  dataDir=${dataDir}`);
    }
  }

  console.log("\n──────── summary ────────");
  const passed = results.filter((item) => item.ok).length;
  console.log(`${passed}/${results.length} checks passed, ${failures} failed`);
  if (failures > 0) {
    console.log("RESULT: FAIL");
    process.exit(1);
  }
  console.log("RESULT: PASS");
  process.exit(0);
}

await main();
