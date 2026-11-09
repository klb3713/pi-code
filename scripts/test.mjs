// Runs the nsh test suite with an isolated Pi Code config directory.
//
// Real-bridge tests spawn the bridge through nsh's process.spawn, which only
// forwards the *host* environment. `nsh test` inherits this process's env, so
// setting PI_CODE_CONFIG_DIR here keeps every test away from the developer's
// ~/.pi-code/config.json while still exercising the real bridge and pi.
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-code-test-config-"));
let exitCode = 1;
try {
  exitCode = await new Promise((resolve, reject) => {
    const child = spawn("nsh", ["test", ...process.argv.slice(2)], {
      stdio: "inherit",
      env: { ...process.env, PI_CODE_CONFIG_DIR: configDir },
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await fs.rm(configDir, { recursive: true, force: true }).catch(() => {});
}
process.exitCode = exitCode;
