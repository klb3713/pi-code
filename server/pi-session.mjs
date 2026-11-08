// Wraps a `pi --mode rpc` child process (pi-coding-agent 1.5.0) and converts
// its event stream into the Pi Code bridge protocol (docs/SPEC.md §3.3/§3.5).
//
// Wire size: pi's `message_update` events carry a cumulative `message` object
// and an `assistantMessageEvent.partial` copy of the whole message. Only the
// small deltas and the final `message_end` message cross the bridge boundary.
//
// Run lifecycle: `agent_end` ends one low-level agent run, but automatic
// retries, overflow recovery, compaction or queued work can still follow.
// `agent_settled` (pi >= 0.75) is the authoritative end of a session-level run,
// so the UI leaves its busy state on that event.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PI_PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))),
  "..",
);
const PI_BUNDLE_CLI_PATH = path.join(PI_PACKAGE_ROOT, "dist", "bundle", "cli.js");
const PI_SOURCE_CLI_PATH = path.join(PI_PACKAGE_ROOT, "dist", "cli.js");
// pi 1.x ships dist/bundle/cli.js (its `bin` entry); the older dist/cli.js is a
// thin shim that loads many modules. Prefer the bundle when it exists.
const PI_CLI_PATH = existsSync(PI_BUNDLE_CLI_PATH) ? PI_BUNDLE_CLI_PATH : PI_SOURCE_CLI_PATH;
const PI_VERSION = JSON.parse(readFileSync(path.join(PI_PACKAGE_ROOT, "package.json"), "utf8")).version;

export { PI_VERSION, PI_CLI_PATH };

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

/** How long `agent_end` waits for the authoritative `agent_settled`. */
const SETTLE_GUARD_MS = 2_000;

/**
 * Whether this pi release reports session-level run ends with `agent_settled`
 * (added in 0.75) instead of only the low-level `agent_end`.
 */
function settlesRuns(version) {
  const [major, minor] = String(version)
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  return major > 0 || (major === 0 && minor >= 75);
}

function numberOrUndefined(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function mapModel(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const model = {
    provider: String(raw.provider ?? "unknown"),
    id: String(raw.id ?? "unknown"),
    name: String(raw.name ?? raw.id ?? "unknown"),
  };
  const contextWindow = numberOrUndefined(raw.contextWindow);
  const maxTokens = numberOrUndefined(raw.maxTokens);
  if (contextWindow !== undefined) model.contextWindow = contextWindow;
  if (maxTokens !== undefined) model.maxTokens = maxTokens;
  if (raw.reasoning !== undefined) model.reasoning = Boolean(raw.reasoning);
  return model;
}

export function isUsableModel(model) {
  return Boolean(model && model.id && model.id !== "unknown" && model.provider !== "unknown");
}

export function normalizeUsage(raw) {
  const usage = raw && typeof raw === "object" ? raw : {};
  const cost = usage.cost && typeof usage.cost === "object" ? usage.cost : {};
  return {
    input: Number(usage.input ?? 0),
    output: Number(usage.output ?? 0),
    cacheRead: Number(usage.cacheRead ?? 0),
    cacheWrite: Number(usage.cacheWrite ?? 0),
    totalTokens: Number(usage.totalTokens ?? 0),
    cost: {
      input: Number(cost.input ?? 0),
      output: Number(cost.output ?? 0),
      cacheRead: Number(cost.cacheRead ?? 0),
      cacheWrite: Number(cost.cacheWrite ?? 0),
      total: Number(cost.total ?? 0),
    },
  };
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && typeof block === "object" && block.type === "text")
    .map((block) => String(block.text ?? ""))
    .join("");
}

/** Converts a pi AgentMessage into the protocol UiMessage shape. */
export function normalizeMessage(raw, options = {}) {
  if (!raw || typeof raw !== "object") return undefined;
  const role = raw.role;
  let uiRole;
  if (role === "user") uiRole = "user";
  else if (role === "assistant") uiRole = "assistant";
  else if (role === "toolResult") uiRole = "toolResult";
  else uiRole = "custom"; // bashExecution / custom / summary messages

  const content = [];
  if (typeof raw.content === "string") {
    content.push({ type: "text", text: raw.content });
  } else if (Array.isArray(raw.content)) {
    for (const block of raw.content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text") {
        content.push({ type: "text", text: String(block.text ?? "") });
      } else if (block.type === "thinking") {
        content.push({ type: "thinking", text: String(block.thinking ?? block.text ?? "") });
      } else if (block.type === "toolCall") {
        content.push({
          type: "toolCall",
          id: String(block.id ?? ""),
          name: String(block.name ?? "tool"),
          arguments: block.arguments && typeof block.arguments === "object" ? block.arguments : {},
        });
      } else if (block.type === "image") {
        content.push({ type: "text", text: "[图片]" });
      }
    }
  }
  if (uiRole === "custom" && content.length === 0 && typeof raw.summary === "string") {
    content.push({ type: "text", text: raw.summary });
  }

  const message = { role: uiRole, content };
  if (raw.timestamp !== undefined) message.timestamp = Number(raw.timestamp);
  if (raw.usage && typeof raw.usage === "object") message.usage = normalizeUsage(raw.usage);
  if (raw.stopReason !== undefined) message.stopReason = String(raw.stopReason);
  if (raw.errorMessage !== undefined) message.errorMessage = String(raw.errorMessage);
  if (raw.toolCallId !== undefined) message.toolCallId = String(raw.toolCallId);
  if (raw.toolName !== undefined) message.toolName = String(raw.toolName);
  if (raw.isError !== undefined) message.isError = Boolean(raw.isError);

  if (options.maxTextLength && options.maxTextLength > 0) {
    for (const block of content) {
      if (block.type === "text" && block.text.length > options.maxTextLength) {
        block.text = `${block.text.slice(0, options.maxTextLength)}\n…（已截断）`;
      }
    }
  }
  return message;
}

function normalizeToolCall(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? "tool"),
    arguments: raw.arguments && typeof raw.arguments === "object" ? raw.arguments : {},
  };
}

function createLineReader(stream, onLine) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    for (;;) {
      const index = buffer.indexOf("\n");
      if (index < 0) break;
      let line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.trim()) onLine(line);
    }
  });
  stream.on("end", () => {
    if (buffer.trim()) {
      const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
      onLine(line);
    }
    buffer = "";
  });
}

/**
 * A single pi RPC session process.
 *
 * Events are delivered through `onEvent(bridgeEvent)`; pi process exit through
 * `onExit({ code, signal, error })`.
 */
export class PiSession {
  constructor(options) {
    this.cwd = options.cwd;
    this.dataDir = options.dataDir;
    this.demo = Boolean(options.demo);
    this.provider = options.provider;
    this.model = options.model;
    this.agentDir = options.agentDir;
    this.noSession = Boolean(options.noSession);
    this.onEvent = options.onEvent ?? (() => {});
    this.onExit = options.onExit ?? (() => {});
    this.onLog = options.onLog ?? ((message) => console.error(`[pi] ${message}`));

    this.child = null;
    this.alive = false;
    this.exited = false;
    this.pending = new Map();
    this.nextRequestId = 1;
    this.aborted = false;
    this.settlesRuns = settlesRuns(PI_VERSION);
    this.settleGuard = null;
    this.runFinished = false;
    this.toolStartedAt = new Map();
    this.toolTextLength = new Map();
    this.stopping = false;
  }

  buildArgs() {
    const args = [
      PI_CLI_PATH,
      "--mode",
      "rpc",
      "--session-dir",
      path.join(this.dataDir, "sessions"),
      "--offline",
      "--no-extensions",
      "--no-themes",
      "--no-prompt-templates",
      "--no-skills",
    ];
    if (this.noSession) args.push("--no-session");
    if (this.demo) {
      args.push("--provider", this.provider ?? "pi-demo", "--model", this.model ?? "pi-demo-1");
    } else if (this.provider && this.model) {
      args.push("--provider", this.provider, "--model", this.model);
    }
    return args;
  }

  start() {
    if (this.child) throw new Error("pi session 已在运行");
    const env = { ...process.env };
    if (this.agentDir) {
      // Demo and OpenAI-gateway runtimes use an isolated pi agent directory.
      env.PI_CODING_AGENT_DIR = this.agentDir;
    } else {
      // Real mode must use pi's default agent directory (~/.pi/agent).
      delete env.PI_CODING_AGENT_DIR;
    }
    const child = spawn(process.execPath, this.buildArgs(), {
      cwd: this.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.alive = true;
    this.exited = false;

    createLineReader(child.stdout, (line) => this.handleLine(line));
    createLineReader(child.stderr, (line) => this.onLog(line));

    child.on("error", (error) => {
      this.onLog(`spawn failed: ${String(error)}`);
      this.finishExit({ code: null, signal: null, error: error instanceof Error ? error.message : String(error) });
    });
    child.on("exit", (code, signal) => {
      this.finishExit({ code, signal, error: null });
    });
    return this;
  }

  handleLine(line) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      this.onLog(`bad JSON from pi: ${line.slice(0, 300)}`);
      return;
    }
    if (!record || typeof record !== "object") return;

    if (record.type === "response") {
      const pending = this.pending.get(record.id);
      if (pending) {
        this.pending.delete(record.id);
        clearTimeout(pending.timer);
        pending.resolve(record);
      } else {
        this.onLog(`orphan pi response: ${String(record.command ?? "?")}`);
      }
      return;
    }

    if (record.type === "extension_ui_request") {
      // Pi Code has no UI for extension dialogs; cancel/ignore them so the
      // agent never blocks waiting for a response.
      if (["select", "confirm", "input", "editor"].includes(record.method)) {
        this.write({ type: "extension_ui_response", id: record.id, cancelled: true });
      }
      return;
    }

    if (record.type === "session") {
      // JSON-mode session header; RPC mode does not normally send this.
      return;
    }

    try {
      this.forwardEvent(record);
    } catch (error) {
      this.onLog(`event normalize failed: ${String(error)}`);
    }
  }

  forwardEvent(event) {
    switch (event.type) {
      case "agent_start": {
        this.aborted = false;
        this.runFinished = false;
        if (this.settleGuard) {
          clearTimeout(this.settleGuard);
          this.settleGuard = null;
        }
        this.emit({ type: "agent_start" });
        break;
      }
      case "message_start": {
        const message = normalizeMessage(event.message);
        if (message && (message.role === "user" || message.role === "assistant")) {
          this.emit({ type: "message_start", message });
        }
        break;
      }
      case "message_update": {
        const delta = event.assistantMessageEvent;
        if (!delta || typeof delta !== "object") break;
        if (delta.type === "text_delta" && typeof delta.delta === "string" && delta.delta.length > 0) {
          this.emit({
            type: "assistant_delta",
            contentIndex: Number(delta.contentIndex ?? 0),
            kind: "text",
            delta: delta.delta,
          });
        } else if (
          delta.type === "thinking_delta" &&
          typeof delta.delta === "string" &&
          delta.delta.length > 0
        ) {
          this.emit({
            type: "assistant_delta",
            contentIndex: Number(delta.contentIndex ?? 0),
            kind: "thinking",
            delta: delta.delta,
          });
        } else if (delta.type === "toolcall_end") {
          const toolCall = normalizeToolCall(delta.toolCall);
          if (toolCall && toolCall.id) {
            this.emit({
              type: "assistant_toolcall",
              contentIndex: Number(delta.contentIndex ?? 0),
              toolCall,
            });
          }
        }
        break;
      }
      case "message_end": {
        const message = normalizeMessage(event.message, { maxTextLength: 60_000 });
        if (!message) break;
        if (message.role === "user" || message.role === "assistant") {
          this.emit({ type: "message_end", message });
        }
        if (message.role === "assistant") {
          if (message.usage) this.emit({ type: "usage", usage: message.usage });
          if (message.stopReason === "aborted") this.aborted = true;
          if (message.errorMessage) this.emit({ type: "error", message: message.errorMessage });
        }
        break;
      }
      case "tool_execution_start": {
        const id = String(event.toolCallId ?? "");
        if (id) {
          this.toolStartedAt.set(id, Date.now());
          this.toolTextLength.set(id, 0);
        }
        this.emit({
          type: "tool_start",
          toolCallId: id,
          toolName: String(event.toolName ?? "tool"),
          args: event.args && typeof event.args === "object" ? event.args : {},
        });
        break;
      }
      case "tool_execution_update": {
        const id = String(event.toolCallId ?? "");
        const text = contentToText(event.partialResult?.content);
        const previousLength = this.toolTextLength.get(id) ?? 0;
        let delta = "";
        if (text.length > previousLength) {
          // partialResult is cumulative; send only the new suffix.
          delta = text.slice(previousLength);
          this.toolTextLength.set(id, text.length);
        }
        if (delta) this.emit({ type: "tool_update", toolCallId: id, text: delta });
        break;
      }
      case "tool_execution_end": {
        const id = String(event.toolCallId ?? "");
        const startedAt = this.toolStartedAt.get(id);
        this.toolStartedAt.delete(id);
        this.toolTextLength.delete(id);
        const resultText = contentToText(event.result?.content).slice(-40_000);
        // pi >= 1.1 measures execute() with a monotonic clock; prefer it.
        const reported = Number.isFinite(event.durationMs) ? Number(event.durationMs) : undefined;
        const durationMs = reported ?? (startedAt ? Math.max(0, Date.now() - startedAt) : undefined);
        this.emit({
          type: "tool_end",
          toolCallId: id,
          toolName: String(event.toolName ?? "tool"),
          resultText,
          isError: Boolean(event.isError),
          ...(durationMs === undefined ? {} : { durationMs }),
        });
        break;
      }
      case "turn_end": {
        this.emit({ type: "turn_end" });
        break;
      }
      case "agent_end": {
        if (Array.isArray(event.messages) && event.messages.some(
          (message) => message?.role === "assistant" && message?.stopReason === "aborted",
        )) {
          this.aborted = true;
        }
        // pi >= 0.75 follows a low-level run end with `agent_settled` once no
        // retry, compaction or queued work is left; the UI waits for that one
        // so a retried run does not flash "idle". Older releases only send
        // `agent_end`, so they report the run as finished right away.
        if (!this.settlesRuns) {
          this.finishRun();
          break;
        }
        // Safety net: if no `agent_settled` follows (an extension-driven run, or
        // a future protocol change), settle the run anyway so the UI never hangs.
        if (this.settleGuard) clearTimeout(this.settleGuard);
        this.settleGuard = setTimeout(() => this.finishRun(), SETTLE_GUARD_MS);
        this.settleGuard.unref?.();
        break;
      }
      case "agent_settled": {
        if (event.aborted) this.aborted = true;
        this.finishRun();
        break;
      }
      case "queue_update": {
        this.emit({
          type: "queue",
          steering: Array.isArray(event.steering) ? event.steering.map(String) : [],
          followUp: Array.isArray(event.followUp) ? event.followUp.map(String) : [],
        });
        break;
      }
      case "compaction_start": {
        this.emit({ type: "compaction", phase: "start", ...(event.reason ? { reason: String(event.reason) } : {}) });
        break;
      }
      case "compaction_end": {
        this.emit({ type: "compaction", phase: "end", ...(event.reason ? { reason: String(event.reason) } : {}) });
        break;
      }
      case "auto_retry_start": {
        this.onLog(`auto retry ${event.attempt}/${event.maxAttempts}: ${String(event.errorMessage ?? "")}`);
        break;
      }
      case "auto_retry_end": {
        if (!event.success && event.finalError) this.emit({ type: "error", message: String(event.finalError) });
        break;
      }
      case "extension_error": {
        this.emit({ type: "error", message: `扩展错误：${String(event.error ?? "unknown")}` });
        break;
      }
      default:
        // Unknown / noisy pi events are ignored on purpose.
        break;
    }
  }

  /**
   * Reports a finished session-level run exactly once.
   *
   * With pi >= 0.75 this runs on `agent_settled`; a guard timer after
   * `agent_end` covers a missing settle event.
   */
  finishRun() {
    if (this.runFinished) return;
    this.runFinished = true;
    if (this.settleGuard) {
      clearTimeout(this.settleGuard);
      this.settleGuard = null;
    }
    const aborted = this.aborted;
    this.aborted = false;
    this.emit({ type: "agent_end", ...(aborted ? { aborted: true } : {}) });
  }

  emit(event) {
    try {
      this.onEvent(event);
    } catch (error) {
      this.onLog(`onEvent failed: ${String(error)}`);
    }
  }

  write(record) {
    if (!this.child || !this.alive) throw new Error("pi 进程未运行");
    this.child.stdin.write(`${JSON.stringify(record)}\n`);
  }

  request(type, payload = {}, timeoutMs = 30_000) {
    if (!this.alive) return Promise.reject(new Error("pi 进程未运行"));
    const id = `pi-${++this.nextRequestId}`;
    const record = { id, type, ...payload };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`pi 命令 ${type} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write(record);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async prompt(message) {
    const response = await this.request("prompt", { message }, 20_000);
    if (!response.success) throw new Error(response.error ?? "prompt 失败");
    return { accepted: true };
  }

  /** Drops queued steering and follow-up messages, returning their text. */
  async clearQueue() {
    if (!this.alive) return { steering: [], followUp: [] };
    const response = await this.request("clear_queue", {}, 10_000);
    if (!response.success) throw new Error(response.error ?? "clear_queue 失败");
    const data = response.data ?? {};
    return {
      steering: Array.isArray(data.steering) ? data.steering.map(String) : [],
      followUp: Array.isArray(data.followUp) ? data.followUp.map(String) : [],
    };
  }

  /**
   * Stops the current run. Queued steering/follow-up messages are dropped
   * first (pi's own Esc behavior), so `abort` does not immediately continue
   * with whatever was queued.
   */
  async abort() {
    this.aborted = true;
    let cleared = null;
    try {
      cleared = await this.clearQueue();
    } catch (error) {
      this.onLog(`clear_queue failed: ${String(error)}`);
    }
    const response = await this.request("abort", {}, 15_000);
    if (!response.success) throw new Error(response.error ?? "abort 失败");
    return cleared ? { cleared } : {};
  }

  async newSession() {
    const response = await this.request("new_session", {}, 20_000);
    if (!response.success) throw new Error(response.error ?? "new_session 失败");
    return response.data ?? {};
  }

  async switchSession(sessionPath) {
    const response = await this.request("switch_session", { sessionPath }, 20_000);
    if (!response.success) throw new Error(response.error ?? "switch_session 失败");
    return response.data ?? {};
  }

  async setModel(provider, modelId) {
    const response = await this.request("set_model", { provider, modelId }, 20_000);
    if (!response.success) throw new Error(response.error ?? "set_model 失败");
    return response.data;
  }

  async setThinking(level) {
    if (!THINKING_LEVELS.has(level)) throw new Error(`无效的 thinking level: ${level}`);
    const response = await this.request("set_thinking_level", { level }, 15_000);
    if (!response.success) throw new Error(response.error ?? "set_thinking_level 失败");
    return { level };
  }

  async getState() {
    const response = await this.request("get_state", {}, 30_000);
    if (!response.success) throw new Error(response.error ?? "get_state 失败");
    return response.data ?? {};
  }

  async getAvailableModels() {
    const response = await this.request("get_available_models", {}, 20_000);
    if (!response.success) throw new Error(response.error ?? "get_available_models 失败");
    return Array.isArray(response.data?.models) ? response.data.models : [];
  }

  async getMessages() {
    const response = await this.request("get_messages", {}, 20_000);
    if (!response.success) throw new Error(response.error ?? "get_messages 失败");
    return Array.isArray(response.data?.messages) ? response.data.messages : [];
  }

  async getSessionStats() {
    const response = await this.request("get_session_stats", {}, 15_000);
    if (!response.success) throw new Error(response.error ?? "get_session_stats 失败");
    return response.data ?? {};
  }

  finishExit(info) {
    if (this.exited) return;
    this.exited = true;
    if (this.settleGuard) {
      clearTimeout(this.settleGuard);
      this.settleGuard = null;
    }
    this.alive = false;
    this.child = null;
    const error = info.error ? new Error(info.error) : new Error(`pi 进程已退出（${info.code ?? info.signal ?? "unknown"}）`);
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    if (this.stopping) return;
    this.emit({ type: "status", status: "exited", message: String(error.message) });
    try {
      this.onExit(info);
    } catch (exitError) {
      this.onLog(`onExit failed: ${String(exitError)}`);
    }
  }

  /** Gracefully closes pi: stdin EOF → SIGTERM → SIGKILL. */
  stop() {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    this.alive = false;
    this.child = null;
    try {
      child.stdin.end();
    } catch {
      // ignore
    }
    const term = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }, 1_200);
    const kill = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 3_000);
    term.unref?.();
    kill.unref?.();
    child.once("exit", () => {
      clearTimeout(term);
      clearTimeout(kill);
    });
  }
}
