// Application state for Pi Code. One reactive store, reduced from bridge events.
import { computed, signal, Storage } from "nsh";
import { isAvailable as isDesktop } from "nsh/desktop";
import process from "process";
import fs from "fs/promises";
import { bridge as realBridge } from "./bridge-client";
import { webBridge } from "./bridge-web";
import { DEFAULT_WORKSPACE } from "./local-config";
import {
  emptyUsage,
  normalizeUsage,
  type BridgeEvent,
  type BridgeRequest,
  type BridgeResponse,
  type DiffInfo,
  type FileNode,
  type GitStatusInfo,
  type ModelInfo,
  type ReadyInfo,
  type ReadFileInfo,
  type RunMode,
  type SessionInfo,
  type ThinkingLevel,
  type ToolCallInfo,
  type UiContent,
  type UiMessage,
  type UsageInfo,
} from "./protocol";

export type Phase = "booting" | "ready" | "error";
export type Connection = "connecting" | "connected" | "disconnected";
export type RightPanel = "files" | "changes";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: UiContent[];
  timestamp: number;
  usage?: UsageInfo;
  error?: string;
}

export interface StreamBlock {
  index: number;
  kind: "text" | "thinking";
  text: string;
}

export interface ActiveAssistant {
  blocks: StreamBlock[];
  toolCalls: ToolCallInfo[];
  startedAt: number;
}

export interface ToolRun {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  output: string;
  startedAt: number;
  durationMs?: number;
  isError?: boolean;
}

export interface ChangedFile {
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
}

export interface ToastInfo {
  id: number;
  text: string;
  tone: "info" | "success" | "error";
}

export interface SettingsState {
  workspace: string;
  mode: RunMode;
  modelKey: string;
  thinking: ThinkingLevel;
}

// ── signals ────────────────────────────────────────────────────────────────
export const phase = signal<Phase>("booting");
export const connection = signal<Connection>("connecting");
export const bootError = signal("");
const defaultWorkspace = DEFAULT_WORKSPACE || (isDesktop ? process.env.HOME : "") || "";
export const workspace = signal(defaultWorkspace);
export const runMode = signal<"demo" | "real">("demo");
export const piVersion = signal("");
export const models = signal<ModelInfo[]>([]);
export const model = signal<ModelInfo | undefined>(undefined);
export const thinking = signal<ThinkingLevel>("off");
export const messages = signal<ChatMessage[]>([]);
export const activeAssistant = signal<ActiveAssistant | null>(null);
export const tools = signal<Record<string, ToolRun>>({});
export const busy = signal(false);
export const usage = signal<UsageInfo>(emptyUsage());
export const files = signal<FileNode[]>([]);
export const git = signal<GitStatusInfo>({ changes: [] });
export const changedFiles = signal<ChangedFile[]>([]);
export const activeFile = signal<ReadFileInfo | null>(null);
export const activeDiff = signal<DiffInfo | null>(null);
export const rightPanel = signal<RightPanel>("files");
export const rightPanelOpen = signal(true);
export const sidebarOpen = signal(true);
export const settingsOpen = signal(false);
export const sessions = signal<SessionInfo[]>([]);
export const toast = signal<ToastInfo | null>(null);
export const sessionTitle = computed(() => {
  const list = messages();
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (message.role !== "user") continue;
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text.length > 36 ? `${text.slice(0, 35)}…` : text;
  }
  return "";
});

export const settings = signal<SettingsState>({
  workspace: defaultWorkspace,
  mode: "auto",
  modelKey: "",
  thinking: "off",
});

let idSeq = 0;
let toastSeq = 0;
let toastTimer: number | null = null;
let refreshTimer: number | null = null;
let booted = false;
const unsubs: (() => void)[] = [];

function uid(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq}`;
}

export function showToast(text: string, tone: ToastInfo["tone"] = "info"): void {
  toastSeq += 1;
  toast.set({ id: toastSeq, text, tone });
  if (toastTimer !== null) clearTimeout(toastTimer as unknown as Parameters<typeof clearTimeout>[0]);
  toastTimer = setTimeout(() => {
    toast.set(null);
    toastTimer = null;
  }, 3200) as unknown as number;
}

function contentText(content: UiContent[]): string {
  return content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("\n");
}

function normalizeContent(raw: unknown): UiContent[] {
  if (typeof raw === "string") return [{ type: "text", text: raw }];
  if (!Array.isArray(raw)) return [];
  const blocks: UiContent[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const block = entry as Record<string, unknown>;
    if (block.type === "text") {
      blocks.push({ type: "text", text: String(block.text ?? "") });
    } else if (block.type === "thinking") {
      blocks.push({ type: "thinking", text: String(block.thinking ?? block.text ?? "") });
    } else if (block.type === "toolCall") {
      blocks.push({
        type: "toolCall",
        id: String(block.id ?? uid("call")),
        name: String(block.name ?? "tool"),
        arguments: (block.arguments ?? {}) as Record<string, unknown>,
      });
    }
  }
  return blocks;
}

function normalizeMessage(raw: UiMessage): ChatMessage {
  return {
    id: uid(raw.role),
    role: raw.role === "user" ? "user" : raw.role === "assistant" ? "assistant" : "system",
    content: normalizeContent(raw.content),
    timestamp: Number(raw.timestamp ?? Date.now()),
    usage: raw.usage ? normalizeUsage(raw.usage) : undefined,
    error: raw.errorMessage,
  };
}

function appendSystem(text: string): void {
  messages.update((list) => [
    ...list,
    { id: uid("sys"), role: "system", content: [{ type: "text", text }], timestamp: Date.now() },
  ]);
}

function upsertChanged(path: string, status: string): void {
  changedFiles.update((list) => {
    const index = list.findIndex((item) => item.path === path);
    if (index >= 0) {
      const next = list.slice();
      next[index] = { ...next[index], status };
      return next;
    }
    return [...list, { path, status }];
  });
}

function ensureToolRun(toolCall: ToolCallInfo): void {
  tools.update((map) => {
    if (map[toolCall.id]) return map;
    return {
      ...map,
      [toolCall.id]: {
        id: toolCall.id,
        name: toolCall.name,
        args: toolCall.arguments,
        status: "running",
        output: "",
        startedAt: Date.now(),
      },
    };
  });
}

function toolPath(run: ToolRun): string | null {
  const raw = run.args.path ?? run.args.file_path ?? run.args.file;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function scheduleRefresh(): void {
  if (refreshTimer !== null) clearTimeout(refreshTimer as unknown as Parameters<typeof clearTimeout>[0]);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshFiles();
    void refreshGit();
  }, 500) as unknown as number;
}

// ── bridge wiring ──────────────────────────────────────────────────────────
export interface BridgeTransport {
  start(workspace: string, mode: RunMode): void;
  request(
    type: BridgeRequest["type"],
    payload?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<BridgeResponse>;
  onEvent(listener: (event: BridgeEvent) => void): () => void;
  onExit(listener: (result: { code?: number | null; signal?: string | null; error?: string | null }) => void): () => void;
  stop(silent?: boolean): void;
}

let transport: BridgeTransport = isDesktop ? realBridge : webBridge;

/** Test seam: swap the transport without spawning node. */
export function setTransport(next: BridgeTransport): void {
  transport = next;
}

export function applyEvent(event: BridgeEvent): void {
  switch (event.type) {
    case "ready": {
      applyReady(event.data);
      break;
    }
    case "status": {
      if (event.status === "error") {
        connection.set("disconnected");
        bootError.set(event.message ?? "bridge 启动失败");
        phase.set("error");
      } else if (event.status === "exited") {
        connection.set("disconnected");
      } else if (event.status === "starting") {
        connection.set("connecting");
      }
      break;
    }
    case "agent_start": {
      busy.set(true);
      break;
    }
    case "message_start": {
      if (event.message.role === "assistant") {
        activeAssistant.set({ blocks: [], toolCalls: [], startedAt: Date.now() });
      } else if (event.message.role === "user") {
        messages.update((list) => [...list, normalizeMessage(event.message)]);
      }
      break;
    }
    case "assistant_delta": {
      activeAssistant.update((active) => {
        const current = active ?? { blocks: [], toolCalls: [], startedAt: Date.now() };
        const blocks = current.blocks.slice();
        const index = blocks.findIndex((block) => block.index === event.contentIndex);
        if (index >= 0) {
          blocks[index] = { ...blocks[index], text: blocks[index].text + event.delta };
        } else {
          blocks.push({ index: event.contentIndex, kind: event.kind, text: event.delta });
        }
        return { ...current, blocks };
      });
      break;
    }
    case "assistant_toolcall": {
      activeAssistant.update((active) => {
        const current = active ?? { blocks: [], toolCalls: [], startedAt: Date.now() };
        const toolCalls = current.toolCalls.some((call) => call.id === event.toolCall.id)
          ? current.toolCalls
          : [...current.toolCalls, event.toolCall];
        return { ...current, toolCalls };
      });
      ensureToolRun(event.toolCall);
      break;
    }
    case "message_end": {
      const message = normalizeMessage(event.message);
      if (event.message.role === "user") {
        const list = messages();
        const last = list[list.length - 1];
        const alreadyShown =
          last?.role === "user" &&
          JSON.stringify(last.content) === JSON.stringify(message.content);
        if (!alreadyShown) messages.update((current) => [...current, message]);
      } else if (event.message.role === "assistant") {
        messages.update((list) => [...list, message]);
        activeAssistant.set(null);
        if (message.usage) usage.set(message.usage);
      }
      break;
    }
    case "history": {
      loadHistory(event.messages);
      break;
    }
    case "tool_start": {
      tools.update((map) => ({
        ...map,
        [event.toolCallId]: {
          id: event.toolCallId,
          name: event.toolName,
          args: event.args,
          status: "running",
          output: map[event.toolCallId]?.output ?? "",
          startedAt: map[event.toolCallId]?.startedAt ?? Date.now(),
        },
      }));
      break;
    }
    case "tool_update": {
      tools.update((map) => {
        const run = map[event.toolCallId];
        if (!run) return map;
        const output = (run.output + event.text).slice(-40_000);
        return { ...map, [event.toolCallId]: { ...run, output } };
      });
      break;
    }
    case "tool_end": {
      const endedAt = Date.now();
      let completed: ToolRun | undefined;
      tools.update((map) => {
        const run = map[event.toolCallId];
        if (!run) return map;
        completed = {
          ...run,
          status: event.isError ? "error" : "done",
          output: event.resultText || run.output,
          durationMs: event.durationMs ?? endedAt - run.startedAt,
          isError: event.isError,
        };
        return { ...map, [event.toolCallId]: completed };
      });
      if (completed && !event.isError && (completed.name === "write" || completed.name === "edit")) {
        const path = toolPath(completed);
        if (path) upsertChanged(path, completed.name === "write" ? "A" : "M");
        scheduleRefresh();
      } else if (completed && !event.isError && completed.name === "bash") {
        scheduleRefresh();
      }
      break;
    }
    case "usage": {
      usage.set(normalizeUsage(event.usage));
      break;
    }
    case "agent_end": {
      busy.set(false);
      activeAssistant.set(null);
      if (event.aborted) appendSystem("已停止生成。");
      scheduleRefresh();
      void refreshSessions();
      break;
    }
    case "error": {
      busy.set(false);
      appendSystem(`错误：${event.message}`);
      showToast(event.message, "error");
      break;
    }
    case "session": {
      if (event.sessionId) {
        sessions.update((list) => {
          if (list.some((item) => item.id === event.sessionId)) return list;
          return list;
        });
      }
      break;
    }
    case "compaction": {
      if (event.phase === "start") showToast("正在压缩上下文…");
      if (event.phase === "end") showToast("上下文压缩完成", "success");
      break;
    }
    default:
      break;
  }
}

function loadHistory(history: UiMessage[]): void {
  const built: ChatMessage[] = [];
  const toolMap: Record<string, ToolRun> = {};
  const results = new Map<string, { text: string; isError: boolean }>();
  for (const message of history) {
    if (message.role === "toolResult" && message.toolCallId) {
      results.set(message.toolCallId, {
        text: contentText(normalizeContent(message.content)),
        isError: Boolean(message.isError),
      });
    }
  }
  for (const message of history) {
    if (message.role === "toolResult") continue;
    const normalized = normalizeMessage(message);
    built.push(normalized);
    for (const block of normalized.content) {
      if (block.type === "toolCall") {
        const result = results.get(block.id);
        toolMap[block.id] = {
          id: block.id,
          name: block.name,
          args: block.arguments,
          status: result ? (result.isError ? "error" : "done") : "done",
          output: result?.text ?? "",
          startedAt: normalized.timestamp,
          isError: result?.isError,
        };
      }
    }
  }
  messages.set(built);
  tools.set(toolMap);
  activeAssistant.set(null);
  busy.set(false);
}

function applyReady(info: ReadyInfo): void {
  workspace.set(info.workspace);
  runMode.set(info.mode);
  piVersion.set(info.piVersion);
  models.set(info.models ?? []);
  model.set(info.currentModel);
  thinking.set(info.thinkingLevel ?? "off");
  connection.set("connected");
  phase.set("ready");
  bootError.set("");
  settings.update((current) => ({
    ...current,
    workspace: info.workspace,
    mode: info.mode === "demo" ? "demo" : current.mode,
    modelKey: info.currentModel ? `${info.currentModel.provider}/${info.currentModel.id}` : current.modelKey,
    thinking: info.thinkingLevel ?? current.thinking,
  }));
  if (info.git?.branch) git.update((current) => ({ ...current, branch: info.git?.branch }));
  if (info.sessionId) {
    sessions.update((list) => list);
  }
}

async function boot(ws: string, mode: RunMode, clear = true): Promise<void> {
  phase.set("booting");
  connection.set("connecting");
  bootError.set("");
  if (clear) {
    messages.set([]);
    activeAssistant.set(null);
    tools.set({});
    usage.set(emptyUsage());
    changedFiles.set([]);
    files.set([]);
    activeFile.set(null);
    activeDiff.set(null);
    sessions.set([]);
    busy.set(false);
  }
  try {
    transport.start(ws, mode);
    const response = await transport.request(
      "init",
      // The browser's /app-data is OPFS, not an absolute path on the Node host.
      { workspace: ws, mode, dataDir: isDesktop ? process.dataDir ?? "" : "" },
      120_000,
    );
    if (!response.success) throw new Error(response.error ?? "bridge init 失败");
    if (response.data) applyReady(response.data as ReadyInfo);
    await actions.refreshAll();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    connection.set("disconnected");
    phase.set("error");
    bootError.set(message);
  }
}

/** Boots the app once: restores settings and starts the bridge. */
export async function bootstrap(): Promise<void> {
  if (booted) return;
  booted = true;
  unsubs.push(
    transport.onEvent((event) => {
      try {
        applyEvent(event);
      } catch (error) {
        console.error(`[store] event failed: ${String(error)}`);
      }
    }),
  );
  unsubs.push(
    transport.onExit((result) => {
      if (phase() === "ready") {
        connection.set("disconnected");
        showToast(`pi 进程已退出（${result.code ?? result.signal ?? "unknown"}）`, "error");
      }
    }),
  );
  const storedWorkspace = await Storage.getItem("pi-code.workspace").catch(() => null);
  const storedMode = (await Storage.getItem("pi-code.mode").catch(() => null)) as RunMode | null;
  const storedThinking = (await Storage.getItem("pi-code.thinking").catch(() => null)) as ThinkingLevel | null;
  const storedModel = await Storage.getItem("pi-code.model").catch(() => null);
  let ws = storedWorkspace || defaultWorkspace;
  // Browser fs is OPFS, not the Node host's filesystem. Validate it in the bridge.
  if (isDesktop && storedWorkspace && storedWorkspace !== DEFAULT_WORKSPACE) {
    const stillThere = await fs.exists(storedWorkspace).catch(() => false);
    if (!stillThere) ws = defaultWorkspace;
  }
  const mode: RunMode = storedMode === "demo" || storedMode === "real" ? storedMode : "auto";
  settings.set({ ...settings(), workspace: ws, mode, thinking: storedThinking ?? "off", modelKey: storedModel ?? "" });
  await boot(ws, mode);
  if (storedModel && phase() === "ready") {
    const [provider, ...rest] = storedModel.split("/");
    const modelId = rest.join("/");
    if (provider && modelId && models().some((item) => item.provider === provider && item.id === modelId)) {
      await actions.setModel(provider, modelId);
    }
  }
  if (storedThinking && phase() === "ready" && storedThinking !== thinking()) {
    await actions.setThinking(storedThinking);
  }
}

/** Exposed for tests and the settings dialog. */
export async function reconnect(ws: string, mode: RunMode): Promise<void> {
  await boot(ws, mode, true);
}

export function shutdown(): void {
  for (const unsubscribe of unsubs) unsubscribe();
  unsubs.length = 0;
  transport.stop();
}

// ── actions ────────────────────────────────────────────────────────────────
export const actions = {
  async send(text: string): Promise<void> {
    const message = text.trim();
    if (!message) return;
    if (phase() !== "ready") {
      showToast("尚未连接 pi，请稍候", "error");
      return;
    }
    if (busy()) {
      showToast("正在生成，请先停止", "info");
      return;
    }
    busy.set(true);
    try {
      const response = await transport.request("prompt", { message }, 20_000);
      if (!response.success) {
        busy.set(false);
        appendSystem(`错误：${response.error ?? "发送失败"}`);
      }
    } catch (error) {
      busy.set(false);
      appendSystem(`错误：${error instanceof Error ? error.message : String(error)}`);
    }
  },

  async stop(): Promise<void> {
    if (!busy()) return;
    try {
      await transport.request("abort", {}, 15_000);
      busy.set(false);
      showToast("已停止", "info");
    } catch (error) {
      showToast(`停止失败：${String(error)}`, "error");
    }
  },

  async newSession(): Promise<void> {
    try {
      await transport.request("new_session", {}, 20_000);
      messages.set([]);
      activeAssistant.set(null);
      tools.set({});
      usage.set(emptyUsage());
      changedFiles.set([]);
      activeFile.set(null);
      activeDiff.set(null);
      showToast("已新建会话", "success");
      await refreshSessions();
    } catch (error) {
      showToast(`新建会话失败：${String(error)}`, "error");
    }
  },

  async switchSession(sessionPath: string): Promise<void> {
    try {
      await transport.request("switch_session", { sessionPath }, 20_000);
      showToast("已切换会话", "success");
      await refreshSessions();
    } catch (error) {
      showToast(`切换会话失败：${String(error)}`, "error");
    }
  },

  async setModel(provider: string, modelId: string): Promise<void> {
    try {
      const response = await transport.request("set_model", { provider, modelId }, 20_000);
      if (!response.success) throw new Error(response.error ?? "设置模型失败");
      const data = response.data as { model?: ModelInfo; thinkingLevel?: ThinkingLevel } | undefined;
      if (data?.model) model.set(data.model);
      showToast(`已切换到 ${data?.model?.name ?? modelId}`, "success");
      await Storage.setItem("pi-code.model", `${provider}/${modelId}`).catch(() => {});
    } catch (error) {
      showToast(`设置模型失败：${String(error)}`, "error");
    }
  },

  async setThinking(level: ThinkingLevel): Promise<void> {
    try {
      await transport.request("set_thinking", { level }, 15_000);
      thinking.set(level);
      settings.update((current) => ({ ...current, thinking: level }));
      await Storage.setItem("pi-code.thinking", level).catch(() => {});
      showToast(`思考级别：${level}`, "success");
    } catch (error) {
      showToast(`设置思考级别失败：${String(error)}`, "error");
    }
  },

  async applySettings(): Promise<void> {
    const next = settings();
    await Storage.setItem("pi-code.workspace", next.workspace).catch(() => {});
    await Storage.setItem("pi-code.mode", next.mode).catch(() => {});
    await Storage.setItem("pi-code.thinking", next.thinking).catch(() => {});
    if (next.modelKey) await Storage.setItem("pi-code.model", next.modelKey).catch(() => {});
    const workspaceChanged = next.workspace !== workspace();
    const modeChanged = (next.mode === "demo" && runMode() !== "demo") || (next.mode === "real" && runMode() !== "real");
    settingsOpen.set(false);
    if (workspaceChanged || modeChanged) {
      await reconnect(next.workspace, next.mode);
      if (phase() === "ready") showToast("工作区已连接", "success");
    }
    const currentKey = model() ? `${model()!.provider}/${model()!.id}` : "";
    if (phase() === "ready" && next.modelKey && next.modelKey !== currentKey) {
      const known = models().some((item) => `${item.provider}/${item.id}` === next.modelKey);
      if (known) {
        const [provider, ...rest] = next.modelKey.split("/");
        await actions.setModel(provider, rest.join("/"));
      }
    }
    if (next.thinking !== thinking()) await actions.setThinking(next.thinking);
  },

  async refreshFiles(): Promise<void> {
    try {
      const response = await transport.request("list_files", { maxDepth: 6 }, 20_000);
      if (response.success) {
        const data = response.data as { files?: FileNode[] } | undefined;
        files.set(data?.files ?? []);
      }
    } catch {
      // Non-fatal: the panel simply stays as it was.
    }
  },

  async refreshGit(): Promise<void> {
    try {
      const response = await transport.request("git_status", {}, 15_000);
      if (!response.success) return;
      const data = response.data as GitStatusInfo | undefined;
      if (!data) return;
      git.set(data);
      for (const change of data.changes ?? []) {
        // Untracked directories (`?? dir/`) cannot be diffed as files.
        if (change.path.endsWith("/")) continue;
        let status = change.status.trim();
        if (status === "??") status = "A";
        else if (status.length > 1) status = status[0];
        upsertChanged(change.path, status);
      }
      await enrichChangeStats();
    } catch {
      // Non-fatal.
    }
  },

  async refreshSessions(): Promise<void> {
    try {
      const response = await transport.request("list_sessions", { limit: 30 }, 15_000);
      if (response.success) {
        const data = response.data as { sessions?: SessionInfo[] } | undefined;
        sessions.set(data?.sessions ?? []);
      }
    } catch {
      // Non-fatal.
    }
  },

  async openFile(path: string): Promise<void> {
    rightPanel.set("files");
    rightPanelOpen.set(true);
    try {
      const response = await transport.request("read_file", { path }, 15_000);
      if (!response.success) throw new Error(response.error ?? "读取失败");
      activeDiff.set(null);
      activeFile.set(response.data as ReadFileInfo);
    } catch (error) {
      showToast(`读取文件失败：${String(error)}`, "error");
    }
  },

  async openDiff(path: string): Promise<void> {
    rightPanel.set("changes");
    rightPanelOpen.set(true);
    try {
      const response = await transport.request("get_diff", { path }, 15_000);
      if (!response.success) throw new Error(response.error ?? "读取差异失败");
      activeFile.set(null);
      activeDiff.set(response.data as DiffInfo);
    } catch (error) {
      showToast(`读取差异失败：${String(error)}`, "error");
    }
  },

  togglePanel(panel: RightPanel): void {
    if (rightPanel() === panel && rightPanelOpen()) {
      rightPanelOpen.set(false);
    } else {
      rightPanel.set(panel);
      rightPanelOpen.set(true);
    }
  },

  async refreshAll(): Promise<void> {
    await Promise.all([refreshFiles(), refreshGit(), refreshSessions()]);
  },
};

async function refreshFiles(): Promise<void> {
  await actions.refreshFiles();
}

async function refreshGit(): Promise<void> {
  await actions.refreshGit();
}

async function refreshSessions(): Promise<void> {
  await actions.refreshSessions();
}

/** Fills +/− counts on the change list (serial, capped). */
async function enrichChangeStats(): Promise<void> {
  const list = changedFiles().slice(0, 24);
  for (const item of list) {
    try {
      const response = await transport.request("get_diff", { path: item.path }, 10_000);
      if (!response.success) continue;
      const diff = response.data as DiffInfo | undefined;
      const stats = countPatch(diff?.patch);
      if (stats) {
        changedFiles.update((current) =>
          current.map((entry) =>
            entry.path === item.path ? { ...entry, additions: stats.additions, deletions: stats.deletions } : entry,
          ),
        );
      }
    } catch {
      // ignore one file
    }
  }
}

export function countPatch(patch?: string): { additions: number; deletions: number } | null {
  if (!patch) return null;
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}
