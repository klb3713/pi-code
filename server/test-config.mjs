// Fast, isolated tests for AppConfig normalization and atomic persistence.
// Run: node --test server/test-config.mjs

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  configFilePath,
  loadConfig,
  loadOrMigrateConfig,
  normalizeAppConfig,
  parseModelKey,
  saveConfig,
} from "./config.mjs";

async function temporaryDirectory(t, prefix = "pi-code-config-test-") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function appConfig(workspace) {
  return {
    workspace,
    mode: "auto",
    modelKey: "",
    thinking: "off",
    gateway: { baseUrl: "", apiKey: "" },
  };
}

test("normalizes workspace, gateway URL, model key and thinking", async (t) => {
  const root = await temporaryDirectory(t);
  const config = normalizeAppConfig({
    workspace: ` ${path.join(root, "workspace", "..", "workspace")} `,
    mode: " real ",
    modelKey: " openai-gateway / org/model-with/slashes ",
    thinking: " high ",
    gateway: { baseUrl: " https://gateway.example/v1/// ", apiKey: " secret-key " },
  });
  assert.equal(config.workspace, path.join(root, "workspace"));
  assert.equal(config.mode, "real");
  assert.equal(config.modelKey, "openai-gateway/org/model-with/slashes");
  assert.equal(config.thinking, "high");
  assert.deepEqual(config.gateway, { baseUrl: "https://gateway.example/v1", apiKey: "secret-key" });
  assert.deepEqual(parseModelKey(config.modelKey), {
    provider: "openai-gateway",
    modelId: "org/model-with/slashes",
  });
});

test("rejects invalid enum, model key and gateway values", async (t) => {
  const root = await temporaryDirectory(t);
  const base = appConfig(root);
  assert.throws(() => normalizeAppConfig({ ...base, mode: "REAL" }), /无效运行模式/);
  assert.throws(() => normalizeAppConfig({ ...base, thinking: "extreme" }), /thinking level/);
  for (const modelKey of ["missing-provider", "/model", "provider/"]) {
    assert.throws(() => normalizeAppConfig({ ...base, modelKey }), /modelKey/);
  }
  for (const baseUrl of ["not a url", "file:///tmp/gateway", "https://user:pass@example.com/v1"]) {
    assert.throws(
      () => normalizeAppConfig({ ...base, gateway: { baseUrl, apiKey: "" } }),
      /网关 URL/,
    );
  }
  assert.throws(
    () => normalizeAppConfig({ ...base, gateway: { baseUrl: "", apiKey: 42 } }),
    /apiKey/,
  );
});

test("saveConfig atomically rewrites config.json with private permissions", async (t) => {
  const root = await temporaryDirectory(t);
  const env = { PI_CODE_CONFIG_DIR: path.join(root, "isolated") };
  const filePath = configFilePath(env);
  assert.equal(filePath, path.join(root, "isolated", "config.json"));
  assert.equal(await loadConfig({ env }), null);

  const first = await saveConfig(
    {
      ...appConfig(root),
      mode: "real",
      modelKey: "openai-gateway/test-model",
      gateway: { baseUrl: "http://127.0.0.1:8080/v1/", apiKey: "local-secret" },
    },
    { env },
  );
  const stat = await fs.stat(filePath);
  assert.equal(stat.mode & 0o777, 0o600);
  assert.deepEqual(await loadConfig({ env }), first);
  assert.equal((await fs.readdir(path.dirname(filePath))).length, 1, "temporary files must be cleaned up");

  const second = await saveConfig({ ...first, thinking: "low" }, { env });
  assert.equal(second.thinking, "low");
  assert.deepEqual(await loadConfig({ env }), second);
  assert.deepEqual(await fs.readdir(path.dirname(filePath)), ["config.json"]);
  assert.ok((await fs.readFile(filePath, "utf8")).endsWith("\n"));
});

test("first init migrates legacy config and OPENAI_* defaults once", async (t) => {
  const root = await temporaryDirectory(t);
  const configDir = path.join(root, "config");
  const legacyWorkspace = path.join(root, "legacy-workspace");
  const env = {
    PI_CODE_CONFIG_DIR: configDir,
    OPENAI_BASE_URL: "http://127.0.0.1:9000/v1/",
    OPENAI_API_KEY: "environment-secret",
    OPENAI_MODEL: "environment-model",
  };
  const legacy = {
    workspace: legacyWorkspace,
    mode: "real",
    modelKey: "",
    thinking: "medium",
    gateway: { baseUrl: "", apiKey: "" },
  };
  const migrated = await loadOrMigrateConfig(
    { workspace: path.join(root, "request-workspace"), mode: "demo", config: legacy },
    { env },
  );
  assert.equal(migrated.created, true);
  assert.deepEqual(migrated.config, {
    workspace: legacyWorkspace,
    mode: "real",
    modelKey: "openai-gateway/environment-model",
    thinking: "medium",
    gateway: { baseUrl: "http://127.0.0.1:9000/v1", apiKey: "environment-secret" },
  });

  const reconnect = await loadOrMigrateConfig(
    {
      workspace: path.join(root, "ignored-workspace"),
      mode: "demo",
      config: {
        ...appConfig(root),
        mode: "demo",
        gateway: { baseUrl: "http://ignored.example/v1", apiKey: "ignored-secret" },
      },
    },
    {
      env: {
        ...env,
        OPENAI_BASE_URL: "http://also-ignored.example/v1",
        OPENAI_API_KEY: "also-ignored",
      },
    },
  );
  assert.equal(reconnect.created, false);
  assert.deepEqual(reconnect.config, migrated.config);
  assert.deepEqual(await loadConfig({ env }), migrated.config);
});

test("an explicitly configured gateway does not inherit another gateway's key", async (t) => {
  const root = await temporaryDirectory(t);
  const env = {
    PI_CODE_CONFIG_DIR: path.join(root, "config"),
    OPENAI_BASE_URL: "http://environment.example/v1",
    OPENAI_API_KEY: "environment-secret",
  };
  const { config } = await loadOrMigrateConfig(
    {
      workspace: root,
      mode: "real",
      config: {
        ...appConfig(root),
        mode: "real",
        gateway: { baseUrl: "http://custom.example/v1", apiKey: "" },
      },
    },
    { env },
  );
  assert.deepEqual(config.gateway, { baseUrl: "http://custom.example/v1", apiKey: "" });
});

test("an existing empty gateway is authoritative over environment variables", async (t) => {
  const root = await temporaryDirectory(t);
  const env = {
    PI_CODE_CONFIG_DIR: path.join(root, "config"),
    OPENAI_BASE_URL: "http://environment.example/v1",
    OPENAI_API_KEY: "environment-secret",
    OPENAI_MODEL: "environment-model",
  };
  const saved = await saveConfig(appConfig(root), { env });
  const loaded = await loadOrMigrateConfig(
    { workspace: path.join(root, "ignored"), mode: "real", config: { ...saved, mode: "real" } },
    { env },
  );
  assert.equal(loaded.created, false);
  assert.deepEqual(loaded.config, saved);
  assert.deepEqual(loaded.config.gateway, { baseUrl: "", apiKey: "" });
  assert.equal(loaded.config.modelKey, "");
});

test("malformed JSON is reported without overwriting the existing file", async (t) => {
  const root = await temporaryDirectory(t);
  const env = { PI_CODE_CONFIG_DIR: path.join(root, "config") };
  const filePath = configFilePath(env);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "{not-json\n", "utf8");
  await assert.rejects(
    loadOrMigrateConfig({ workspace: root, mode: "demo", config: appConfig(root) }, { env }),
    /配置 JSON 无效/,
  );
  assert.equal(await fs.readFile(filePath, "utf8"), "{not-json\n");
});
