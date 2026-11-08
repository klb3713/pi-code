// End-to-end test: real bridge + pi 1.5.0 agent loop + the local mock LLM.
//
// The workspace is a throwaway directory inside the project (pluginDir), reset
// outside the test run. pi really runs: it calls the write tool against the
// workspace, and the bridge really reads the file back for the UI.
import { expect, open, test, type App } from "nsh/test";
import { DEFAULT_WORKSPACE } from "../app/local-config";

const WORKSPACE = `${DEFAULT_WORKSPACE}/.e2e-workspace`;

function hasText(app: App, text: string): boolean {
  return app.texts().some((value) => value.includes(text));
}

async function waitText(app: App, text: string, timeout = 30000): Promise<void> {
  await app.waitUntil(() => hasText(app, text), { timeout });
}

test("真实 pi + mock LLM：创建 hello.ts、工具卡片与磁盘回读", async () => {
  const app = await open("../App.tsx", {
    platform: "macos",
    width: 1440,
    height: 900,
    storage: { "pi-code.workspace": WORKSPACE, "pi-code.mode": "demo" },
  });

  // Real bridge boot: pi child process + demo mock LLM (no credentials).
  await app.waitFor("text:pi 已连接", { timeout: 60000 });
  expect(app.texts()).toContain("今天想构建什么？");

  await app.type("给 Pi Code 一个小任务…", "创建一个 hello.ts 并打印 Hello");
  await app.press("↑");

  // The user's message is echoed immediately.
  await app.waitFor("text:创建一个 hello.ts 并打印 Hello", { timeout: 10000 });

  // pi calls the real write tool; the tool card shows its path.
  await app.waitFor("text:写入文件", { timeout: 60000 });
  await waitText(app, "hello.ts", 60000);

  // Streamed assistant reply ends with the demo model's completion message.
  await app.waitUntil(
    () => hasText(app, "已完成！我使用") && !hasText(app, "生成中"),
    { timeout: 90000 },
  );
  expect(hasText(app, "你可以打开右侧的「变更」面板查看 diff")).toBe(true);

  // Expanding the card shows pi's real tool result.
  await app.press("text:写入文件");
  await waitText(app, "Successfully wrote", 15000);
  expect(hasText(app, "hello.ts")).toBe(true);

  // The file tree is served by the bridge from the real workspace: hello.ts
  // must be there. Opening it reads its bytes back through read_file.
  await app.press("text:文件");
  await app.press("label:刷新文件列表");
  await waitText(app, "hello.ts", 20000);
  await app.press("label:工作区文件 >> text:hello.ts");
  await app.waitFor("label:返回文件列表", { timeout: 15000 });
  await waitText(app, "由 Pi Code Demo 模型创建", 15000);
  await waitText(app, "demoMessage", 15000);

  // The changes tab also lists the new file (git sees it as untracked → A).
  const changeTab = app.count("text:变更") - 1;
  await app.press(`text:变更 >> nth=${Math.max(changeTab, 0)}`);
  await app.waitFor("text:本次会话 / git 变更", { timeout: 15000 });
  await waitText(app, "hello.ts", 15000);
  expect(app.texts()).toContain("A");
}, 180000);
