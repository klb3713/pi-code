// UI smoke tests for Pi Code, driven through the deterministic FakeTransport.
//
// test-entry.tsx mounts the real App with a fake bridge, so these tests cover
// the shell, chat, tool cards, right panel and settings dialog without
// spawning pi.
import { expect, open, test, type App } from "nsh/test";

const VIEWPORT = { platform: "macos", width: 1440, height: 900 } as const;

async function openApp(): Promise<App> {
  const app = await open("../tests/test-entry.tsx", VIEWPORT);
  await app.waitFor("text:pi 已连接", { timeout: 20000 });
  await app.waitFor("text:今天想构建什么？", { timeout: 20000 });
  return app;
}

function hasText(app: App, text: string): boolean {
  return app.texts().some((value) => value.includes(text));
}

async function waitText(app: App, text: string, timeout = 15000): Promise<void> {
  await app.waitUntil(() => hasText(app, text), { timeout });
}

async function sendMessage(app: App, text: string): Promise<void> {
  await app.type("给 Pi Code 一个小任务…", text);
  await app.press("↑");
}

async function waitReplyDone(app: App): Promise<void> {
  await waitText(app, "这是一个本地演示回复。", 20000);
  await app.waitUntil(() => !hasText(app, "生成中"), { timeout: 20000 });
}

test("欢迎页：空会话展示建议卡片与三栏布局骨架", async () => {
  const app = await openApp();
  expect(app.texts()).toContain("今天想构建什么？");
  expect(app.texts()).toContain("让 pi 在你的工作区里读代码、改文件、跑命令");
  expect(app.texts()).toContain("创建一个 hello.ts 并打印 Hello");
  expect(app.texts()).toContain("看看这个项目里有什么");
  expect(app.texts()).toContain("运行 git status 并总结");
  // Sidebar + right panel + status bar labels.
  expect(app.texts()).toContain("新建会话");
  expect(app.texts()).toContain("文件");
  expect(app.texts()).toContain("变更");
  expect(app.shows("text:设置")).toBe(true);
  expect(hasText(app, "Pi Demo 1")).toBe(true);
  expect(hasText(app, "pi 1.5.0")).toBe(true);
}, 60000);

test("发送消息：用户消息、流式助手回复与工具卡片完成", async () => {
  const app = await openApp();
  await sendMessage(app, "请帮我写 src/main.ts");

  await app.waitFor("text:请帮我写 src/main.ts", { timeout: 10000 });
  await app.waitFor("text:写入文件", { timeout: 20000 });
  await waitText(app, "这是一个本地演示回复。");
  await app.waitFor("text:380ms", { timeout: 20000 });
  expect(app.texts()).toContain("Pi Code");
  expect(hasText(app, "生成中")).toBe(false);

  // Expanding the tool card reveals the write result.
  await app.press("text:写入文件");
  await app.waitFor("text:内容预览", { timeout: 10000 });
  await waitText(app, "Successfully wrote 38 bytes to src/main.ts", 10000);
}, 60000);

test("变更面板：列出本次改动并可打开 diff 预览", async () => {
  const app = await openApp();
  await sendMessage(app, "写一个 demo");
  await waitReplyDone(app);

  await app.press("text:变更");
  await app.waitFor("text:本次会话 / git 变更", { timeout: 10000 });
  await waitText(app, "main.ts");
  await waitText(app, "README.md");
  // get_diff enriches the list with +/− counts (PATCH adds 2 lines).
  await app.waitFor("text:+2", { timeout: 10000 });

  await app.press("text:main.ts");
  await app.waitFor("label:返回变更列表", { timeout: 10000 });
  await waitText(app, "src/main.ts");
  await waitText(app, "const answer = 42;", 10000);

  // Back to the list.
  await app.press("label:返回变更列表");
  await app.waitFor("text:本次会话 / git 变更", { timeout: 10000 });
}, 60000);

test("文件面板：文件树计数、点击文件预览与返回", async () => {
  const app = await openApp();
  await app.waitFor("text:4 个文件", { timeout: 10000 });
  expect(app.texts()).toContain("src");
  expect(app.texts()).toContain("package.json");

  await app.press("text:README.md");
  await app.waitFor("label:返回文件列表", { timeout: 10000 });
  await waitText(app, "// README.md");
  await waitText(app, "Hello from Pi Code");

  await app.press("label:返回文件列表");
  await app.waitFor("text:4 个文件", { timeout: 10000 });
}, 60000);

test("设置弹窗：打开、字段齐全并取消关闭", async () => {
  const app = await openApp();
  await app.press("text:设置");
  await app.waitFor("text:运行模式", { timeout: 10000 });
  expect(app.texts()).toContain("工作区");
  expect(app.texts()).toContain("模型");
  expect(app.texts()).toContain("Thinking");
  expect(app.texts()).toContain("保存");
  expect(app.texts()).toContain("取消");
  expect(hasText(app, "Demo 模式 = 本地模拟模型")).toBe(true);

  await app.press("text:取消");
  await app.waitFor("text:运行模式", { state: "gone", timeout: 10000 });
  await app.waitFor("text:今天想构建什么？", { timeout: 10000 });
}, 60000);
