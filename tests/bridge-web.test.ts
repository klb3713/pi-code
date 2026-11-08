// Protocol/lifecycle tests for the browser WebSocket transport.
import { expect, test } from "nsh/test";
import {
  WebSocketBridgeTransport,
  type BridgeWebSocket,
  type BridgeWebSocketEvent,
} from "../app/bridge-web";
import type { BridgeEvent } from "../app/protocol";

class FakeSocket implements BridgeWebSocket {
  readyState = 0;
  onopen: ((event: BridgeWebSocketEvent) => void) | null = null;
  onmessage: ((event: BridgeWebSocketEvent) => void) | null = null;
  onerror: ((event: BridgeWebSocketEvent) => void) | null = null;
  onclose: ((event: BridgeWebSocketEvent) => void) | null = null;
  sent: string[] = [];
  closeCalls: { code?: number; reason?: string }[] = [];

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(record: unknown): void {
    this.onmessage?.({ data: JSON.stringify(record) });
  }

  serverClose(code = 1006, reason = "connection lost"): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  fail(message: string): void {
    this.onerror?.({ message });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? "" });
  }
}

function setup(): { transport: WebSocketBridgeTransport; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  const transport = new WebSocketBridgeTransport("ws://127.0.0.1:8787/bridge", () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
  return { transport, sockets };
}

test("web transport queues init until open, then resolves its response", async () => {
  const { transport, sockets } = setup();
  transport.start("/tmp/workspace", "demo");
  const socket = sockets[0]!;
  const request = transport.request("init", { workspace: "/tmp/workspace", mode: "demo" });
  expect(socket.sent).toEqual([]);

  socket.open();
  const sent = JSON.parse(socket.sent[0]!) as { id: string; type: string; workspace: string };
  expect(sent.type).toBe("init");
  expect(sent.workspace).toBe("/tmp/workspace");
  socket.receive({ id: sent.id, type: "response", command: "init", success: true, data: { demo: true } });
  await expect(request).resolves.toMatchObject({ success: true, data: { demo: true } });
  transport.stop(true);
});

test("web transport dispatches bridge events to listeners", () => {
  const { transport, sockets } = setup();
  const events: BridgeEvent[] = [];
  transport.onEvent((event) => events.push(event));
  transport.start("/tmp/workspace", "demo");
  sockets[0]!.open();
  sockets[0]!.receive({ type: "status", status: "starting", message: "正在启动 pi…" });
  expect(events).toEqual([{ type: "status", status: "starting", message: "正在启动 pi…" }]);
  transport.stop(true);
});

test("web transport rejects pending requests and reports an unexpected close", async () => {
  const { transport, sockets } = setup();
  const exits: { code?: number | null; error?: string | null }[] = [];
  transport.onExit((result) => exits.push(result));
  transport.start("/tmp/workspace", "demo");
  const request = transport.request("init", {});
  const socket = sockets[0]!;
  socket.fail("Connection refused");
  socket.serverClose(1006, "Connection refused");

  await expect(request).rejects.toThrow("Connection refused");
  expect(exits).toEqual([{ code: 1006, signal: null, error: "Connection refused" }]);
});

test("web transport ignores stale socket events after restart", async () => {
  const { transport, sockets } = setup();
  const exits: unknown[] = [];
  transport.onExit((result) => exits.push(result));
  transport.start("/tmp/old", "demo");
  const oldSocket = sockets[0]!;
  const oldRequest = transport.request("init", { workspace: "/tmp/old" });
  transport.stop(true);
  await expect(oldRequest).rejects.toThrow("transport stopped");

  transport.start("/tmp/new", "demo");
  const newSocket = sockets[1]!;
  const newRequest = transport.request("init", { workspace: "/tmp/new" });
  newSocket.open();
  const sent = JSON.parse(newSocket.sent[0]!) as { id: string };
  let settled = false;
  void newRequest.finally(() => {
    settled = true;
  });

  oldSocket.receive({ id: sent.id, type: "response", command: "init", success: false, error: "stale" });
  oldSocket.serverClose();
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(exits).toEqual([]);

  newSocket.receive({ id: sent.id, type: "response", command: "init", success: true, data: {} });
  await expect(newRequest).resolves.toMatchObject({ success: true });
  transport.stop(true);
});

test("web transport ignores non-object JSON frames without crashing", () => {
  const { transport, sockets } = setup();
  const events: BridgeEvent[] = [];
  transport.onEvent((event) => events.push(event));
  transport.start("/tmp/workspace", "demo");
  const socket = sockets[0]!;
  socket.open();
  expect(() => socket.receive(null)).not.toThrow();
  socket.receive([]);
  socket.receive("not a record");
  expect(events).toEqual([]);
  transport.stop(true);
});

test("web transport does not send a timed-out request when the socket eventually opens", async () => {
  const { transport, sockets } = setup();
  transport.start("/tmp/workspace", "demo");
  const request = transport.request("init", {}, 5);
  await expect(request).rejects.toThrow("超时");
  sockets[0]!.open();
  expect(sockets[0]!.sent).toEqual([]);
  transport.stop(true);
});

test("web transport stop sends shutdown only while open and rejects pending work", async () => {
  const { transport, sockets } = setup();
  transport.start("/tmp/workspace", "demo");
  const socket = sockets[0]!;
  socket.open();
  const request = transport.request("prompt", { message: "hello" });
  transport.stop();

  const shutdown = JSON.parse(socket.sent[1]!) as { id: string; type: string };
  expect(shutdown).toEqual({ id: "shutdown", type: "shutdown" });
  expect(socket.closeCalls).toEqual([{ code: 1000, reason: "Pi Code closed" }]);
  await expect(request).rejects.toThrow("transport stopped");
});
