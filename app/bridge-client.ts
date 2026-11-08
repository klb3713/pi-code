// Spawns `server/bridge.mjs` with node and speaks its JSONL protocol.
import process from "process";
import type { ChildProcess } from "process";
import type { BridgeEvent, BridgeRequest, BridgeResponse, RunMode } from "./protocol";
import { BRIDGE_PATH, DEFAULT_WORKSPACE, NODE_BIN } from "./local-config";

type EventListener = (event: BridgeEvent) => void;
type ExitListener = (result: { code?: number | null; signal?: string | null; error?: string | null }) => void;

interface Pending {
  resolve: (value: BridgeResponse) => void;
  reject: (error: Error) => void;
  timer: number;
}

export class BridgeClient {
  private child: ChildProcess | null = null;
  private buffer = "";
  private pending = new Map<string, Pending>();
  private eventListeners = new Set<EventListener>();
  private exitListeners = new Set<ExitListener>();
  private counter = 0;
  private stdoutLineCount = 0;

  get running(): boolean {
    return this.child !== null;
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onExit(listener: ExitListener): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  /** Starts (or restarts) the bridge process. Throws when spawn is refused. */
  start(workspace: string, mode: RunMode): void {
    this.stop(true);
    if (!BRIDGE_PATH) {
      throw new Error("BRIDGE_PATH 未配置：请先运行 `npm run setup`。");
    }
    // The bridge receives the workspace in its init request and creates it if
    // needed; the process itself only needs an existing cwd inside an fs grant.
    // Try the known directories in order: a test host's dataDir may not exist
    // yet, and a packaged app may have moved away from the source checkout.
    const candidates = [DEFAULT_WORKSPACE, process.dataDir, workspace].filter(
      (value): value is string => Boolean(value && value.trim()),
    );
    let child: ChildProcess | null = null;
    let lastError: unknown = new Error("没有可用的工作目录");
    for (const cwd of candidates) {
      try {
        child = process.spawn(NODE_BIN, [BRIDGE_PATH], {
          cwd,
          stdin: "pipe",
          lines: true,
        });
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!child) throw lastError;
    this.child = child;
    child.on("stdout", (line: string) => this.handleLine(line));
    child.on("stderr", (line: string) => {
      if (line.trim()) console.error(`[bridge] ${line}`);
    });
    child.on("exit", (result) => {
      this.child = null;
      this.rejectAll(new Error(`bridge exited (${result.code ?? result.signal ?? "unknown"})`));
      for (const listener of this.exitListeners) listener(result);
    });
  }

  /** Sends a request and resolves with its `response` record. */
  request(
    type: BridgeRequest["type"],
    payload: Record<string, unknown> = {},
    timeoutMs = 45_000,
  ): Promise<BridgeResponse> {
    if (!this.child) {
      return Promise.reject(new Error("bridge 未运行"));
    }
    const id = `req-${++this.counter}`;
    const request = { id, type, ...payload } as BridgeRequest;
    return new Promise<BridgeResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${type} 超时（${timeoutMs}ms）`));
      }, timeoutMs) as unknown as number;
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child!.write(JSON.stringify(request) + "\n");
      } catch (error) {
        clearTimeout(timer as unknown as Parameters<typeof clearTimeout>[0]);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Stops the bridge; `silent` skips the shutdown request (restart path). */
  stop(silent = false): void {
    const child = this.child;
    if (!child) return;
    this.child = null;
    try {
      if (!silent) child.write(JSON.stringify({ id: "shutdown", type: "shutdown" }) + "\n");
    } catch {
      // The child may already be gone.
    }
    try {
      child.end();
    } catch {
      // ignore
    }
    try {
      child.kill();
    } catch {
      // ignore
    }
    this.rejectAll(new Error("bridge stopped"));
    this.buffer = "";
  }

  private handleLine(line: string): void {
    this.stdoutLineCount += 1;
    const text = line.trim();
    if (!text) return;
    let record: BridgeResponse | BridgeEvent;
    try {
      record = JSON.parse(text) as BridgeResponse | BridgeEvent;
    } catch {
      console.error(`[bridge] bad JSON line: ${text.slice(0, 200)}`);
      return;
    }
    if ((record as BridgeResponse).type === "response") {
      const response = record as BridgeResponse;
      const pending = this.pending.get(response.id);
      if (pending) {
        clearTimeout(pending.timer as unknown as Parameters<typeof clearTimeout>[0]);
        this.pending.delete(response.id);
        pending.resolve(response);
      }
      return;
    }
    const event = record as BridgeEvent;
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(`[bridge] event listener failed: ${String(error)}`);
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer as unknown as Parameters<typeof clearTimeout>[0]);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export const bridge = new BridgeClient();
