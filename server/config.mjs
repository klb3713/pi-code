// Persistent Pi Code application settings.
//
// The config file lives at ~/.pi-code/config.json by default. Tests and
// isolated embedders can point PI_CODE_CONFIG_DIR at another directory. API
// keys are stored only in this local file and must never be logged.

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIG_FILENAME = "config.json";
export const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
export const RUN_MODES = new Set(["auto", "demo", "real"]);
export const THEME_PREFERENCES = new Set(["dark", "light", "system"]);
/** The appearance Pi Code started with; older config files without `theme` keep it. */
export const DEFAULT_THEME = "dark";

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function configFilePath(env = process.env) {
  const override = typeof env.PI_CODE_CONFIG_DIR === "string" ? env.PI_CODE_CONFIG_DIR.trim() : "";
  const directory = override ? path.resolve(override) : path.join(os.homedir(), ".pi-code");
  return path.join(directory, CONFIG_FILENAME);
}

export function normalizeMode(value) {
  const mode = typeof value === "string" ? value.trim() : "";
  if (!RUN_MODES.has(mode)) throw new Error(`无效运行模式：${String(value ?? "(缺少 mode)")}`);
  return mode;
}

export function normalizeThinking(value) {
  const level = typeof value === "string" ? value.trim() : "";
  if (!THINKING_LEVELS.has(level)) throw new Error(`无效的 thinking level：${String(value ?? "(缺少 thinking)")}`);
  return level;
}

/**
 * Normalizes the appearance preference. A missing value is the historical dark
 * theme, so config files written before the light theme existed still load.
 */
export function normalizeTheme(value) {
  if (value === undefined || value === null) return DEFAULT_THEME;
  const theme = typeof value === "string" ? value.trim() : "";
  if (!THEME_PREFERENCES.has(theme)) {
    throw new Error(`无效的外观设置：${String(value)}（应为 dark / light / system）`);
  }
  return theme;
}

/** Normalizes the shared provider/modelId key while allowing slashes in IDs. */
export function normalizeModelKey(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error("modelKey 必须是 provider/modelId 字符串");
  const raw = value.trim();
  if (!raw) return "";
  const separator = raw.indexOf("/");
  if (separator < 0) throw new Error(`无效 modelKey：${raw}（应为 provider/modelId）`);
  const provider = raw.slice(0, separator).trim();
  const modelId = raw.slice(separator + 1).trim();
  if (!provider || !modelId) throw new Error(`无效 modelKey：${raw}（应为 provider/modelId）`);
  return `${provider}/${modelId}`;
}

export function parseModelKey(value) {
  const modelKey = normalizeModelKey(value);
  if (!modelKey) return null;
  const separator = modelKey.indexOf("/");
  return { provider: modelKey.slice(0, separator), modelId: modelKey.slice(separator + 1) };
}

export function normalizeGatewayBaseUrl(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error("gateway.baseUrl 必须是字符串");
  const raw = value.trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`无效网关 URL：${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`网关 URL 仅支持 http/https：${raw}`);
  }
  if (url.username || url.password) throw new Error("网关 URL 不应包含用户名或密码，请使用 gateway.apiKey");
  if (url.search || url.hash) throw new Error("网关 URL 不应包含查询参数或片段");
  return url.toString().replace(/\/+$/, "");
}

function normalizeGateway(value) {
  if (value === undefined || value === null) return { baseUrl: "", apiKey: "" };
  if (!isObject(value)) throw new Error("gateway 必须是对象");
  if (value.apiKey !== undefined && value.apiKey !== null && typeof value.apiKey !== "string") {
    throw new Error("gateway.apiKey 必须是字符串");
  }
  return {
    baseUrl: normalizeGatewayBaseUrl(value.baseUrl),
    apiKey: String(value.apiKey ?? "").trim(),
  };
}

function normalizeWorkspace(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("缺少工作区路径");
  return path.resolve(value.trim());
}

/** Validates and canonicalizes an AppConfig without reading environment variables. */
export function normalizeAppConfig(value) {
  if (!isObject(value)) throw new Error("config 必须是 AppConfig 对象");
  return {
    workspace: normalizeWorkspace(value.workspace),
    mode: normalizeMode(value.mode),
    modelKey: normalizeModelKey(value.modelKey),
    thinking: normalizeThinking(value.thinking),
    theme: normalizeTheme(value.theme),
    gateway: normalizeGateway(value.gateway),
  };
}

async function atomicWrite(filePath, contents) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${CONFIG_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  let handle = null;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, filePath);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

/** Atomically persists a normalized AppConfig and returns the canonical value. */
export async function saveConfig(value, options = {}) {
  const config = normalizeAppConfig(value);
  const filePath = configFilePath(options.env ?? process.env);
  await atomicWrite(filePath, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

/** Returns null only when the file does not exist; malformed config is reported. */
export async function loadConfig(options = {}) {
  const filePath = configFilePath(options.env ?? process.env);
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`无法读取 Pi Code 配置：${error instanceof Error ? error.message : String(error)}`);
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Pi Code 配置 JSON 无效：${error instanceof Error ? error.message : String(error)}`);
  }
  return normalizeAppConfig(value);
}

function migratedModelKey(legacyValue, env) {
  const existing = normalizeModelKey(legacyValue);
  if (existing) return existing;
  const environmental = typeof env.OPENAI_MODEL === "string" ? env.OPENAI_MODEL.trim() : "";
  return environmental ? `openai-gateway/${environmental}` : "";
}

/**
 * Loads the saved file, or creates it once from the request/legacy UI config.
 * Environment gateway variables participate only in this first migration.
 * An existing file always wins, including over reconnect.config.
 */
export async function loadOrMigrateConfig(request, options = {}) {
  const env = options.env ?? process.env;
  const existing = await loadConfig({ env });
  if (existing) return { config: existing, created: false };
  if (!isObject(request)) throw new Error("缺少 init/reconnect 配置");
  const legacy = request.config === undefined || request.config === null ? {} : request.config;
  if (!isObject(legacy)) throw new Error("config 必须是 AppConfig 对象");
  const legacyGateway = legacy.gateway === undefined || legacy.gateway === null ? {} : legacy.gateway;
  if (!isObject(legacyGateway)) throw new Error("gateway 必须是对象");
  const legacyBaseUrl = normalizeGatewayBaseUrl(legacyGateway.baseUrl);
  // Fill a completely empty gateway from OPENAI_*. Do not accidentally reuse
  // another gateway's environment key when a custom URL was explicitly given.
  const useEnvironmentGateway = !legacyBaseUrl;
  const environmentalBaseUrl = useEnvironmentGateway
    ? normalizeGatewayBaseUrl(typeof env.OPENAI_BASE_URL === "string" ? env.OPENAI_BASE_URL : "")
    : "";
  const environmentalKey = useEnvironmentGateway && typeof env.OPENAI_API_KEY === "string" ? env.OPENAI_API_KEY : "";
  const candidate = {
    workspace: legacy.workspace ?? request.workspace,
    mode: legacy.mode ?? request.mode ?? "auto",
    modelKey: migratedModelKey(legacy.modelKey, env),
    thinking: legacy.thinking ?? "off",
    theme: normalizeTheme(legacy.theme),
    gateway: legacyBaseUrl
      ? { baseUrl: legacyBaseUrl, apiKey: legacyGateway.apiKey ?? "" }
      : { baseUrl: environmentalBaseUrl, apiKey: environmentalKey },
  };
  const config = await saveConfig(candidate, { env });
  return { config, created: true };
}
