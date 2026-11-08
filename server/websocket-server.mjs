#!/usr/bin/env node
// Browser transport for Pi Code: one WebSocket text frame ↔ one bridge JSONL line.
// Each connection owns an independent bridge.mjs child and pi session.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import WebSocket, { WebSocketServer } from "ws";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BRIDGE_PATH = path.join(HERE, "bridge.mjs");
const DEFAULT_PORT = 8787;
const MAX_PAYLOAD = 1024 * 1024;

export const DEFAULT_ALLOWED_ORIGINS = [
  "http://127.0.0.1:8790",
  "http://localhost:8790",
];

function configuredOrigins() {
  const configured = String(process.env.PI_CODE_BRIDGE_ORIGINS ?? "").trim();
  if (!configured) return DEFAULT_ALLOWED_ORIGINS;
  return configured.split(",").map((origin) => origin.trim()).filter(Boolean);
}

function validPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`无效 WebSocket 端口：${value}`);
  }
  return port;
}

function cliOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--port") throw new Error(`未知参数：${argv[index]}`);
    const value = argv[++index];
    if (value === undefined) throw new Error("--port 缺少端口号");
    options.port = validPort(value);
  }
  return options;
}

/**
 * Starts the loopback-only WebSocket service.
 * `port: 0` chooses a free port, useful for tests.
 */
export async function startWebSocketBridge(options = {}) {
  const host = "127.0.0.1";
  const port = validPort(options.port ?? process.env.PI_CODE_BRIDGE_PORT ?? DEFAULT_PORT);
  const bridgePath = options.bridgePath ?? DEFAULT_BRIDGE_PATH;
  const allowedOrigins = new Set(options.allowedOrigins ?? configuredOrigins());
  const log = options.log ?? ((message) => console.error(`[web-bridge] ${message}`));
  const sessions = new Set();
  let closePromise = null;

  const server = new WebSocketServer({
    host,
    port,
    path: "/bridge",
    maxPayload: MAX_PAYLOAD,
    verifyClient(info, done) {
      // Browser WebSockets always send Origin. Native/Node local clients may not.
      const origin = info.origin ?? info.req.headers.origin;
      if (!origin || allowedOrigins.has(origin) || options.allowOrigin?.(origin) === true) {
        done(true);
        return;
      }
      log(`refused browser Origin: ${origin}`);
      done(false, 403, "Browser origin is not allowed");
    },
  });

  function stopSession(session) {
    if (session.stopping || session.child.exitCode !== null || session.child.signalCode !== null) return;
    session.stopping = true;
    // EOF lets bridge.mjs run its normal pi/mock shutdown path. Escalate only
    // if it does not exit, and retain the session until its stdio is closed.
    session.child.stdin.end();
    session.termTimer = setTimeout(() => session.child.kill("SIGTERM"), 1500);
    session.killTimer = setTimeout(() => session.child.kill("SIGKILL"), 3500);
    session.termTimer.unref();
    session.killTimer.unref();
  }

  server.on("connection", (socket) => {
    const child = spawn(process.execPath, [bridgePath], {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const session = { child, socket, stopping: false, termTimer: null, killTimer: null };
    session.closed = new Promise((resolve) => {
      child.once("close", () => {
        clearTimeout(session.termTimer);
        clearTimeout(session.killTimer);
        sessions.delete(session);
        resolve();
      });
    });
    sessions.add(session);
    let stdout = "";
    let closingFromPeer = false;

    function send(record) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(record));
    }

    function cleanup() {
      stopSession(session);
    }

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        send({ type: "error", message: "WebSocket 仅支持文本 JSON 消息" });
        return;
      }
      if (child.stdin.destroyed || child.stdin.writableEnded) return;
      const text = data.toString("utf8");
      if (!text.trim()) return;
      // Validate the whole frame, then reserialize it onto one JSONL line.
      // Pretty-printed JSON is allowed; multiple records in a frame are not.
      let request;
      try {
        request = JSON.parse(text);
      } catch (error) {
        send({ type: "error", message: `无效 JSON：每帧需要一条 JSON（${error.message}）` });
        return;
      }
      child.stdin.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("close", () => {
      closingFromPeer = true;
      cleanup();
    });
    socket.on("error", (error) => {
      log(`client error: ${error.message}`);
      cleanup();
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      for (;;) {
        const index = stdout.indexOf("\n");
        if (index < 0) break;
        const line = stdout.slice(0, index).replace(/\r$/, "");
        stdout = stdout.slice(index + 1);
        if (line.trim() && socket.readyState === WebSocket.OPEN) socket.send(line);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (options.verbose) log(`[bridge ${child.pid}] ${chunk.trimEnd()}`);
    });
    child.stdin.on("error", (error) => {
      if (!closingFromPeer) log(`bridge stdin failed: ${error.message}`);
    });
    child.on("error", (error) => {
      send({ type: "status", status: "error", message: `无法启动 bridge：${error.message}` });
      socket.close(1011, "Bridge launch failed");
    });
    // close, unlike exit, follows the last stdout chunk (including responses).
    child.on("close", (code, signal) => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(code === 0 ? 1000 : 1011, code === 0 ? "Bridge stopped" : "Bridge exited");
      }
      if (!closingFromPeer && code !== 0) {
        log(`bridge exited: code=${code ?? "null"} signal=${signal ?? "null"}`);
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const url = `ws://${host}:${actualPort}/bridge`;
  log(`listening on ${url}`);

  return {
    url,
    port: actualPort,
    close() {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        const active = Array.from(sessions);
        for (const session of active) {
          session.socket.terminate();
          stopSession(session);
        }
        await Promise.all([
          new Promise((resolve) => server.close(resolve)),
          ...active.map((session) => session.closed),
        ]);
      })();
      return closePromise;
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const options = cliOptions(process.argv.slice(2));
  const service = await startWebSocketBridge(options);
  console.log(`Pi Code WebSocket bridge: ${service.url}`);
  console.log(`Allowed origins: ${configuredOrigins().join(", ")}`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await service.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}
