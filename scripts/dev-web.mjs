#!/usr/bin/env node
// One foreground command owns both the loopback bridge and nsh's web dev host.
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startWebSocketBridge } from "../server/websocket-server.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BRIDGE_PORT = 8787;
const WEB_PORT = 8790;

async function checkWebPort() {
  // nsh run replaces its previous dev session at the chosen port. Refuse a
  // conflict first, so this launcher never intentionally takes over a session.
  // macOS can bind wildcard and loopback separately on the same port, so
  // checking only one address can miss an existing listener on the other.
  for (const host of ["127.0.0.1", "0.0.0.0"]) {
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
      probe.once("error", (error) => {
        if (error.code === "EADDRINUSE") {
          reject(new Error(`${WEB_PORT} 端口已被占用，请先停止已有 Web 服务后重试。`));
        } else reject(error);
      });
      probe.listen(WEB_PORT, host, resolve);
    });
    await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  }
}

async function main() {
  if (process.argv.length > 2) {
    throw new Error("一键启动使用固定端口 8787/8790，不接受额外参数；自定义启动请使用 bridge:web 和 dev:web:ui。");
  }
  let service;
  let ui;
  let uiClosed;
  let receivedSignal;
  let requestStop;
  const interrupted = new Promise((resolve) => { requestStop = resolve; });
  const onSignal = (signal) => {
    if (receivedSignal) return;
    receivedSignal = signal;
    requestStop({ interrupted: true });
  };
  const onInt = () => onSignal("SIGINT");
  const onTerm = () => onSignal("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);

  try {
    await checkWebPort();
    if (receivedSignal) return receivedSignal === "SIGINT" ? 130 : 143;
    try {
      service = await startWebSocketBridge({ port: BRIDGE_PORT, cwd: ROOT });
    } catch (error) {
      if (error.code === "EADDRINUSE") {
        throw new Error(`${BRIDGE_PORT} 端口已被占用，请先停止已有 bridge（例如另一个 bridge:web）后重试。`);
      }
      throw error;
    }
    if (receivedSignal) return receivedSignal === "SIGINT" ? 130 : 143;

    console.log(`[dev:web] Bridge 已启动：${service.url}`);
    console.log(`[dev:web] 正在启动 Web UI：http://127.0.0.1:${WEB_PORT}/`);
    console.log("[dev:web] 按 Ctrl+C 同时停止 Web UI 与 bridge。");
    ui = spawn("nsh", ["run", "App.tsx", "--target", "web", "--port", String(WEB_PORT)], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env },
    });
    uiClosed = new Promise((resolve) => {
      let launchError;
      ui.once("error", (error) => { launchError = error; });
      ui.once("close", (code, signal) => resolve({ code, signal, error: launchError }));
    });
    const result = await Promise.race([uiClosed, interrupted]);
    if (receivedSignal) return receivedSignal === "SIGINT" ? 130 : 143;
    if (result.error) {
      if (result.error.code === "ENOENT") throw new Error("找不到 nsh 命令，请安装 nsh CLI 并确认它在 PATH 中。");
      throw result.error;
    }
    return result.code ?? 1;
  } finally {
    // Stop only the child started by this launcher; never kill by port/name.
    let forceKill;
    if (ui?.pid && ui.exitCode === null && ui.signalCode === null) {
      ui.kill("SIGTERM");
      forceKill = setTimeout(() => ui.kill("SIGKILL"), 3500);
      forceKill.unref();
    }
    try {
      await Promise.all([uiClosed, service?.close()]);
    } finally {
      clearTimeout(forceKill);
      process.removeListener("SIGINT", onInt);
      process.removeListener("SIGTERM", onTerm);
    }
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`[dev:web] 启动失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
