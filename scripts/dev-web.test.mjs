// Launcher integration tests: real WS service + a small executable nsh fixture.
// The fixture replaces only the slow external UI host; process/port cleanup is real.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LAUNCHER = path.join(ROOT, "scripts", "dev-web.mjs");

async function assertPortFree(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => server.close(resolve));
}

async function fixture(t, mode = "wait") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-code-launcher-"));
  const executable = path.join(directory, "nsh");
  await fs.writeFile(executable, `#!/usr/bin/env node
import net from 'node:net';
const args = process.argv.slice(2);
if (JSON.stringify(args) !== JSON.stringify(['run','App.tsx','--target','web','--port','8790'])) process.exit(91);
const socket = net.connect(8787, '127.0.0.1');
socket.on('error', () => process.exit(92));
socket.on('connect', () => {
  socket.destroy();
  console.log('UI_READY:' + process.pid);
  if (process.env.PI_CODE_TEST_UI_MODE === 'exit') process.exit(7);
});
setInterval(() => {}, 1000);
process.on('SIGTERM', () => {
  if (process.env.PI_CODE_TEST_UI_MODE !== 'stubborn') process.exit(0);
});
`, { mode: 0o755 });
  const child = spawn(process.execPath, [LAUNCHER], {
    // Verify that the launcher finds the project independently of the caller's cwd.
    cwd: directory,
    env: { ...process.env, PATH: mode === "missing" ? path.join(directory, "empty-path") : `${directory}${path.delimiter}${process.env.PATH}`, PI_CODE_TEST_UI_MODE: mode },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const append = (chunk) => { output += chunk.toString(); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  let uiPid;
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await deadline(exited, 10000);
    }
    if (uiPid) { try { process.kill(uiPid, "SIGKILL"); } catch {} }
    const resolved = await fs.realpath(directory);
    const tempRoot = await fs.realpath(os.tmpdir());
    assert.equal(path.dirname(resolved), tempRoot);
    assert.ok(path.basename(resolved).startsWith("pi-code-launcher-"));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return {
    child, exited,
    output: () => output,
    async ready() {
      const result = await deadline(new Promise((resolve, reject) => {
        const inspect = () => {
          const match = output.match(/UI_READY:(\d+)/);
          if (match) { cleanup(); resolve(Number(match[1])); }
        };
        const failed = () => { cleanup(); reject(new Error(`Launcher exited before UI ready:\n${output}`)); };
        const cleanup = () => {
          child.stdout.off("data", inspect);
          child.off("exit", failed);
        };
        child.stdout.on("data", inspect);
        child.once("exit", failed);
        inspect();
      }), 12000);
      uiPid = result;
      return result;
    },
  };
}

async function deadline(promise, milliseconds = 12000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Launcher test timeout")), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function occupy(t, port) {
  const server = net.createServer((socket) => socket.end());
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server;
}

test("one command starts bridge before UI and Ctrl+C closes both", { timeout: 20000 }, async (t) => {
  const launched = await fixture(t);
  const pid = await launched.ready();
  launched.child.kill("SIGINT");
  const result = await deadline(launched.exited);
  assert.equal(result.code, 130, launched.output());
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  await assertPortFree(8787);
  await assertPortFree(8790);
});

test("UI exit code propagates and bridge is closed", { timeout: 20000 }, async (t) => {
  const launched = await fixture(t, "exit");
  const result = await deadline(launched.exited);
  assert.equal(result.code, 7, launched.output());
  await assertPortFree(8787);
});

test("missing nsh reports an actionable error and closes the bridge", { timeout: 20000 }, async (t) => {
  const launched = await fixture(t, "missing");
  const result = await deadline(launched.exited);
  assert.equal(result.code, 1, launched.output());
  assert.match(launched.output(), /找不到 nsh/);
  await assertPortFree(8787);
});

test("occupied UI port is reported without replacing its owner", { timeout: 20000 }, async (t) => {
  const owner = await occupy(t, 8790);
  const launched = await fixture(t);
  const result = await deadline(launched.exited);
  assert.equal(result.code, 1, launched.output());
  assert.match(launched.output(), /8790.*占用/);
  assert.doesNotMatch(launched.output(), /UI_READY/);
  assert.equal(owner.listening, true);
  await assertPortFree(8787);
});

test("occupied bridge port is reported without replacing its owner", { timeout: 20000 }, async (t) => {
  const owner = await occupy(t, 8787);
  const launched = await fixture(t);
  const result = await deadline(launched.exited);
  assert.equal(result.code, 1, launched.output());
  assert.match(launched.output(), /8787.*占用/);
  assert.doesNotMatch(launched.output(), /UI_READY/);
  assert.equal(owner.listening, true);
  await assertPortFree(8790);
});

test("shutdown escalates if the UI ignores SIGTERM", { timeout: 20000 }, async (t) => {
  const launched = await fixture(t, "stubborn");
  const pid = await launched.ready();
  launched.child.kill("SIGTERM");
  const result = await deadline(launched.exited);
  assert.equal(result.code, 143, launched.output());
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  await assertPortFree(8787);
});
