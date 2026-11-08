#!/usr/bin/env node
// Pi Code one-shot setup:
//   1. installs server/ dependencies (pi-coding-agent 0.74.2)
//   2. rewrites app/local-config.ts with absolute paths for this machine
//
// Usage: node scripts/setup.mjs   (or `npm run setup` when a root package.json
// exposes that script).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "..");
const SERVER_DIR = path.join(PROJECT_ROOT, "server");
const LOCAL_CONFIG = path.join(PROJECT_ROOT, "app", "local-config.ts");
const BRIDGE_PATH = path.join(SERVER_DIR, "bridge.mjs");
const PI_VERSION_FALLBACK = "0.74.2";

function log(message) {
  console.log(`[setup] ${message}`);
}

function readPiVersion() {
  try {
    const serverPackage = JSON.parse(readFileSync(path.join(SERVER_DIR, "package.json"), "utf8"));
    const dependency = serverPackage?.dependencies?.["@earendil-works/pi-coding-agent"];
    if (typeof dependency === "string" && dependency.trim()) return dependency.replace(/^[~^]/, "");
  } catch {
    // fall through
  }
  try {
    const installed = JSON.parse(
      readFileSync(
        path.join(SERVER_DIR, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"),
        "utf8",
      ),
    );
    if (typeof installed.version === "string") return installed.version;
  } catch {
    // fall through
  }
  return PI_VERSION_FALLBACK;
}

function installServerDependencies() {
  log(`installing server dependencies in ${SERVER_DIR}`);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    npm,
    ["install", "--prefix", SERVER_DIR, "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: PROJECT_ROOT, stdio: "inherit", env: { ...process.env } },
  );
  if (result.error) {
    throw new Error(`npm install 启动失败：${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`npm install 失败（exit ${result.status ?? result.signal}）`);
  }
}

const DEFAULT_LOCAL_CONFIG = `// Local runtime paths for Pi Code.
// \`scripts/setup.mjs\` regenerates this file with absolute paths for the
// current machine. The fallbacks below keep \`nsh run App.tsx\` working from a
// checkout where the bridge lives next to App.tsx.
import { fileURLToPath } from "url";

function dirUrl(url: string): string {
  try {
    if (url.startsWith("file:")) {
      const path = fileURLToPath(url);
      const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\\\"));
      return cut > 0 ? path.slice(0, cut) : path;
    }
  } catch {
    // asset: URLs in headless tests — fall through.
  }
  return "";
}

const MODULE_DIR = dirUrl(import.meta.url);
const PROJECT_ROOT = MODULE_DIR ? MODULE_DIR.replace(/[/\\\\]app$/, "") : "";

export const BRIDGE_PATH = PROJECT_ROOT ? \`\${PROJECT_ROOT}/server/bridge.mjs\` : "";
export const NODE_BIN = "node";
export const DEFAULT_WORKSPACE = PROJECT_ROOT;
export const PI_VERSION = "0.74.2";
`;

async function writeLocalConfig() {
  const piVersion = readPiVersion();
  let source;
  if (existsSync(LOCAL_CONFIG)) {
    source = await fs.readFile(LOCAL_CONFIG, "utf8");
  } else {
    log("app/local-config.ts 不存在，生成默认模板");
    source = DEFAULT_LOCAL_CONFIG;
  }
  const replacements = [
    ["BRIDGE_PATH", JSON.stringify(BRIDGE_PATH)],
    // nsh.json only authorizes the bare command "node", so never write an
    // absolute node path here even though it would also work locally.
    ["NODE_BIN", JSON.stringify("node")],
    ["DEFAULT_WORKSPACE", JSON.stringify(PROJECT_ROOT)],
    ["PI_VERSION", JSON.stringify(piVersion)],
  ];
  for (const [name, value] of replacements) {
    const pattern = new RegExp(`^export const ${name} = .*;$`, "m");
    if (!pattern.test(source)) {
      throw new Error(`app/local-config.ts 中找不到 export const ${name}`);
    }
    source = source.replace(pattern, `export const ${name} = ${value};`);
  }
  await fs.writeFile(LOCAL_CONFIG, source, "utf8");
  log(`updated ${LOCAL_CONFIG}`);
  log(`  BRIDGE_PATH      = ${BRIDGE_PATH}`);
  log(`  NODE_BIN         = node`);
  log(`  DEFAULT_WORKSPACE= ${PROJECT_ROOT}`);
  log(`  PI_VERSION       = ${piVersion}`);
}

async function main() {
  installServerDependencies();
  if (!existsSync(BRIDGE_PATH)) {
    throw new Error(`server/bridge.mjs 不存在：${BRIDGE_PATH}`);
  }
  await writeLocalConfig();
  log("done");
}

main().catch((error) => {
  console.error(`[setup] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
