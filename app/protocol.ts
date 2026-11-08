// Pi Code bridge protocol v1 — shared by the nsh app and the Node bridge.
// One JSON object per line over stdin/stdout. See docs/SPEC.md §3.

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type RunMode = "auto" | "demo" | "real";

export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

export interface UsageCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface UsageInfo {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: UsageCost;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type UiContent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | ({ type: "toolCall" } & ToolCallInfo);

export interface UiMessage {
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

export interface ReadyInfo {
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

export interface SessionInfo {
  id: string;
  path: string;
  name?: string;
  preview?: string;
  updatedAt: number;
  messageCount?: number;
}

export interface FileNode {
  id: string;
  name: string;
  kind: "dir" | "file";
  children?: FileNode[];
  size?: number;
}

export interface GitChange {
  path: string;
  status: string;
}

export interface GitStatusInfo {
  branch?: string;
  changes: GitChange[];
}

export interface DiffInfo {
  path: string;
  patch?: string;
  oldText?: string;
  newText?: string;
  language?: string;
  isBinary?: boolean;
}

export interface ReadFileInfo {
  path: string;
  content: string;
  language: string;
  size: number;
  truncated?: boolean;
}

export type BridgeRequest =
  | { id: string; type: "init"; workspace: string; mode: RunMode; dataDir?: string }
  | { id: string; type: "reconnect"; workspace: string; mode: RunMode; dataDir?: string }
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

export interface BridgeResponse {
  id: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export type BridgeEvent =
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
  | {
      type: "tool_end";
      toolCallId: string;
      toolName: string;
      resultText: string;
      isError: boolean;
      durationMs?: number;
    }
  | { type: "usage"; usage: UsageInfo }
  | { type: "turn_end" }
  | { type: "agent_end"; aborted?: boolean }
  | { type: "queue"; steering: string[]; followUp: string[] }
  | { type: "compaction"; phase: "start" | "end"; reason?: string }
  | { type: "session"; sessionId?: string; sessionPath?: string; sessionName?: string }
  | { type: "error"; message: string };

export function emptyUsage(): UsageInfo {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function normalizeUsage(value: unknown): UsageInfo {
  const v = (value ?? {}) as Partial<UsageInfo> & {
    cost?: Partial<UsageCost>;
  };
  const cost: Partial<UsageCost> = v.cost ?? {};
  return {
    input: Number(v.input ?? 0),
    output: Number(v.output ?? 0),
    cacheRead: Number(v.cacheRead ?? 0),
    cacheWrite: Number(v.cacheWrite ?? 0),
    totalTokens: Number(v.totalTokens ?? 0),
    cost: {
      input: Number(cost.input ?? 0),
      output: Number(cost.output ?? 0),
      cacheRead: Number(cost.cacheRead ?? 0),
      cacheWrite: Number(cost.cacheWrite ?? 0),
      total: Number(cost.total ?? 0),
    },
  };
}
