// A deterministic in-memory transport for UI tests and the dev harness.
import type { AppConfig, BridgeEvent, BridgeResponse, ModelInfo, ReadyInfo, RunMode } from "../app/protocol";
import type { BridgeTransport } from "../app/store";

export interface FakeOptions {
  workspace?: string;
  delayMs?: number;
  reply?: string;
  withTool?: boolean;
  files?: unknown[];
  sessions?: unknown[];
  /** Simulates an unreachable gateway: auto mode falls back to Demo. */
  gatewayFails?: boolean;
  /** Number of init/reconnect requests that fail before the runtime starts. */
  initFailures?: number;
}

const FILES = [
  {
    id: "src",
    name: "src",
    kind: "dir",
    children: [
      { id: "src/main.ts", name: "main.ts", kind: "file", size: 128 },
      { id: "src/app.tsx", name: "app.tsx", kind: "file", size: 2048 },
    ],
  },
  { id: "README.md", name: "README.md", kind: "file", size: 512 },
  { id: "package.json", name: "package.json", kind: "file", size: 256 },
];

const PATCH = `diff --git a/src/main.ts b/src/main.ts
index 1111111..2222222 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,3 +1,5 @@
 console.log("hello");
+const answer = 42;
+console.log(answer);
 
 // done
`;

export function createFakeTransport(options: FakeOptions = {}): BridgeTransport & {
  emit: (event: BridgeEvent) => void;
  calls: { type: string; payload: Record<string, unknown> }[];
} {
  const listeners = new Set<(event: BridgeEvent) => void>();
  const calls: { type: string; payload: Record<string, unknown> }[] = [];
  const delay = options.delayMs ?? 10;
  let workspace = options.workspace ?? "/tmp/pi-code-demo";
  let demo = true;
  let savedConfig: AppConfig | null = null;
  let initFailures = options.initFailures ?? 0;

  function emit(event: BridgeEvent): void {
    for (const listener of listeners) listener(event);
  }

  function later(fn: () => void): void {
    setTimeout(fn, delay);
  }

  function runPrompt(message: string): void {
    const reply =
      options.reply ??
      "这是一个本地演示回复。\n\n```ts\nconsole.log('hello from pi code');\n```\n\n- 已读取工作区\n- 可以继续让我修改文件";
    emit({ type: "agent_start" });
    emit({
      type: "message_start",
      message: { role: "user", content: [{ type: "text", text: message }], timestamp: Date.now() },
    });
    emit({
      type: "message_end",
      message: { role: "user", content: [{ type: "text", text: message }], timestamp: Date.now() },
    });
    later(() => {
      emit({
        type: "message_start",
        message: { role: "assistant", content: [], timestamp: Date.now() },
      });
      if (options.withTool !== false) {
        const toolCall = {
          id: "call_demo_1",
          name: "write",
          arguments: { path: "src/main.ts", content: 'console.log("hello from pi code");\n' },
        };
        emit({ type: "assistant_toolcall", contentIndex: 1, toolCall });
        emit({ type: "tool_start", toolCallId: toolCall.id, toolName: "write", args: toolCall.arguments });
        later(() => {
          emit({
            type: "tool_end",
            toolCallId: toolCall.id,
            toolName: "write",
            resultText: "Successfully wrote 38 bytes to src/main.ts",
            isError: false,
            durationMs: 380,
          });
          emit({
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: reply }, { type: "toolCall", ...toolCall }],
              timestamp: Date.now(),
              usage: {
                input: 1200,
                output: 180,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 1380,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
            },
          });
          emit({ type: "usage", usage: {
            input: 1200,
            output: 180,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 1380,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          }});
          emit({ type: "agent_end", aborted: false });
        });
      } else {
        emit({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: reply }],
            timestamp: Date.now(),
          },
        });
        emit({ type: "agent_end", aborted: false });
      }
    });
  }

  return {
    calls,
    emit,
    start(nextWorkspace: string, _mode: RunMode) {
      workspace = nextWorkspace;
    },
    stop() {},
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onExit() {
      return () => {};
    },
    request(type: string, payload: Record<string, unknown> = {}): Promise<BridgeResponse> {
      calls.push({ type, payload });
      const ok = (data?: unknown): Promise<BridgeResponse> =>
        Promise.resolve({ id: `fake-${calls.length}`, type: "response", command: type, success: true, data });
      switch (type) {
        case "init":
        case "reconnect": {
          if (initFailures > 0) {
            initFailures -= 1;
            return Promise.resolve({
              id: `fake-${calls.length}`,
              type: "response",
              command: type,
              success: false,
              error: "WebSocket 连接失败：bridge 尚未就绪",
            });
          }
          const fallback = payload.config as AppConfig | undefined;
          const mode = savedConfig?.mode ?? fallback?.mode ?? (payload.mode === "real" ? "real" : "auto");
          const gateway = savedConfig?.gateway ?? fallback?.gateway ?? { baseUrl: "", apiKey: "" };
          const useGateway = !options.gatewayFails && mode !== "demo" && Boolean(gateway.baseUrl);
          demo = mode === "demo" || (mode === "auto" && !useGateway);
          workspace = String(savedConfig?.workspace ?? fallback?.workspace ?? payload.workspace ?? workspace);
          const availableModels: ModelInfo[] = useGateway
            ? [
                { provider: "openai-gateway", id: "gateway-model-1", name: "Gateway Model 1", reasoning: true },
                { provider: "openai-gateway", id: "gateway-model-2", name: "Gateway Model 2", reasoning: true },
              ]
            : [
                {
                  provider: demo ? "pi-demo" : "anthropic",
                  id: demo ? "pi-demo-1" : "claude-sonnet-4-5",
                  name: demo ? "Pi Demo 1" : "Claude Sonnet 4.5",
                  contextWindow: 128000,
                  maxTokens: 8192,
                  reasoning: !demo,
                },
                {
                  provider: demo ? "pi-demo" : "anthropic",
                  id: demo ? "pi-demo-2" : "claude-opus-4-1",
                  name: demo ? "Pi Demo 2" : "Claude Opus 4.1",
                  contextWindow: 200000,
                  maxTokens: 16384,
                  reasoning: true,
                },
              ];
          const configuredKey = savedConfig?.modelKey ?? fallback?.modelKey ?? "";
          const currentModel =
            availableModels.find((item) => `${item.provider}/${item.id}` === configuredKey) ?? availableModels[0]!;
          const config: AppConfig = {
            workspace,
            mode,
            modelKey: `${currentModel.provider}/${currentModel.id}`,
            thinking: savedConfig?.thinking ?? fallback?.thinking ?? "off",
            gateway: { ...gateway },
          };
          savedConfig = config;
          const ready: ReadyInfo = {
            workspace,
            mode: demo ? "demo" : "real",
            demo,
            piVersion: "1.5.0",
            models: availableModels,
            currentModel,
            thinkingLevel: config.thinking,
            sessionId: "fake-session",
            sessionPath: `${workspace}/.pi/sessions/fake.jsonl`,
            config,
          };
          later(() => emit({ type: "ready", data: ready }));
          return ok(ready);
        }
        case "save_config": {
          savedConfig = payload.config as AppConfig;
          return ok({ config: savedConfig });
        }
        case "prompt": {
          const message = String(payload.message ?? "");
          later(() => runPrompt(message));
          return ok({ accepted: true });
        }
        case "abort":
          later(() => emit({ type: "agent_end", aborted: true }));
          return ok({});
        case "new_session":
          return ok({});
        case "switch_session": {
          emit({ type: "history", messages: [] });
          return ok({});
        }
        case "list_sessions":
          return ok({ sessions: options.sessions ?? [] });
        case "set_model": {
          const provider = String(payload.provider ?? "pi-demo");
          const id = String(payload.modelId ?? "pi-demo-1");
          if (savedConfig) savedConfig = { ...savedConfig, modelKey: `${provider}/${id}` };
          return ok({
            model: { provider, id, name: id },
            thinkingLevel: savedConfig?.thinking ?? "off",
          });
        }
        case "set_thinking":
          if (savedConfig) {
            savedConfig = { ...savedConfig, thinking: payload.level as AppConfig["thinking"] };
          }
          return ok({ level: payload.level });
        case "list_files":
          return Promise.resolve({
            id: `fake-${calls.length}`,
            type: "response",
            command: type,
            success: true,
            data: { files: options.files ?? FILES },
          });
        case "read_file": {
          const path = String(payload.path ?? "");
          const content = `// ${path}\n\nexport function hello() {\n  return "Hello from Pi Code";\n}\n\nconsole.log(hello());\n`;
          return ok({
            path,
            content,
            language: "typescript",
            size: content.length,
          });
        }
        case "git_status":
          return ok({
            branch: "main",
            changes: [
              { path: "src/main.ts", status: "M" },
              { path: "README.md", status: "??" },
            ],
          });
        case "get_diff":
          return ok({ path: String(payload.path ?? "src/main.ts"), patch: PATCH, language: "typescript" });
        case "shutdown":
          return ok({});
        default:
          return Promise.resolve({
            id: `fake-${calls.length}`,
            type: "response",
            command: type,
            success: false,
            error: `fake transport: unknown ${type}`,
          });
      }
    },
  };
}
