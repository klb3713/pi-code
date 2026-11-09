// Visual verification on a real macOS host (`nsh test --target macos`).
//
// Headless engines draw nothing and reject app.screenshot(), so this test
// no-ops there (it still passes in the default full `nsh test` run). On macOS
// it captures the welcome screen, a conversation with a tool card, and the
// settings dialog into tests/screenshots/, then the light-theme welcome and
// settings surfaces after switching 外观 to 浅色.
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

test("macOS 视觉截图：欢迎页、对话页、设置页与浅色主题", async () => {
  const app = await open("../test-entry.tsx", { platform: "macos", width: 1440, height: 900 });
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

  // Light appearance: same surfaces, Claude Code light palette. Saving applies
  // the theme at once (no reconnect); a fresh session shows the light welcome.
  await app.press("text:深色");
  await app.press("text:浅色");
  await app.press("text:保存");
  await app.waitFor("text:外观", { state: "gone", timeout: 10000 });

  await app.press("text:新建会话");
  await app.waitFor("text:今天想构建什么？", { timeout: 10000 });
  await app.waitFor("text:已新建会话", { state: "gone", timeout: 10000 });
  await capture(app, `${SHOTS}/welcome-light.png`);

  await app.press("text:设置");
  await app.waitFor("text:运行模式", { timeout: 10000 });
  await capture(app, `${SHOTS}/settings-light.png`);
  expect(app.texts()).toContain("Pi Code · pi agent");
}, 120000);
