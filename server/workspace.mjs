// Workspace file / git APIs exposed by the Pi Code bridge (docs/SPEC.md §3.4).

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const READ_LIMIT = 64 * 1024;
const DIFF_TEXT_LIMIT = 256 * 1024;

const IGNORED_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".nsh",
  "target",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".cache",
  ".parcel-cache",
  ".turbo",
  ".yarn",
  ".pnpm-store",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
  ".DS_Store",
]);

const LANGUAGE_BY_EXTENSION = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".mdx": "markdown",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".html": "html",
  ".htm": "html",
  ".xml": "xml",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "zsh",
  ".fish": "fish",
  ".sql": "sql",
  ".graphql": "graphql",
  ".vue": "vue",
  ".svelte": "svelte",
  ".dockerfile": "dockerfile",
  ".diff": "diff",
  ".patch": "diff",
  ".txt": "text",
  ".log": "text",
};

export function languageFor(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  if (base === "makefile") return "makefile";
  if (base === ".gitignore" || base === ".dockerignore") return "text";
  return LANGUAGE_BY_EXTENSION[path.extname(base)] ?? "text";
}

export function resolveWorkspace(workspace) {
  if (typeof workspace !== "string" || !workspace.trim()) throw new Error("缺少工作区路径");
  return path.resolve(workspace.trim());
}

/** Resolves a user-supplied path and keeps it inside the workspace root. */
export function resolveInside(root, requestedPath) {
  if (typeof requestedPath !== "string" || !requestedPath.trim()) throw new Error("缺少文件路径");
  const raw = requestedPath.trim();
  const absolute = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const relative = path.relative(root, absolute);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return absolute;
  }
  throw new Error(`路径不在工作区内：${requestedPath}`);
}

function relativeId(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function isProbablyBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  for (let i = 0; i < sample.length; i += 1) {
    if (sample[i] === 0) return true;
  }
  return false;
}

async function readHead(filePath, limit) {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, limit);
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(buffer, offset, length - offset, offset);
      if (bytesRead <= 0) break;
      offset += bytesRead;
    }
    return { buffer: buffer.subarray(0, offset), size: stat.size };
  } finally {
    await handle.close();
  }
}

function sortNodes(a, b) {
  if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
  return a.name.localeCompare(b.name, "zh-Hans-CN");
}

/**
 * Recursively lists the workspace as FileNode[].
 * @param {string} root
 * @param {{ maxDepth?: number }} [options]
 */
export async function listFiles(root, options = {}) {
  const maxDepth = Math.min(Math.max(Number(options.maxDepth ?? 6) || 6, 1), 12);
  const maxNodes = 20_000;
  let nodeCount = 0;

  async function walk(directory, depth) {
    if (depth > maxDepth) return [];
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes = [];
    for (const entry of entries) {
      if (nodeCount >= maxNodes) break;
      if (IGNORED_NAMES.has(entry.name)) continue;
      if (entry.name.startsWith(".DS_Store")) continue;
      const absolute = path.join(directory, entry.name);
      const id = relativeId(root, absolute);
      if (entry.isDirectory()) {
        nodeCount += 1;
        const children = await walk(absolute, depth + 1);
        nodes.push({ id, name: entry.name, kind: "dir", children });
      } else if (entry.isFile()) {
        nodeCount += 1;
        let size;
        try {
          size = (await fs.stat(absolute)).size;
        } catch {
          size = undefined;
        }
        nodes.push({ id, name: entry.name, kind: "file", ...(size === undefined ? {} : { size }) });
      }
    }
    nodes.sort(sortNodes);
    return nodes;
  }

  return walk(root, 1);
}

/**
 * Reads a text file (first 64KB) inside the workspace.
 * @returns {Promise<{path:string,content:string,language:string,size:number,truncated?:boolean}>}
 */
export async function readFile(root, requestedPath) {
  const absolute = resolveInside(root, requestedPath);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw new Error(`不是文件：${requestedPath}`);
  const { buffer, size } = await readHead(absolute, READ_LIMIT);
  const id = relativeId(root, absolute);
  const language = languageFor(absolute);
  if (isProbablyBinary(buffer)) {
    return {
      path: id,
      content: "[二进制文件，无法以文本方式预览]",
      language,
      size,
      truncated: size > READ_LIMIT,
    };
  }
  let content = buffer.toString("utf8");
  const truncated = size > READ_LIMIT;
  if (truncated) content += "\n…（文件超过 64KB，已截断）";
  return { path: id, content, language, size, ...(truncated ? { truncated: true } : {}) };
}

async function runGit(root, args) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    return { ok: true, stdout: String(stdout) };
  } catch (error) {
    return {
      ok: false,
      stdout: typeof error?.stdout === "string" ? error.stdout : "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function gitBranch(root) {
  const result = await runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!result.ok) return undefined;
  const branch = result.stdout.trim();
  if (!branch || branch === "HEAD") return undefined;
  return branch;
}

/**
 * @returns {Promise<{branch?: string, changes: {path: string, status: string}[]}>}
 */
export async function gitStatus(root) {
  const result = await runGit(root, ["status", "--porcelain"]);
  if (!result.ok) {
    // Not a git repository (or git missing): report an empty status instead of
    // failing the whole UI panel.
    return { changes: [] };
  }
  const changes = [];
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2).trim() || line.slice(0, 2);
    let filePath = line.length > 3 ? line.slice(3).trim() : "";
    if (!filePath) continue;
    const renameIndex = filePath.indexOf(" -> ");
    if (renameIndex >= 0) filePath = filePath.slice(renameIndex + 4).trim();
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1);
    }
    changes.push({ path: filePath, status });
  }
  const branch = await gitBranch(root);
  return { ...(branch ? { branch } : {}), changes };
}

async function isTracked(root, relativePath) {
  const result = await runGit(root, ["ls-files", "--error-unmatch", "--", relativePath]);
  return result.ok;
}

/**
 * Unified diff for one workspace file.
 * - tracked files: `git diff HEAD` (staged + unstaged)
 * - untracked files: oldText "" + newText file content
 * @returns {Promise<{path:string,patch?:string,oldText?:string,newText?:string,language?:string,isBinary?:boolean}>}
 */
export async function getDiff(root, requestedPath) {
  const absolute = resolveInside(root, requestedPath);
  const id = relativeId(root, absolute);
  const language = languageFor(absolute);

  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch {
    stat = null;
  }

  const tracked = await isTracked(root, id);
  if (tracked) {
    let result = await runGit(root, ["diff", "HEAD", "--", id]);
    if (!result.ok) {
      // Repositories without a first commit: show staged + unstaged changes.
      result = await runGit(root, ["diff", "--cached", "--", id]);
      if (result.ok && !result.stdout) result = await runGit(root, ["diff", "--", id]);
    }
    const patch = result.stdout;
    if (patch.includes("Binary files") || patch.includes("GIT binary patch")) {
      return { path: id, patch, language, isBinary: true };
    }
    return { path: id, patch, language };
  }

  // Untracked (or deleted-and-untracked) file: show the whole content.
  if (!stat || !stat.isFile()) {
    const result = await runGit(root, ["diff", "HEAD", "--", id]);
    if (result.ok && result.stdout) return { path: id, patch: result.stdout, language };
    throw new Error(`文件不存在：${requestedPath}`);
  }
  const { buffer, size } = await readHead(absolute, DIFF_TEXT_LIMIT);
  if (isProbablyBinary(buffer)) {
    return { path: id, language, isBinary: true, oldText: "", newText: "" };
  }
  let newText = buffer.toString("utf8");
  if (size > DIFF_TEXT_LIMIT) newText += "\n…（文件过大，已截断）";
  return { path: id, oldText: "", newText, language };
}
