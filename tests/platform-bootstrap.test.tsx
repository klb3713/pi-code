// Real app launch: native uses stdio; --target web must use WebSocket.
// `npm run test:web` starts a loopback-only service for the browser test.
//
// `npm test` isolates PI_CODE_CONFIG_DIR; a bare `nsh test` would use the
// developer's own config, so the demo check below fails instead of silently
// connecting to a real gateway.
import { expect, open, test, type App } from "nsh/test";
import { DEFAULT_WORKSPACE } from "../app/local-config";

function hasText(app: App, text: string): boolean {
  return app.texts().some((value) => value.includes(text));
}

test("platform bootstrap connects the real bridge", async () => {
  const app = await open("../App.tsx", {
    platform: "macos",
    width: 1440,
    height: 900,
    network: "live",
    storage: { "pi-code.workspace": DEFAULT_WORKSPACE, "pi-code.mode": "demo" },
  });
  await app.waitUntil(
    () => app.texts().some((text) => text.includes("pi 已连接")) || app.texts().includes("连接失败"),
    { timeout: 60000 },
  );
  expect(app.texts()).not.toContain("连接失败");
  expect(app.texts()).toContain("pi 已连接");
  expect(app.texts()).toContain(DEFAULT_WORKSPACE);
  if (!hasText(app, "DEMO")) {
    throw new Error(
      "真实 bridge 测试需要 Demo 模式：请用 `npm test`（隔离 ~/.pi-code/config.json），或清空该文件中的自定义网关后再试。",
    );
  }
  await app.press("text:设置");
  expect(app.texts()).toContain("运行模式");
}, 90000);
