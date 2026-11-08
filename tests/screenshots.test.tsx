// Visual verification on a real macOS host (`nsh test --target macos`).
//
// Headless engines draw nothing and reject app.screenshot(), so this test
// no-ops there (it still passes in the default full `nsh test` run). On macOS
// it captures the welcome screen, a conversation with a tool card, and the
// settings dialog into tests/screenshots/.
import { expect, open, test, type App } from "nsh/test";
import { DEFAULT_WORKSPACE } from "../app/local-config";

const SHOTS = `${DEFAULT_WORKSPACE}/tests/screenshots`;

function hasText(app: App, text: string): boolean {
  return app.texts().some((value) => value.includes(text));
}

/** Captures a screenshot; returns false when the engine can't draw (headless). */
async function capture(app: App, path: string): Promise<boolean> {
  try {
    const bytes = await app.screenshot();
    if (bytes.length < 1024) return false;
    await app.screenshot(path);
    return true;
  } catch {
    return false;
  }
}

test("macOS 视觉截图：欢迎页、对话页、设置页", async () => {
  const app = await open("../tests/test-entry.tsx", { platform: "macos", width: 1440, height: 900 });
  await app.waitFor("text:pi 已连接", { timeout: 20000 });
  await app.waitFor("text:今天想构建什么？", { timeout: 20000 });

  if (!(await capture(app, `${SHOTS}/welcome.png`))) {
    // Headless: screenshots are only meaningful with `nsh test --target macos`.
    return;
  }

  await app.type("给 Pi Code 一个小任务…", "请帮我写 src/main.ts");
  await app.press("↑");
  await app.waitFor("text:写入文件", { timeout: 20000 });
  await app.waitUntil(() => hasText(app, "这是一个本地演示回复。") && !hasText(app, "生成中"), { timeout: 20000 });
  await app.press("text:写入文件");
  await app.waitFor("text:内容预览", { timeout: 10000 });
  await capture(app, `${SHOTS}/conversation.png`);

  await app.press("text:设置");
  await app.waitFor("text:运行模式", { timeout: 10000 });
  await capture(app, `${SHOTS}/settings.png`);
  expect(app.texts()).toContain("Pi Code · pi agent");
}, 120000);
