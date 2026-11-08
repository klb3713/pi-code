// Browser transport: one WebSocket text frame per bridge protocol record.
// The local service in server/websocket-server.mjs owns the Node/pi processes.
import type { BridgeEvent, BridgeRequest, BridgeResponse, RunMode } from "./protocol";
import type { BridgeTransport } from "./store";

export const DEFAULT_WEB_BRIDGE_URL = "ws://127.0.0.1:8787/bridge";

export interface BridgeWebSocketEvent {
  data?: unknown;
  message?: string;
  code?: number;
  reason?: string;
}

/** The small browser WebSocket surface used by the transport (injectable in tests). */
export interface BridgeWebSocket {
  readonly readyState: number;
  onopen: ((event: BridgeWebSocketEvent) => void) | null;
  onmessage: ((event: BridgeWebSocketEvent) => void) | null;
  onerror: ((event: BridgeWebSocketEvent) => void) | null;
  onclose: ((event: BridgeWebSocketEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type EventListener = (event: BridgeEvent) => void;
type ExitListener = (result: { code?: number | null; signal?: string | null; error?: string | null }) => void;
type SocketFactory = (url: string) => BridgeWebSocket;

interface Pending {
  resolve: (value: BridgeResponse) => void;
  reject: (error: Error) => void;
  timer: number;
  serialized: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function browserSocket(url: string): BridgeWebSocket {
  return new WebSocket(url) as unknown as BridgeWebSocket;
}

export class WebSocketBridgeTransport implements BridgeTransport {
  private socket: BridgeWebSocket | null = null;
  private pending = new Map<string, Pending>();
  private eventListeners = new Set<EventListener>();
  private exitListeners = new Set<ExitListener>();
  private counter = 0;
  private connectionError = "";

  constructor(
    private readonly url = DEFAULT_WEB_BRIDGE_URL,
    private readonly createSocket: SocketFactory = browserSocket,
  ) {}

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onExit(listener: ExitListener): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  start(_workspace: string, _mode: RunMode): void {
    this.stop(true);
    const socket = this.createSocket(this.url);
    this.socket = socket;
    this.connectionError = "";

    socket.onopen = () => {
      if (this.socket !== socket) return;
      for (const [id, pending] of this.pending) this.sendPending(id, pending);
    };
    socket.onmessage = (event) => {
      if (this.socket === socket) this.handleMessage(event.data);
    };
    socket.onerror = (event) => {
      if (this.socket === socket) this.connectionError = event.message || "WebSocket 连接失败";
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      const message =
        this.connectionError || event.reason || `WebSocket 已断开（${event.code ?? 1006}）`;
      this.rejectAll(new Error(message));
      const result = { code: event.code ?? 1006, signal: null, error: message };
      for (const listener of this.exitListeners) listener(result);
    };
  }

  request(
    type: BridgeRequest["type"],
    payload: Record<string, unknown> = {},
    timeoutMs = 45_000,
  ): Promise<BridgeResponse> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error("bridge 未运行"));
    const id = `req-${++this.counter}`;
    const serialized = JSON.stringify({ id, type, ...payload });
    return new Promise<BridgeResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${type} 超时（${timeoutMs}ms）`));
      }, timeoutMs) as unknown as number;
      const pending: Pending = { resolve, reject, timer, serialized };
      this.pending.set(id, pending);
      if (socket.readyState === 1) this.sendPending(id, pending);
      else if (socket.readyState > 1) this.failPending(id, new Error("WebSocket 已关闭"));
    });
  }

  stop(silent = false): void {
    const socket = this.socket;
    this.socket = null;
    this.connectionError = "";
    if (socket) {
      try {
        if (!silent && socket.readyState === 1) {
          socket.send(JSON.stringify({ id: "shutdown", type: "shutdown" }));
        }
      } catch {
        // The peer may already be gone.
      }
      try {
        if (socket.readyState < 2) socket.close(1000, "Pi Code closed");
      } catch {
        // Closing an already closed socket is harmless.
      }
    }
    this.rejectAll(new Error("transport stopped"));
  }

  private sendPending(id: string, pending: Pending): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1 || !this.pending.has(id)) return;
    try {
      socket.send(pending.serialized);
    } catch (error) {
      this.failPending(id, new Error(errorMessage(error)));
    }
  }

  private failPending(id: string, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer as unknown as Parameters<typeof clearTimeout>[0]);
    pending.reject(error);
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") {
      console.error("[web-bridge] ignored a non-text frame");
      return;
    }
    let record: BridgeResponse | BridgeEvent;
    try {
      record = JSON.parse(data) as BridgeResponse | BridgeEvent;
    } catch {
      console.error(`[web-bridge] bad JSON frame: ${data.slice(0, 200)}`);
      return;
    }
    if (!record || typeof record !== "object" || Array.isArray(record) || typeof record.type !== "string") {
      return;
    }
    if ((record as BridgeResponse).type === "response") {
      const response = record as BridgeResponse;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      clearTimeout(pending.timer as unknown as Parameters<typeof clearTimeout>[0]);
      pending.resolve(response);
      return;
    }
    const event = record as BridgeEvent;
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(`[web-bridge] event listener failed: ${errorMessage(error)}`);
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer as unknown as Parameters<typeof clearTimeout>[0]);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export const webBridge = new WebSocketBridgeTransport();
