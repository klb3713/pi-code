// Drive real nsh hosts. Browser tests use ephemeral page origins, so only this
// short-lived test service accepts HTTP loopback origins with arbitrary ports.
// The normal CLI service keeps its exact Origin allowlist.
import { spawn } from "node:child_process";
import { startWebSocketBridge } from "./websocket-server.mjs";

const target = process.argv[2] ?? "web";
if (target !== "web" && target !== "macos") throw new Error(`Unsupported test target: ${target}`);
let service;
let child;
let stopping = false;

try {
  if (target === "web") {
    service = await startWebSocketBridge({
      port: 8787,
      allowOrigin(origin) {
        try {
          const url = new URL(origin);
          return url.origin === origin && url.protocol === "http:" &&
            (url.hostname === "127.0.0.1" || url.hostname === "localhost");
        } catch {
          return false;
        }
      },
    });
  }
  child = spawn("nsh", ["test", "tests/platform-bootstrap.test.tsx", "--target", target], {
    stdio: "inherit",
  });
  const stop = () => {
    stopping = true;
    child.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
    process.exitCode = stopping ? 130 : code;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
} finally {
  await service?.close();
}
