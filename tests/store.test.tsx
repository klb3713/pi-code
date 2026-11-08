// Event-reduction unit tests for app/store.ts.
//
// These tests never spawn a process: a FakeTransport is injected with
// setTransport() and events are pushed straight into applyEvent(), exercising
// the same reducer the bridge client feeds in production.
import { beforeEach, expect, test } from "nsh/test";
import {
  actions,
  activeAssistant,
  applyEvent,
  bootError,
  busy,
  changedFiles,
  connection,
  countPatch,
  messages,
  model,
  models,
  settings,
  phase,
  runMode,
  setTransport,
  thinking,
  toast,
  tools,
  usage,
  workspace,
} from "../app/store";
import { emptyUsage, type UsageInfo } from "../app/protocol";
import { createFakeTransport } from "./fake-transport";

const SAMPLE_USAGE: UsageInfo = {
  input: 1200,
  output: 180,
  cacheRead: 20,
  cacheWrite: 10,
  totalTokens: 1410,
  cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
};

function resetStore(): void {
  setTransport(createFakeTransport());
  phase.set("ready");
  connection.set("connected");
  bootError.set("");
  messages.set([]);
  activeAssistant.set(null);
  tools.set({});
  busy.set(false);
  usage.set(emptyUsage());
  changedFiles.set([]);
  toast.set(null);
}

function textOf(value: unknown): string {
  const blocks = (value as { content?: unknown[] } | undefined)?.content ?? [];
  return blocks
    .filter((block) => (block as { type?: string }).type === "text")
    .map((block) => (block as { text?: string }).text ?? "")
    .join("\n");
}

beforeEach(() => {
  resetStore();
});

test("message_start user + assistant streaming deltas reduce into messages", () => {
  applyEvent({ type: "agent_start" });
  expect(busy()).toBe(true);

  // A user message is committed on message_end.
  applyEvent({
    type: "message_start",
    message: { role: "user", content: [{ type: "text", text: "你好，帮我改个文件" }], timestamp: 1000 },
  });
  applyEvent({
    type: "message_end",
    message: { role: "user", content: [{ type: "text", text: "你好，帮我改个文件" }], timestamp: 1000 },
  });
  expect(messages().length).toBe(1);
  expect(messages()[0]?.role).toBe("user");
  expect(textOf(messages()[0])).toBe("你好，帮我改个文件");

  // Assistant streaming starts empty, then deltas accumulate by contentIndex.
  applyEvent({ type: "message_start", message: { role: "assistant", content: [], timestamp: 1100 } });
  expect(activeAssistant()).not.toBeNull();
  expect(activeAssistant()?.blocks.length).toBe(0);

  applyEvent({ type: "assistant_delta", contentIndex: 0, kind: "text", delta: "你好" });
  applyEvent({ type: "assistant_delta", contentIndex: 0, kind: "text", delta: "，我是 Pi" });
  expect(activeAssistant()?.blocks.length).toBe(1);
  expect(activeAssistant()?.blocks[0]?.text).toBe("你好，我是 Pi");
  expect(activeAssistant()?.blocks[0]?.kind).toBe("text");

  // A separate thinking block stays separate and ordered by index.
  applyEvent({ type: "assistant_delta", contentIndex: 1, kind: "thinking", delta: "先看看文件…" });
  expect(activeAssistant()?.blocks.length).toBe(2);
  expect(activeAssistant()?.blocks[1]?.kind).toBe("thinking");

  // message_end commits the assistant message, clears the stream and usage.
  applyEvent({
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "你好，我是 Pi" },
        { type: "thinking", text: "先看看文件…" },
      ],
      timestamp: 1200,
      usage: SAMPLE_USAGE,
    },
  });
  expect(messages().length).toBe(2);
  expect(messages()[1]?.role).toBe("assistant");
  expect(textOf(messages()[1])).toBe("你好，我是 Pi");
  expect(activeAssistant()).toBeNull();
  expect(usage().totalTokens).toBe(1410);
  expect(usage().cost.total).toBe(0.003);

  // agent_end ends the whole run.
  applyEvent({ type: "agent_end" });
  expect(busy()).toBe(false);
});

test("tool lifecycle: running → output → done, write lands in changedFiles", () => {
  const toolCall = { id: "call_write_1", name: "write", arguments: { path: "src/main.ts", content: "x" } };
  applyEvent({ type: "assistant_toolcall", contentIndex: 1, toolCall });
  expect(activeAssistant()?.toolCalls.length).toBe(1);
  expect(tools()["call_write_1"]).toMatchObject({
    id: "call_write_1",
    name: "write",
    args: { path: "src/main.ts", content: "x" },
    status: "running",
    output: "",
  });

  // tool_start may repeat the same call without losing accumulated output.
  applyEvent({ type: "tool_start", toolCallId: "call_write_1", toolName: "write", args: { path: "src/main.ts" } });
  expect(tools()["call_write_1"]?.status).toBe("running");

  applyEvent({ type: "tool_update", toolCallId: "call_write_1", text: "writing…\n" });
  applyEvent({ type: "tool_update", toolCallId: "call_write_1", text: "done\n" });
  expect(tools()["call_write_1"]?.output).toBe("writing…\ndone\n");

  applyEvent({
    type: "tool_end",
    toolCallId: "call_write_1",
    toolName: "write",
    resultText: "Successfully wrote 1 byte to src/main.ts",
    isError: false,
    durationMs: 12,
  });
  expect(tools()["call_write_1"]).toMatchObject({
    status: "done",
    output: "Successfully wrote 1 byte to src/main.ts",
    durationMs: 12,
    isError: false,
  });
  expect(changedFiles()).toContainEqual({ path: "src/main.ts", status: "A" });

  // A failed edit does not touch the changed-file list.
  applyEvent({
    type: "assistant_toolcall",
    contentIndex: 2,
    toolCall: { id: "call_edit_2", name: "edit", arguments: { path: "src/other.ts", oldText: "a", newText: "b" } },
  });
  applyEvent({
    type: "tool_end",
    toolCallId: "call_edit_2",
    toolName: "edit",
    resultText: "oldText not found",
    isError: true,
  });
  expect(tools()["call_edit_2"]?.status).toBe("error");
  expect(tools()["call_edit_2"]?.isError).toBe(true);
  expect(changedFiles().some((item) => item.path === "src/other.ts")).toBe(false);
});

test("usage event normalizes missing fields", () => {
  applyEvent({ type: "usage", usage: SAMPLE_USAGE });
  expect(usage()).toEqual(SAMPLE_USAGE);

  applyEvent({
    type: "usage",
    usage: { totalTokens: 5 } as unknown as UsageInfo,
  });
  expect(usage().totalTokens).toBe(5);
  expect(usage().input).toBe(0);
  expect(usage().cost.total).toBe(0);
});

test("error event clears busy, appends a system message and shows a toast", () => {
  busy.set(true);
  applyEvent({ type: "error", message: "连接中断" });
  expect(busy()).toBe(false);
  expect(messages().length).toBe(1);
  expect(messages()[0]?.role).toBe("system");
  expect(textOf(messages()[0])).toContain("错误：连接中断");
  expect(toast()?.text).toBe("连接中断");
  expect(toast()?.tone).toBe("error");
});

test("status error event moves the app to the error phase", () => {
  phase.set("ready");
  connection.set("connected");
  applyEvent({ type: "status", status: "error", message: "bridge 启动失败" });
  expect(phase()).toBe("error");
  expect(connection()).toBe("disconnected");
  expect(bootError()).toBe("bridge 启动失败");
});

test("agent_end aborted adds a stop note", () => {
  busy.set(true);
  applyEvent({ type: "agent_end", aborted: true });
  expect(busy()).toBe(false);
  expect(messages().length).toBe(1);
  expect(messages()[0]?.role).toBe("system");
  expect(textOf(messages()[0])).toBe("已停止生成。");
});

test("history event rebuilds messages and tool cards from session messages", () => {
  applyEvent({
    type: "history",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "看看 package.json" }],
        timestamp: 2000,
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "好的" },
          { type: "toolCall", id: "tc_read_1", name: "read", arguments: { path: "package.json" } },
        ],
        timestamp: 2100,
      },
      {
        role: "toolResult",
        toolCallId: "tc_read_1",
        toolName: "read",
        content: [{ type: "text", text: '{"name":"pi-code"}' }],
        isError: false,
      },
    ],
  });

  expect(messages().length).toBe(2);
  expect(messages()[0]?.role).toBe("user");
  expect(messages()[1]?.role).toBe("assistant");
  expect(messages()[1]?.content.some((block) => block.type === "toolCall")).toBe(true);
  expect(tools()["tc_read_1"]).toMatchObject({
    status: "done",
    output: '{"name":"pi-code"}',
    name: "read",
  });
  expect(activeAssistant()).toBeNull();
  expect(busy()).toBe(false);
});

test("ready event fills connection, models, workspace and settings", () => {
  applyEvent({
    type: "ready",
    data: {
      workspace: "/tmp/pi-code-test-workspace",
      mode: "demo",
      demo: true,
      piVersion: "0.74.2",
      models: [
        {
          provider: "pi-demo",
          id: "pi-demo-1",
          name: "Demo 模型",
          contextWindow: 128000,
          maxTokens: 16384,
        },
      ],
      currentModel: { provider: "pi-demo", id: "pi-demo-1", name: "Demo 模型" },
      thinkingLevel: "medium",
      sessionId: "sess-1",
      git: { branch: "main" },
    },
  });
  expect(phase()).toBe("ready");
  expect(connection()).toBe("connected");
  expect(workspace()).toBe("/tmp/pi-code-test-workspace");
  expect(runMode()).toBe("demo");
  expect(models().length).toBe(1);
  expect(model()?.name).toBe("Demo 模型");
  expect(thinking()).toBe("medium");
});

test("unknown events are ignored safely", () => {
  const before = messages().length;
  applyEvent({ type: "queue", steering: ["a"], followUp: [] });
  applyEvent({ type: "turn_end" });
  applyEvent({ type: "compaction", phase: "start", reason: "manual" });
  expect(messages().length).toBe(before);
  expect(busy()).toBe(false);
});

test("countPatch counts unified diff additions and deletions", () => {
  const patch = [
    "diff --git a/src/main.ts b/src/main.ts",
    "--- a/src/main.ts",
    "+++ b/src/main.ts",
    "@@ -1,3 +1,4 @@",
    " console.log('hi');",
    "-const oldValue = 1;",
    "+const newValue = 2;",
    "+console.log(newValue);",
    "",
  ].join("\n");
  expect(countPatch(patch)).toEqual({ additions: 2, deletions: 1 });
  expect(countPatch(undefined)).toBeNull();
  expect(countPatch("")).toBeNull();
});

test("actions.send uses the injected transport and streams a fake reply", async () => {
  const fake = createFakeTransport({ delayMs: 5, withTool: false, reply: "完成，已经处理好了。" });
  setTransport(fake);
  // bootstrap() normally wires this listener; wire it by hand so the test has
  // no boot side effects.
  const off = fake.onEvent((event) => applyEvent(event));
  phase.set("ready");
  busy.set(false);

  await actions.send("测试一下");
  expect(fake.calls.length).toBe(1);
  expect(fake.calls[0]?.type).toBe("prompt");
  expect(fake.calls[0]?.payload.message).toBe("测试一下");
  expect(busy()).toBe(true);

  const deadline = Date.now() + 3000;
  while (busy() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(busy()).toBe(false);
  expect(messages().some((item) => item.role === "user")).toBe(true);
  expect(messages().some((item) => item.role === "assistant" && textOf(item) === "完成，已经处理好了。")).toBe(true);
  off();
});


test("applySettings applies a model change without reconnecting", async () => {
  const transport = createFakeTransport();
  setTransport(transport);
  applyEvent({
    type: "ready",
    data: {
      workspace: "/tmp/pi-code-demo",
      mode: "demo",
      demo: true,
      piVersion: "0.74.2",
      models: [
        { provider: "pi-demo", id: "pi-demo-1", name: "Pi Demo 1" },
        { provider: "pi-demo", id: "pi-demo-2", name: "Pi Demo 2" },
      ],
      currentModel: { provider: "pi-demo", id: "pi-demo-1", name: "Pi Demo 1" },
      thinkingLevel: "off",
    },
  });
  settings.update((current) => ({ ...current, workspace: "/tmp/pi-code-demo", mode: "demo", modelKey: "pi-demo/pi-demo-2" }));
  await actions.applySettings();
  expect(transport.calls.some((call) => call.type === "set_model")).toBe(true);
  expect(model()?.id).toBe("pi-demo-2");
});
