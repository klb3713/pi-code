#!/usr/bin/env node
// Pi Code bridge: one JSON object per line on stdin/stdout (docs/SPEC.md §3).
// stdout is reserved for protocol messages; all logging goes to stderr.

import { existsSync, readFileSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { startMockLlm } from "./mock-llm.mjs";
import {
  PI_VERSION,
  PiSession,
  isUsableModel,
  mapModel,
  normalizeMessage,
} from "./pi-session.mjs";
import {
  getDiff,
  gitStatus,
  listFiles,
  readFile,
  resolveWorkspace,
} from "./workspace.mjs";

// Never let a stray console.log corrupt the JSONL protocol.
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);

function log(message) {
  console.error(`[bridge] ${message}`);
}

function writeLine(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function emit(event) {
  writeLine(event);
}

function respond(id, command, success, data, error) {
  const response = { id, type: "response", command, success };
  if (data !== undefined) response.data = data;
  if (error !== undefined) response.error = String(error);
  writeLine(response);
}

const DEMO_MODEL_ID = "pi-demo-1";

function nowIso() {
  return new Date().toISOString();
}

class Bridge {
  constructor() {
    this.initialized = false;
    this.workspace = "";
    this.dataRoot = "";
    this.requestedMode = "auto";
    this.effectiveMode = "demo";
    this.pi = null;
    this.mock = null;
    this.demoAgentDir = "";
    this.gatewayInfo = null;
    this.promptInFlight = false;
    this.shuttingDown = false;
    this.readyInfo = null;
  }

  dataRootFor(dataDir) {
    if (typeof dataDir === "string" && dataDir.trim()) {
      return path.join(path.resolve(dataDir.trim()), "pi-code");
    }
    return path.join(os.homedir(), ".pi-code");
  }

  async ensureDirectories() {
    await fs.mkdir(path.join(this.dataRoot, "sessions"), { recursive: true });
  }

  makeSession(options) {
    const session = new PiSession({
      cwd: this.workspace,
      dataDir: this.dataRoot,
      demo: options.demo,
      agentDir: options.agentDir,
      provider: options.provider,
      model: options.model,
      noSession: Boolean(options.noSession),
      onEvent: (event) => this.handlePiEvent(event),
      onExit: (info) => {
        if (!this.shuttingDown) {
          log(`pi exited: code=${info.code} signal=${info.signal} error=${info.error ?? ""}`);
        }
      },
      onLog: (message) => log(`[pi] ${message}`),
    });
    return session;
  }

  handlePiEvent(event) {
    if (event.type === "status" && event.status === "exited" && this.promptInFlight) {
      // pi died mid-run: let the UI leave the busy state.
      this.promptInFlight = false;
      emit({ type: "agent_end", aborted: true });
    }
    if (event.type === "agent_end") this.promptInFlight = false;
    emit(event);
  }

  /** Stops the current pi process and mock LLM server (if any). */
  async stopRuntime() {
    if (this.pi) {
      const session = this.pi;
      this.pi = null;
      session.stop();
    }
    if (this.mock) {
      const mock = this.mock;
      this.mock = null;
      try {
        await mock.close();
      } catch (error) {
        log(`mock close failed: ${String(error)}`);
      }
    }
  }

  async startMockRuntime() {
    this.mock = await startMockLlm();
    this.demoAgentDir = path.join(this.dataRoot, "demo-agent");
    await fs.mkdir(this.demoAgentDir, { recursive: true });
    const models = {
      providers: {
        "pi-demo": {
          baseUrl: `${this.mock.url}/v1`,
          api: "openai-completions",
          apiKey: "pi-demo",
          compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
            supportsUsageInStreaming: false,
            supportsStrictMode: false,
          },
          models: [
            {
              id: DEMO_MODEL_ID,
              name: "Demo 模型",
              reasoning: false,
              input: ["text"],
              contextWindow: 128_000,
              maxTokens: 16_384,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    };
    await fs.writeFile(path.join(this.demoAgentDir, "models.json"), JSON.stringify(models, null, 2), "utf8");
    log(`demo mock LLM listening on ${this.mock.url}`);
  }

  async launchSession(demo, options = {}) {
    const session = this.makeSession({ demo, agentDir: this.demoAgentDir, ...options });
    this.pi = session;
    session.start();
    // A get_state round-trip proves the RPC child is actually responsive.
    await session.getState();
    return session;
  }

  async startDemoRuntime() {
    await this.startMockRuntime();
    await this.launchSession(true);
    this.effectiveMode = "demo";
  }

  async startRealRuntime(options = {}) {
    await this.launchSession(false, options);
    this.effectiveMode = "real";
  }

  /** OpenAI-compatible gateway configuration from the process environment. */
  gatewaySettings() {
    const baseUrl = String(process.env.OPENAI_BASE_URL ?? "").trim().replace(/\/+$/, "");
    if (!baseUrl) return null;
    return { baseUrl, apiKey: String(process.env.OPENAI_API_KEY ?? "").trim() };
  }

  /**
   * Fetches /models from the gateway, writes a pi models.json into an isolated
   * agent directory and returns the provider/model to launch.
   */
  async prepareGateway() {
    const settings = this.gatewaySettings();
    if (!settings) return null;
    const headers = { Accept: "application/json" };
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
    let payload;
    try {
      const response = await fetch(`${settings.baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload = await response.json();
    } catch (error) {
      throw new Error(
        `无法连接 OpenAI 兼容网关 ${settings.baseUrl}/models：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const rawModels = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : [];
    const models = rawModels
      .map((item) => {
        const id = String(item?.id ?? item?.name ?? "").trim();
        if (!id) return null;
        const contextWindow =
          Number(item?.context_window ?? item?.context_length ?? item?.max_input_tokens ?? 128_000) || 128_000;
        const maxTokens = Number(item?.max_output_tokens ?? item?.maxTokens ?? 16_384) || 16_384;
        const modalities = Array.isArray(item?.modalities?.input) ? item.modalities.input : null;
        const pricing = item?.pricing && typeof item.pricing === "object" ? item.pricing : {};
        const perMillion = (value) => {
          const n = Number(value);
          return Number.isFinite(n) ? n * 1_000_000 : 0;
        };
        return {
          id,
          name: String(item?.display_name ?? item?.name ?? id),
          reasoning: Boolean(item?.reasoning),
          input: modalities && modalities.includes("image") ? ["text", "image"] : ["text"],
          contextWindow,
          maxTokens,
          cost: {
            input: perMillion(pricing.prompt),
            output: perMillion(pricing.completion),
            cacheRead: perMillion(pricing.input_cache_read),
            cacheWrite: perMillion(pricing.input_cache_write),
          },
        };
      })
      .filter(Boolean)
      .slice(0, 100);
    if (models.length === 0) throw new Error(`${settings.baseUrl}/models 没有返回任何模型`);
    const configured = String(process.env.OPENAI_MODEL ?? "").trim();
    let defaultModel = models.find((model) => model.id === configured);
    if (!defaultModel && configured) {
      // A gateway may accept model IDs its /models endpoint does not list.
      defaultModel = {
        id: configured,
        name: configured,
        reasoning: true,
        input: ["text"],
        contextWindow: 128_000,
        maxTokens: 16_384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      };
      models.unshift(defaultModel);
    }
    defaultModel = defaultModel ?? models[0];
    const agentDir = path.join(this.dataRoot, "openai-gateway-agent");
    await fs.mkdir(agentDir, { recursive: true });
    const modelsJson = {
      providers: {
        "openai-gateway": {
          baseUrl: settings.baseUrl,
          api: "openai-completions",
          apiKey: settings.apiKey ? "OPENAI_API_KEY" : "none",
          compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: true,
            supportsStrictMode: false,
          },
          models,
        },
      },
    };
    await fs.writeFile(path.join(agentDir, "models.json"), JSON.stringify(modelsJson, null, 2), "utf8");
    log(`gateway: ${models.length} model(s) from ${settings.baseUrl}, default ${defaultModel.id}`);
    return {
      agentDir,
      provider: "openai-gateway",
      model: defaultModel.id,
      models,
      baseUrl: settings.baseUrl,
    };
  }

  hasRealCredentials() {
    const agentDir = path.join(os.homedir(), ".pi", "agent");
    try {
      const auth = JSON.parse(readFileSync(path.join(agentDir, "auth.json"), "utf8"));
      if (auth && typeof auth === "object" && Object.keys(auth).length > 0) return true;
    } catch {
      // missing / unreadable / empty auth.json means no real credentials
    }
    // Custom local providers (Ollama etc.) are configured without auth.
    if (existsSync(path.join(agentDir, "models.json"))) return true;
    const envKeys = [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GEMINI_API_KEY",
      "DEEPSEEK_API_KEY",
      "OPENROUTER_API_KEY",
      "GROQ_API_KEY",
      "XAI_API_KEY",
      "MISTRAL_API_KEY",
      "ZAI_API_KEY",
      "KIMI_API_KEY",
      "MINIMAX_API_KEY",
    ];
    return envKeys.some((key) => typeof process.env[key] === "string" && process.env[key].trim().length > 0);
  }

  /**
   * Boots (or reboots) the runtime for an init/reconnect request.
   * Auto mode probes pi's real model list first and falls back to demo.
   */
  async boot(workspace, dataDir, mode) {
    this.shuttingDown = false;
    this.promptInFlight = false;
    this.workspace = resolveWorkspace(workspace);
    await fs.mkdir(this.workspace, { recursive: true });
    this.dataRoot = this.dataRootFor(dataDir);
    this.requestedMode = mode;
    await this.ensureDirectories();

    emit({ type: "status", status: "starting", message: "正在启动 pi…" });
    await this.stopRuntime();
    this.effectiveMode = "demo";
    this.gatewayInfo = null;

    let realModels = [];
    let realState = null;
    let probe = null;
    const gatewaySettings = mode === "demo" ? null : this.gatewaySettings();
    let gateway = null;
    let gatewayStarted = false;
    if (gatewaySettings) {
      try {
        gateway = await this.prepareGateway();
        await this.startRealRuntime({
          agentDir: gateway.agentDir,
          provider: gateway.provider,
          model: gateway.model,
        });
        gatewayStarted = true;
        this.gatewayInfo = gateway;
        log(`real runtime: OpenAI gateway ${gateway.baseUrl}`);
      } catch (error) {
        gateway = null;
        log(`gateway unavailable: ${error instanceof Error ? error.message : String(error)}`);
        if (mode === "real") throw new Error(`无法使用 OpenAI 网关：${error instanceof Error ? error.message : String(error)}`);
        emit({ type: "status", status: "starting", message: "网关连接失败，已回退 Demo 模式" });
      }
    }
    const shouldProbe =
      !gatewaySettings && (mode === "real" || (mode === "auto" && this.hasRealCredentials()));
    if (!gatewayStarted && mode === "auto" && !shouldProbe && !gatewaySettings) {
      log("auto mode: no real credentials detected, using demo runtime");
    }
    if (!gatewayStarted && shouldProbe) {
      try {
        probe = this.makeSession({ demo: false, noSession: true });
        probe.start();
        realState = await probe.getState();
        realModels = await probe.getAvailableModels();
        const usable = realModels.filter((model) => isUsableModel(mapModel(model)));
        log(`real model probe: ${usable.length} model(s)`);
        if (mode === "real" || usable.length > 0) {
          this.effectiveMode = "real";
        }
      } catch (error) {
        log(`real model probe failed: ${error instanceof Error ? error.message : String(error)}`);
        if (mode === "real") {
          if (probe) {
            probe.stop();
            probe = null;
          }
          throw new Error(`无法启动真实模式：${error instanceof Error ? error.message : String(error)}`);
        }
      } finally {
        if (probe) {
          probe.stop();
          probe = null;
        }
      }
    }

    if (!gatewayStarted) {
      if (this.effectiveMode === "real") {
        // The probe ran with --no-session; open the real, persistent session now.
        await this.startRealRuntime();
      } else {
        await this.startDemoRuntime();
      }
    }

    const state = await this.pi.getState();
    const modelsRaw = await this.pi.getAvailableModels();
    let models = modelsRaw.map(mapModel).filter((model) => isUsableModel(model));
    if (this.gatewayInfo) {
      const gatewayModels = models.filter((model) => model.provider === this.gatewayInfo.provider);
      if (gatewayModels.length > 0) models = gatewayModels;
    }
    if (this.effectiveMode === "real" && models.length === 0) {
      this.initialized = false;
      await this.stopRuntime();
      throw new Error("真实模式下没有可用模型：请先在 pi 中配置 provider（~/.pi/agent/auth.json 或 models.json）");
    }
    const currentModel = mapModel(state.model);
    const branch = (await gitStatus(this.workspace)).branch;
    const ready = {
      workspace: this.workspace,
      mode: this.effectiveMode,
      demo: this.effectiveMode === "demo",
      piVersion: PI_VERSION,
      models,
      ...(currentModel && isUsableModel(currentModel) ? { currentModel } : {}),
      thinkingLevel: state.thinkingLevel ?? "off",
      ...(state.sessionId ? { sessionId: String(state.sessionId) } : {}),
      ...(state.sessionFile ? { sessionPath: String(state.sessionFile) } : {}),
      ...(branch ? { git: { branch } } : {}),
    };
    this.readyInfo = ready;
    this.initialized = true;
    emit({ type: "session", ...this.sessionFields(state) });
    emit({ type: "ready", data: ready });
    emit({ type: "status", status: "ready" });
    await this.emitHistory();
    return ready;
  }

  sessionFields(state) {
    const fields = {};
    if (state?.sessionId) fields.sessionId = String(state.sessionId);
    if (state?.sessionFile) fields.sessionPath = String(state.sessionFile);
    if (state?.sessionName) fields.sessionName = String(state.sessionName);
    return fields;
  }

  async emitHistory() {
    if (!this.pi) return;
    try {
      const messages = await this.pi.getMessages();
      const normalized = messages
        .map((message) => normalizeMessage(message, { maxTextLength: 20_000 }))
        .filter(Boolean);
      emit({ type: "history", messages: normalized });
    } catch (error) {
      log(`history failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  requireSession() {
    if (!this.pi || !this.initialized) {
      throw new Error("bridge 尚未初始化：请先发送 init 请求");
    }
    return this.pi;
  }

  async listSessions(limit) {
    const root = path.join(this.dataRoot, "sessions");
    const workspaceReal = await fs.realpath(this.workspace).catch(() => this.workspace);
    const files = [];
    async function walk(directory, depth) {
      if (depth > 4) return;
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(absolute, depth + 1);
        else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(absolute);
      }
    }
    await walk(root, 0);

    const sessions = [];
    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        const raw = await fs.readFile(file, "utf8");
        const lines = raw.split("\n").filter((line) => line.trim());
        if (lines.length === 0) continue;
        let header = null;
        let name;
        let preview;
        let messageCount = 0;
        for (const line of lines) {
          let entry;
          try {
            entry = JSON.parse(line);
          } catch {
            continue;
          }
          if (!header && entry.type === "session") {
            header = entry;
            continue;
          }
          if (entry.type === "session_info" && typeof entry.name === "string") name = entry.name;
          if (entry.type === "message" && entry.message) {
            const role = entry.message.role;
            if (role === "user" || role === "assistant") messageCount += 1;
            if (role === "user" && preview === undefined) {
              const content = entry.message.content;
              const text =
                typeof content === "string"
                  ? content
                  : Array.isArray(content)
                    ? content
                        .filter((block) => block && block.type === "text")
                        .map((block) => String(block.text ?? ""))
                        .join(" ")
                    : "";
              preview = text.trim().slice(0, 200) || undefined;
            }
          }
        }
        if (!header) continue;
        if (header.cwd) {
          const headerCwd = path.resolve(String(header.cwd));
          const headerReal = await fs.realpath(headerCwd).catch(() => headerCwd);
          if (headerReal !== workspaceReal) continue;
        }
        sessions.push({
          id: String(header.id ?? path.basename(file, ".jsonl")),
          path: file,
          ...(name ? { name } : {}),
          ...(preview ? { preview } : {}),
          updatedAt: Math.round(stat.mtimeMs),
          messageCount,
        });
      } catch (error) {
        log(`session parse failed ${file}: ${String(error)}`);
      }
    }
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    const max = Math.min(Math.max(Number(limit) || 30, 1), 100);
    return { sessions: sessions.slice(0, max) };
  }
}

const bridge = new Bridge();

const commands = {
  async init(request) {
    const ready = await bridge.boot(request.workspace, request.dataDir, normalizeMode(request.mode));
    return ready;
  },
  async reconnect(request) {
    const ready = await bridge.boot(request.workspace, request.dataDir, normalizeMode(request.mode));
    return ready;
  },
  async prompt(request) {
    const session = bridge.requireSession();
    if (bridge.promptInFlight) throw new Error("正在生成中，请先停止当前任务");
    const message = typeof request.message === "string" ? request.message.trim() : "";
    if (!message) throw new Error("消息不能为空");
    bridge.promptInFlight = true;
    try {
      await session.prompt(message);
    } catch (error) {
      bridge.promptInFlight = false;
      throw error;
    }
    return { accepted: true };
  },
  async abort() {
    const session = bridge.requireSession();
    await session.abort();
    return {};
  },
  async new_session() {
    const session = bridge.requireSession();
    await session.newSession();
    bridge.promptInFlight = false;
    const state = await session.getState();
    emit({ type: "session", ...bridge.sessionFields(state) });
    await bridge.emitHistory();
    return {};
  },
  async switch_session(request) {
    const session = bridge.requireSession();
    if (typeof request.sessionPath !== "string" || !request.sessionPath.trim()) {
      throw new Error("缺少 sessionPath");
    }
    await session.switchSession(request.sessionPath.trim());
    bridge.promptInFlight = false;
    const state = await session.getState();
    emit({ type: "session", ...bridge.sessionFields(state) });
    await bridge.emitHistory();
    return {};
  },
  async list_sessions(request) {
    bridge.requireSession();
    return bridge.listSessions(request.limit);
  },
  async set_model(request) {
    const session = bridge.requireSession();
    const provider = String(request.provider ?? "");
    const modelId = String(request.modelId ?? "");
    if (!provider || !modelId) throw new Error("缺少 provider 或 modelId");
    const model = await session.setModel(provider, modelId);
    const state = await session.getState();
    const mapped = mapModel(model) ?? mapModel(state.model);
    return { ...(mapped ? { model: mapped } : {}), thinkingLevel: state.thinkingLevel ?? "off" };
  },
  async get_state() {
    const session = bridge.requireSession();
    const state = await session.getState();
    const mapped = mapModel(state.model);
    return {
      isStreaming: Boolean(state.isStreaming),
      isCompacting: Boolean(state.isCompacting),
      thinkingLevel: state.thinkingLevel ?? "off",
      messageCount: Number(state.messageCount ?? 0),
      ...(mapped ? { model: mapped } : {}),
    };
  },
  async set_thinking(request) {
    const session = bridge.requireSession();
    const level = String(request.level ?? "");
    const result = await session.setThinking(level);
    return { level: result.level };
  },
  async list_files(request) {
    bridge.requireSession();
    const files = await listFiles(bridge.workspace, { maxDepth: request.maxDepth });
    return { files };
  },
  async read_file(request) {
    bridge.requireSession();
    return readFile(bridge.workspace, request.path);
  },
  async git_status() {
    bridge.requireSession();
    return gitStatus(bridge.workspace);
  },
  async get_diff(request) {
    bridge.requireSession();
    return getDiff(bridge.workspace, request.path);
  },
  async shutdown() {
    bridge.shuttingDown = true;
    setTimeout(() => {
      void (async () => {
        await bridge.stopRuntime();
        process.exit(0);
      })();
    }, 10);
    return {};
  },
};

function normalizeMode(mode) {
  return mode === "demo" || mode === "real" ? mode : "auto";
}

async function handleRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    emit({ type: "error", message: "无效请求：需要一个 JSON 对象" });
    return;
  }
  const id = typeof request.id === "string" && request.id ? request.id : "";
  const type = typeof request.type === "string" ? request.type : "";
  const handler = Object.hasOwn(commands, type) ? commands[type] : undefined;
  if (!handler) {
    respond(id, type || "unknown", false, undefined, `未知命令：${type || "(缺少 type)"}`);
    return;
  }
  if (!id) {
    emit({ type: "error", message: `请求缺少 id：${type}` });
    return;
  }
  try {
    const data = await handler(request);
    respond(id, type, true, data ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`${type} failed: ${message}`);
    if (type === "init" || type === "reconnect") {
      emit({ type: "status", status: "error", message });
    }
    respond(id, type, false, undefined, message);
  }
}

function attachStdin() {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const index = buffer.indexOf("\n");
      if (index < 0) break;
      let line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      let request;
      try {
        request = JSON.parse(line);
      } catch (error) {
        emit({ type: "error", message: `无效 JSON：${error instanceof Error ? error.message : String(error)}` });
        continue;
      }
      void handleRequest(request);
    }
  });
  process.stdin.on("end", () => {
    bridge.shuttingDown = true;
    void bridge.stopRuntime().finally(() => process.exit(0));
  });
  process.stdin.on("error", (error) => log(`stdin error: ${String(error)}`));
}

process.on("SIGTERM", () => {
  bridge.shuttingDown = true;
  void bridge.stopRuntime().finally(() => process.exit(0));
});
process.on("SIGINT", () => {
  bridge.shuttingDown = true;
  void bridge.stopRuntime().finally(() => process.exit(0));
});
process.on("uncaughtException", (error) => {
  log(`uncaught: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
});
process.on("unhandledRejection", (error) => {
  log(`unhandled rejection: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
});

log(`Pi Code bridge starting (pi ${PI_VERSION}, node ${process.version}, ${nowIso()})`);
attachStdin();
