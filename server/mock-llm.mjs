// OpenAI-compatible mock LLM used by Pi Code's demo mode.
//
// The pi coding agent still runs its real agent loop (read/write/edit/bash
// tools) against this server; only the model replies are scripted here.
//
// Behaviour:
//   * a user prompt that asks to create/write/implement something triggers one
//     `write` tool call (path + content are derived from the prompt);
//   * after the tool result comes back it streams a short Chinese final answer;
//   * every other prompt gets a plain streaming Chinese answer.
//
// Endpoints:
//   POST /v1/chat/completions   (SSE when `stream: true`)
//   GET  /v1/models
//   GET  /health

import http from "node:http";
import { pathToFileURL } from "node:url";

const MODEL_ID = "pi-demo-1";
const MODEL_NAME = "Demo 模型";

const CREATE_INTENT =
  /(创建|新建|生成|写|实现|添加|创建个|建个|create|write|implement|generate|add\s+file|scaffold)/i;

const FILE_EXTENSIONS = [
  "tsx",
  "ts",
  "jsx",
  "js",
  "mjs",
  "cjs",
  "json",
  "md",
  "txt",
  "py",
  "go",
  "rs",
  "css",
  "html",
  "yml",
  "yaml",
  "toml",
  "sh",
  "rb",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cpp",
  "hpp",
];

const EXTENSION_PATTERN = new RegExp(
  `([A-Za-z0-9_./-]+\\.(?:${FILE_EXTENSIONS.join("|")}))\\b`,
  "i",
);

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && typeof block === "object" && block.type === "text")
    .map((block) => String(block.text ?? ""))
    .join("\n");
}

function lastUserIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function lastUserText(messages) {
  const index = lastUserIndex(messages);
  return index >= 0 ? contentToText(messages[index].content) : "";
}

function hasToolMessageAfterLastUser(messages) {
  const index = lastUserIndex(messages);
  for (let i = index + 1; i < messages.length; i += 1) {
    const role = messages[i]?.role;
    if (role === "tool" || role === "toolResult") return true;
  }
  return false;
}

function safeRelativePath(raw) {
  let value = String(raw || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
  value = value.replace(/^["'`]+|["'`]+$/g, "");
  // Strip an accidental leading absolute path or traversal segments.
  value = value.split("/").filter((part) => part && part !== "." && part !== "..").join("/");
  if (!value) return "demo-output.txt";
  return value;
}

function extractFilePath(prompt) {
  const match = prompt.match(EXTENSION_PATTERN);
  if (match) return safeRelativePath(match[1]);
  if (/(markdown|文档|说明|readme)/i.test(prompt)) return "demo-output.md";
  if (/(json|配置)/i.test(prompt)) return "demo-output.json";
  if (/(脚本|script)/i.test(prompt)) return "demo-output.js";
  return "demo-output.txt";
}

function buildFileContent(filePath, prompt) {
  const lower = filePath.toLowerCase();
  const promptLine = prompt.replace(/\s+/g, " ").slice(0, 300);
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js") || lower.endsWith(".mjs")) {
    return [
      `// ${filePath} — 由 Pi Code Demo 模型创建`,
      ``,
      `export const demoMessage = "Hello from Pi Code";`,
      ``,
      `console.log(demoMessage);`,
      ``,
    ].join("\n");
  }
  if (lower.endsWith(".json")) {
    return `${JSON.stringify(
      {
        demo: true,
        file: filePath,
        message: "由 Pi Code Demo 模型创建",
        prompt: promptLine,
      },
      null,
      2,
    )}\n`;
  }
  if (lower.endsWith(".md")) {
    return [
      `# ${filePath}`,
      ``,
      `这是由 **Pi Code Demo 模型** 创建的演示文件。`,
      ``,
      `- 请求：${promptLine || "（无）"}`,
      `- 说明：Demo 模式下 pi 仍然执行真实的 agent loop 与文件写入工具，只有模型回复由本地脚本生成。`,
      ``,
    ].join("\n");
  }
  if (lower.endsWith(".py")) {
    return `# ${filePath} — 由 Pi Code Demo 模型创建\nprint("Hello from Pi Code")\n`;
  }
  if (lower.endsWith(".html")) {
    return `<!doctype html>\n<html lang="zh-CN">\n  <head><meta charset="utf-8" /><title>Pi Code Demo</title></head>\n  <body><h1>Hello from Pi Code</h1></body>\n</html>\n`;
  }
  return [
    `${filePath} — 由 Pi Code Demo 模型创建`,
    ``,
    `请求：${promptLine || "（无）"}`,
    `这是一份演示文件。Demo 模式下 pi 仍然执行真实的 agent loop 与文件写入工具。`,
    ``,
  ].join("\n");
}

function lastToolInfo(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "tool" || message?.role === "toolResult") return message;
  }
  return null;
}

function finalReplyFor(filePath, prompt, toolInfo) {
  const toolName = toolInfo?.name ?? toolInfo?.toolName ?? "write";
  const output = contentToText(toolInfo?.content).trim();
  if (toolName === "bash") {
    return `已完成！我运行了 \`bash\` 命令。\n\n${output ? `输出：\n\n\`\`\`\n${output.slice(0, 1200)}\n\`\`\`\n\n` : ""}你可以在工具卡片里展开查看完整输出。`;
  }
  if (toolName === "ls") {
    const count = output ? output.split("\n").filter(Boolean).length : 0;
    return `已完成！我浏览了工作区结构${count ? `，看到了 ${count} 个条目` : ""}。\n\n${output ? `\`\`\`\n${output.slice(0, 1200)}\n\`\`\`\n\n` : ""}右侧「文件」面板可以看到完整文件树。`;
  }
  if (toolName === "read") {
    return `已完成！我读取了文件。\n\n${output ? `\`\`\`\n${output.slice(0, 1200)}\n\`\`\`\n\n` : ""}需要我修改它吗？`;
  }
  const text = prompt.replace(/\s+/g, " ").slice(0, 60);
  return `已完成！我使用 \`write\` 工具创建了 \`${filePath}\`。\n\n你可以打开右侧的「变更」面板查看 diff，或者让我继续完善这个文件。`;
}

function plainReply(prompt) {
  const text = prompt.replace(/\s+/g, " ").slice(0, 120);
  return `这是 Pi Code Demo 模型的回复。\n\n你刚才说：「${text || "你好"}」\n\nDemo 模式使用本地模拟模型，但 pi 仍然运行真实的 agent loop，可以读取文件、写入文件、执行命令。试试让我「创建一个 hello.ts」吧。`;
}

function toolCallId() {
  return `call_demo_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function makeChunk(model, delta, finishReason = null, extra = {}) {
  return {
    id: `chatcmpl-demo-${Math.floor(Math.random() * 1e9).toString(36)}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...extra,
  };
}

async function streamText(res, text, model) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  writeSse(res, makeChunk(model, { role: "assistant", content: "" }));
  // Chunk by a few characters so the UI shows a real streaming effect.
  const pieces = [];
  for (let i = 0; i < text.length; ) {
    const size = 3 + Math.floor(Math.random() * 5);
    pieces.push(text.slice(i, i + size));
    i += size;
  }
  for (const piece of pieces) {
    writeSse(res, makeChunk(model, { content: piece }));
    await sleep(12);
  }
  writeSse(res, makeChunk(model, {}, "stop"));
  writeSse(res, {
    id: `chatcmpl-demo-usage`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [],
    usage: {
      prompt_tokens: 64,
      completion_tokens: Math.max(1, Math.ceil(text.length / 2)),
      total_tokens: 64 + Math.max(1, Math.ceil(text.length / 2)),
    },
  });
  res.write("data: [DONE]\n\n");
  res.end();
}

async function streamToolCall(res, model, toolName, args) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  writeSse(res, makeChunk(model, { role: "assistant", content: "" }));
  const id = toolCallId();
  writeSse(
    res,
    makeChunk(model, {
      tool_calls: [
        {
          index: 0,
          id,
          type: "function",
          function: { name: toolName, arguments: "" },
        },
      ],
    }),
  );
  const json = JSON.stringify(args);
  const split = Math.max(1, Math.floor(json.length / 3));
  for (let i = 0; i < json.length; i += split) {
    writeSse(
      res,
      makeChunk(model, {
        tool_calls: [
          {
            index: 0,
            function: { arguments: json.slice(i, i + split) },
          },
        ],
      }),
    );
    await sleep(8);
  }
  writeSse(res, makeChunk(model, {}, "tool_calls"));
  writeSse(res, {
    id: `chatcmpl-demo-usage`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [],
    usage: { prompt_tokens: 64, completion_tokens: 32, total_tokens: 96 },
  });
  res.write("data: [DONE]\n\n");
  res.end();
}

function decideReply(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const prompt = lastUserText(messages);
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const toolNames = new Set(
    tools
      .map((tool) => tool?.function?.name ?? tool?.name)
      .filter((name) => typeof name === "string"),
  );
  const followUp = hasToolMessageAfterLastUser(messages);
  if (followUp) {
    return { kind: "text", text: finalReplyFor(extractFilePath(prompt), prompt, lastToolInfo(messages)) };
  }
  if (CREATE_INTENT.test(prompt) && toolNames.has("write")) {
    const filePath = extractFilePath(prompt);
    return {
      kind: "tool",
      toolName: "write",
      args: { path: filePath, content: buildFileContent(filePath, prompt) },
    };
  }
  if (/(git\s*status|git 状态|运行.*status|检查.*变更|查看.*变更)/i.test(prompt) && toolNames.has("bash")) {
    return { kind: "tool", toolName: "bash", args: { command: "git status --short" } };
  }
  if (/(看看|浏览|列出|目录|结构|有什么|有哪些|list|browse)/i.test(prompt) && toolNames.has("ls")) {
    return { kind: "tool", toolName: "ls", args: { path: "." } };
  }
  if (/(读取|打开|查看|读一下|read)\s+[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/i.test(prompt) && toolNames.has("read")) {
    const match = prompt.match(/([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/);
    if (match) return { kind: "tool", toolName: "read", args: { path: match[1] } };
  }
  return { kind: "text", text: plainReply(prompt) };
}

async function handleChatCompletions(req, res, chunks) {
  let body;
  try {
    const raw = Buffer.concat(chunks).toString("utf8");
    body = raw ? JSON.parse(raw) : {};
  } catch (error) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { message: `Invalid JSON: ${String(error)}`, type: "invalid_request_error" } }));
    return;
  }

  const model = typeof body.model === "string" && body.model ? body.model : MODEL_ID;
  const reply = decideReply(body);
  const stream = body.stream === true;

  if (!stream) {
    if (reply.kind === "tool") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          id: `chatcmpl-demo-${Date.now().toString(36)}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: toolCallId(),
                    type: "function",
                    function: { name: reply.toolName, arguments: JSON.stringify(reply.args) },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 64, completion_tokens: 32, total_tokens: 96 },
        }),
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        id: `chatcmpl-demo-${Date.now().toString(36)}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: "assistant", content: reply.text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 64, completion_tokens: 64, total_tokens: 128 },
      }),
    );
    return;
  }

  if (reply.kind === "tool") {
    await streamToolCall(res, model, reply.toolName, reply.args);
  } else {
    await streamText(res, reply.text, model);
  }
}

/**
 * Starts the mock OpenAI-compatible LLM on 127.0.0.1:<random port>.
 * @param {{ port?: number }} [options]
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void>, server: http.Server }>}
 */
export async function startMockLlm(options = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, model: MODEL_ID }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: MODEL_ID, object: "model", created: 0, owned_by: "pi-code-demo", name: MODEL_NAME }],
        }),
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        void handleChatCompletions(req, res, chunks).catch((error) => {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          }
          try {
            res.end(JSON.stringify({ error: { message: String(error) } }));
          } catch {
            // already closed
          }
        });
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { message: `Not found: ${req.method} ${url.pathname}` } }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port ?? 0;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    server,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const mock = await startMockLlm();
  // stdout is allowed here: this file is only run standalone for debugging.
  console.log(JSON.stringify({ url: mock.url, port: mock.port }));
  const stop = () => {
    void mock.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
