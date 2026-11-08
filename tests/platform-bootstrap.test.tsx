// Real app launch: native uses stdio; --target web must use WebSocket.
// `npm run test:web` starts a loopback-only service for the browser test.
import { expect, open, test } from "nsh/test";
import { DEFAULT_WORKSPACE } from "../app/local-config";

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
  await app.press("text:设置");
  expect(app.texts()).toContain("运行模式");
}, 90000);
