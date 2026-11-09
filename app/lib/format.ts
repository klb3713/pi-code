// Small formatting helpers shared by Pi Code's UI.

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

export function joinPath(base: string, child: string): string {
  if (!base) return child;
  if (isAbsolutePath(child)) return child;
  return `${base.replace(/[/\\]+$/, "")}/${child}`;
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) return "";
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function formatDay(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}`;
}

export function formatTokens(tokens: number): string {
  if (!tokens || tokens < 0) return "0";
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

export function formatCost(cost: number): string {
  if (!cost) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function shortPath(path: string, max = 46): string {
  const normalized = normalizePath(path);
  if (normalized.length <= max) return normalized;
  const head = normalized.slice(0, 12);
  const tail = normalized.slice(normalized.length - (max - 15));
  return `${head}…${tail}`;
}

export function languageFromPath(path: string): string {
  const name = basename(path).toLowerCase();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    md: "markdown",
    mdx: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    htm: "html",
    rs: "rust",
    py: "python",
    go: "go",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    h: "c",
    cpp: "cpp",
    hpp: "cpp",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    xml: "xml",
    sql: "sql",
    vue: "vue",
    svelte: "svelte",
  };
  return map[extension] ?? (extension || "text");
}

export function fileBadge(path: string): { text: string; className: string } {
  const name = basename(path).toLowerCase();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  switch (extension) {
    case "ts":
    case "tsx":
      return { text: "TS", className: "text-[#3f6f9c] dark:text-[#4f9cf7]" };
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return { text: "JS", className: "text-[#8a6320] dark:text-[#e5c07b]" };
    case "json":
      return { text: "{}", className: "text-warning" };
    case "md":
    case "mdx":
      return { text: "MD", className: "text-muted-foreground" };
    case "css":
    case "scss":
      return { text: "CS", className: "text-[#7b5ea7] dark:text-[#c678dd]" };
    case "rs":
      return { text: "RS", className: "text-[#b5542f] dark:text-[#e07b53]" };
    case "py":
      return { text: "PY", className: "text-info" };
    case "sh":
    case "bash":
    case "zsh":
      return { text: "SH", className: "text-success" };
    case "yml":
    case "yaml":
      return { text: "YML", className: "text-warning" };
    default:
      return { text: extension ? extension.slice(0, 3).toUpperCase() : "·", className: "text-muted-foreground" };
  }
}

export function statusLetter(status: string): string {
  const cleaned = status.trim();
  if (cleaned === "??") return "A";
  return cleaned.slice(0, 1).toUpperCase() || "M";
}

export function statusColor(status: string): string {
  switch (statusLetter(status)) {
    case "A":
      return "text-success";
    case "D":
      return "text-destructive";
    case "R":
      return "text-info";
    default:
      return "text-warning";
  }
}

export function todayLabel(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfDay - 86_400_000;
  if (timestamp >= startOfDay) return "今天";
  if (timestamp >= startOfYesterday) return "昨天";
  if (now.getTime() - timestamp < 7 * 86_400_000) return "最近 7 天";
  return "更早";
}

export function truncate(text: string, max = 120): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}

export function toolLabel(name: string): string {
  switch (name) {
    case "read":
      return "读取文件";
    case "write":
      return "写入文件";
    case "edit":
      return "编辑文件";
    case "bash":
      return "执行命令";
    case "ls":
      return "列出目录";
    case "grep":
      return "搜索内容";
    case "find":
      return "查找文件";
    default:
      return name;
  }
}

export function toolTarget(run: { name: string; args: Record<string, unknown> }): string {
  const value =
    run.args.path ??
    run.args.file_path ??
    run.args.file ??
    run.args.command ??
    run.args.pattern ??
    run.args.query ??
    "";
  return typeof value === "string" ? value : "";
}
