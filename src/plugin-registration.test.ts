import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createAppContext } from "./bootstrap.js";
import { CONFIG_ENV_FALLBACKS } from "./config/env.js";
import { normalizePluginConfig } from "./config/normalize.js";
import pluginEntry from "./plugin.js";
import type { MonitorService } from "./services/monitor-service.js";
import { startMonitorTool } from "./tools/start-monitor.tool.js";
import type {
  PluginApi,
  RegisteredAgentTool,
  RegisteredCommand,
  RegisteredService,
} from "./runtime/plugin-api.js";
import { resolvePreferredOpenClawTmpDir } from "./runtime/openclaw-temp-dir.js";

interface RegisteredToolCall {
  tool: RegisteredAgentTool;
  opts?: { optional?: boolean };
}

function createMockApi(): {
  api: PluginApi;
  registeredTools: RegisteredToolCall[];
  registeredServices: RegisteredService[];
  registeredCommands: RegisteredCommand[];
  hookEvents: string[];
  warnMessages: string[];
} {
  const registeredTools: RegisteredToolCall[] = [];
  const registeredServices: RegisteredService[] = [];
  const registeredCommands: RegisteredCommand[] = [];
  const hookEvents: string[] = [];
  const warnMessages: string[] = [];
  const logger = {
    info() {},
    warn(message: string) {
      warnMessages.push(message);
    },
    error() {},
    debug() {},
  };

  const api = {
    config: {},
    pluginConfig: {
      tickflowApiKey: "test-tickflow-key",
      llmApiKey: "test-llm-key",
      alertTarget: "TEST_TARGET",
      databasePath: "./tmp/plugin-registration-test-db",
      calendarFile: "./day_future.txt",
      pythonWorkdir: "./python",
    },
    registrationMode: "full",
    resolvePath(input: string) {
      return path.resolve(process.cwd(), input);
    },
    runtime: undefined,
    logger,
    registerTool(tool: RegisteredAgentTool, opts?: { optional?: boolean }) {
      registeredTools.push({ tool, opts });
    },
    registerService(service: RegisteredService) {
      registeredServices.push(service);
    },
    registerCommand(command: RegisteredCommand) {
      registeredCommands.push(command);
    },
    on(event: string) {
      hookEvents.push(event);
    },
  } as unknown as PluginApi;

  return {
    api,
    registeredTools,
    registeredServices,
    registeredCommands,
    hookEvents,
    warnMessages,
  };
}

function mapToolOptionality(registeredTools: RegisteredToolCall[]): Map<string, boolean> {
  return new Map(
    registeredTools.map(({ tool, opts }) => [tool.name, opts?.optional === true]),
  );
}

function createAppConfig() {
  return {
    tickflowApiUrl: "https://api.tickflow.org",
    tickflowApiKey: "test-tickflow-key",
    tickflowApiKeyLevel: "free" as const,
    mxSearchApiUrl: "https://mkapi2.dfcfs.com/finskillshub/api/claw",
    mxSearchApiKey: "",
    llmBaseUrl: "https://api.openai.com/v1",
    llmApiKey: "test-llm-key",
    llmModel: "gpt-4o",
    jin10McpUrl: "https://mcp.jin10.com/mcp",
    jin10ApiToken: "",
    jin10FlashPollInterval: 300,
    jin10FlashRetentionDays: 7,
    jin10FlashNightAlert: false,
    databasePath: path.resolve(process.cwd(), "tmp", "plugin-registration-test-db"),
    calendarFile: path.resolve(process.cwd(), "day_future.txt"),
    requestInterval: 30,
    dailyUpdateNotify: true,
    alertChannel: "telegram",
    openclawCliBin: "openclaw",
    alertAccount: "",
    alertTarget: "TEST_TARGET",
    pythonBin: "uv",
    pythonArgs: ["run", "python"],
    pythonWorkdir: path.resolve(process.cwd(), "python"),
  };
}

const CONFIG_ENV_NAMES = [...new Set(Object.values(CONFIG_ENV_FALLBACKS).flat())];

async function withTemporaryEnv(
  values: Record<string, string | undefined>,
  callback: () => Promise<void> | void,
): Promise<void> {
  const previous = new Map<string, string | undefined>();

  for (const name of CONFIG_ENV_NAMES) {
    previous.set(name, process.env[name]);
    delete process.env[name];
  }

  for (const [name, value] of Object.entries(values)) {
    if (value == null) {
      delete process.env[name];
      continue;
    }
    process.env[name] = value;
  }

  try {
    await callback();
  } finally {
    for (const name of CONFIG_ENV_NAMES) {
      const value = previous.get(name);
      if (value == null) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

test("plugin registration marks state-changing tools as optional", () => {
  const {
    api,
    registeredTools,
    registeredServices,
    registeredCommands,
    hookEvents,
  } = createMockApi();

  pluginEntry.register(api);

  const optionality = mapToolOptionality(registeredTools);

  for (const toolName of [
    "add_stock",
    "remove_stock",
    "refresh_watchlist_names",
    "refresh_watchlist_profiles",
    "push_eastmoney_watchlist",
    "remove_eastmoney_watchlist",
    "start_monitor",
    "stop_monitor",
    "start_daily_update",
    "stop_daily_update",
    "sync_eastmoney_watchlist",
    "update_all",
    "test_alert",
  ]) {
    assert.equal(optionality.get(toolName), true, `${toolName} should be optional`);
  }

  for (const toolName of [
    "analyze",
    "backtest_key_levels",
    "daily_update_status",
    "fetch_financials",
    "flash_monitor_status",
    "fetch_intraday_klines",
    "fetch_klines",
    "list_eastmoney_watchlist",
    "list_watchlist",
    "monitor_status",
    "mx_data",
    "mx_search",
    "mx_select_stock",
    "query_database",
    "screen_stock_candidates",
    "view_analysis",
  ]) {
    assert.equal(optionality.get(toolName), false, `${toolName} should remain required`);
  }

  assert.ok(
    registeredServices.some((service) => service.id === "tickflow-assist.managed-loop"),
    "managed loop service should be registered in full mode",
  );
  assert.ok(
    registeredCommands.some((command) => command.name === "ta_addstock"),
    "slash commands should still be registered",
  );
  assert.ok(
    registeredCommands.some((command) => command.name === "ta_flashstatus"),
    "flash status command should be registered",
  );
  assert.ok(
    registeredCommands.some((command) => command.name === "ta_screenstocks"),
    "smart screening command should be registered",
  );
  assert.ok(
    registeredCommands.some((command) => command.name === "ta_screenstocks_llm"),
    "LLM smart screening command should be registered",
  );
  assert.ok(
    hookEvents.includes("before_prompt_build"),
    "stock-agent prompt hook should remain registered",
  );
});

test("community install manifest does not require secrets before setup", () => {
  const manifestPath = path.resolve(process.cwd(), "openclaw.plugin.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
    activation?: { onCapabilities?: string[] };
    providerAuthEnvVars?: Record<string, string[]>;
    providerAuthChoices?: Array<{
      provider?: string;
      choiceId?: string;
      assistantVisibility?: string;
    }>;
    setup?: {
      requiresRuntime?: boolean;
      providers?: Array<{ id?: string; envVars?: string[] }>;
    };
    configContracts?: {
      secretInputs?: {
        paths?: Array<{ path?: string }>;
      };
    };
    configSchema?: { required?: string[] };
  };

  assert.deepEqual(manifest.activation?.onCapabilities, ["tool", "hook"]);
  assert.deepEqual(manifest.providerAuthEnvVars, {
    tickflow: ["TICKFLOW_ASSIST_TICKFLOW_API_KEY", "TICKFLOW_API_KEY"],
    llm: ["TICKFLOW_ASSIST_LLM_API_KEY", "LLM_API_KEY"],
    "mx-search": [
      "TICKFLOW_ASSIST_MX_SEARCH_API_KEY",
      "MX_SEARCH_API_KEY",
      "MX_APIKEY",
    ],
    jin10: ["TICKFLOW_ASSIST_JIN10_API_TOKEN", "JIN10_API_TOKEN"],
  });
  assert.deepEqual(
    (manifest.providerAuthChoices ?? []).map((choice) => [
      choice.provider,
      choice.choiceId,
      choice.assistantVisibility,
    ]),
    [
      ["tickflow", "tickflow-api-key", "manual-only"],
      ["llm", "llm-api-key", "manual-only"],
      ["mx-search", "mx-search-api-key", "manual-only"],
      ["jin10", "jin10-api-token", "manual-only"],
    ],
  );
  assert.equal(manifest.setup?.requiresRuntime, true);
  assert.deepEqual(
    Object.fromEntries(
      (manifest.setup?.providers ?? [])
        .filter((provider): provider is { id: string; envVars?: string[] } => Boolean(provider.id))
        .map((provider) => [provider.id, provider.envVars ?? []]),
    ),
    {
      tickflow: ["TICKFLOW_ASSIST_TICKFLOW_API_KEY", "TICKFLOW_API_KEY"],
      llm: [
        "TICKFLOW_ASSIST_LLM_BASE_URL",
        "LLM_BASE_URL",
        "TICKFLOW_ASSIST_LLM_API_KEY",
        "LLM_API_KEY",
        "TICKFLOW_ASSIST_LLM_MODEL",
        "LLM_MODEL",
      ],
      "mx-search": [
        "TICKFLOW_ASSIST_MX_SEARCH_API_KEY",
        "MX_SEARCH_API_KEY",
        "MX_APIKEY",
      ],
      jin10: ["TICKFLOW_ASSIST_JIN10_API_TOKEN", "JIN10_API_TOKEN"],
    },
  );

  const secretPaths = new Set(
    (manifest.configContracts?.secretInputs?.paths ?? [])
      .map((entry) => entry.path)
      .filter((value): value is string => Boolean(value)),
  );
  assert.deepEqual(
    [...secretPaths].sort(),
    ["jin10ApiToken", "llmApiKey", "mxSearchApiKey", "tickflowApiKey"],
  );

  const required = manifest.configSchema?.required ?? [];
  assert.ok(!required.includes("tickflowApiKey"));
  assert.ok(!required.includes("llmApiKey"));
});

test("package metadata advertises npm install details for community distribution", () => {
  const packageJsonPath = path.resolve(process.cwd(), "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
    openclaw?: {
      install?: {
        npmSpec?: string;
        defaultChoice?: string;
        minHostVersion?: string;
      };
    };
  };

  assert.deepEqual(packageJson.openclaw?.install, {
    npmSpec: "tickflow-assist",
    defaultChoice: "npm",
    minHostVersion: ">=2026.3.31",
  });
});

test("stock analysis skill no longer hard-requires plaintext plugin secrets", () => {
  const skillPath = path.resolve(process.cwd(), "skills/stock-analysis/SKILL.md");
  const skillMarkdown = readFileSync(skillPath, "utf-8");

  assert.ok(skillMarkdown.includes("\"always\":true"));
  assert.ok(skillMarkdown.includes("\"primaryEnv\":\"TICKFLOW_ASSIST_TICKFLOW_API_KEY\""));
  assert.ok(skillMarkdown.includes("TICKFLOW_ASSIST_LLM_API_KEY"));
  assert.ok(skillMarkdown.includes("plugins.entries.tickflow-assist.enabled"));
  assert.ok(!skillMarkdown.includes("plugins.entries.tickflow-assist.config.tickflowApiKey"));
  assert.ok(!skillMarkdown.includes("plugins.entries.tickflow-assist.config.llmApiKey"));
  assert.ok(skillMarkdown.includes("环境变量 fallback"));
});

test("normalizePluginConfig falls back to env vars when config values are blank", async () => {
  await withTemporaryEnv(
    {
      TICKFLOW_ASSIST_TICKFLOW_API_URL: "https://env.tickflow.example",
      TICKFLOW_API_KEY: "env-tickflow-key",
      TICKFLOW_ASSIST_TICKFLOW_API_KEY_LEVEL: "Expert",
      TICKFLOW_ASSIST_MX_SEARCH_API_URL: "https://env.mx.example",
      MX_APIKEY: "env-mx-key",
      TICKFLOW_ASSIST_JIN10_MCP_URL: "https://env.jin10.example/mcp",
      JIN10_API_TOKEN: "env-jin10-token",
      LLM_BASE_URL: "https://env.llm.example/v1",
      TICKFLOW_ASSIST_LLM_API_KEY: "env-llm-key",
      LLM_MODEL: "gpt-env",
    },
    () => {
      const config = normalizePluginConfig({
        tickflowApiUrl: "",
        tickflowApiKey: "",
        tickflowApiKeyLevel: "",
        mxSearchApiUrl: "",
        mxSearchApiKey: "",
        jin10McpUrl: "",
        jin10ApiToken: "",
        llmBaseUrl: "",
        llmApiKey: "",
        llmModel: "",
      });

      assert.equal(config.tickflowApiUrl, "https://env.tickflow.example");
      assert.equal(config.tickflowApiKey, "env-tickflow-key");
      assert.equal(config.tickflowApiKeyLevel, "expert");
      assert.equal(config.mxSearchApiUrl, "https://env.mx.example");
      assert.equal(config.mxSearchApiKey, "env-mx-key");
      assert.equal(config.jin10McpUrl, "https://env.jin10.example/mcp");
      assert.equal(config.jin10ApiToken, "env-jin10-token");
      assert.equal(config.llmBaseUrl, "https://env.llm.example/v1");
      assert.equal(config.llmApiKey, "env-llm-key");
      assert.equal(config.llmModel, "gpt-env");
    },
  );
});

test("normalizePluginConfig accepts both legacy Start and canonical Starter levels", () => {
  assert.equal(
    normalizePluginConfig({ tickflowApiKeyLevel: "Start" }).tickflowApiKeyLevel,
    "starter",
  );
  assert.equal(
    normalizePluginConfig({ tickflowApiKeyLevel: "Starter" }).tickflowApiKeyLevel,
    "starter",
  );
});

test("normalizePluginConfig keeps explicit config values ahead of env fallbacks", async () => {
  await withTemporaryEnv(
    {
      TICKFLOW_API_KEY: "env-tickflow-key",
      MX_SEARCH_API_KEY: "env-mx-key",
      JIN10_API_TOKEN: "env-jin10-token",
      LLM_BASE_URL: "https://env.llm.example/v1",
      LLM_API_KEY: "env-llm-key",
      LLM_MODEL: "gpt-env",
    },
    () => {
      const config = normalizePluginConfig({
        tickflowApiKey: "config-tickflow-key",
        mxSearchApiKey: "config-mx-key",
        jin10ApiToken: "config-jin10-token",
        llmBaseUrl: "https://config.llm.example/v1",
        llmApiKey: "config-llm-key",
        llmModel: "gpt-config",
      });

      assert.equal(config.tickflowApiKey, "config-tickflow-key");
      assert.equal(config.mxSearchApiKey, "config-mx-key");
      assert.equal(config.jin10ApiToken, "config-jin10-token");
      assert.equal(config.llmBaseUrl, "https://config.llm.example/v1");
      assert.equal(config.llmApiKey, "config-llm-key");
      assert.equal(config.llmModel, "gpt-config");
    },
  );
});

test("plugin registration does not warn for missing credentials before community setup", () => {
  const { api, warnMessages } = createMockApi();
  api.pluginConfig = {
    databasePath: "./tmp/plugin-registration-test-db",
    calendarFile: "./day_future.txt",
    pythonWorkdir: "./python",
  };

  pluginEntry.register(api);

  assert.equal(
    warnMessages.some((message) => message.includes("config is incomplete")),
    false,
  );
});

test("alert media temp root stays under the shared OpenClaw temp directory", () => {
  const expectedPrefix = path.join(
    resolvePreferredOpenClawTmpDir(),
    "tickflow-assist",
    "alert-media",
    "tmp",
  );

  const pluginApp = createAppContext(createAppConfig(), {
    configSource: "openclaw_plugin",
  });
  const localApp = createAppContext(createAppConfig(), {
    configSource: "local_config",
  });

  assert.equal(
    pluginApp.services.alertMediaService.getTempRootDir().startsWith(expectedPrefix),
    true,
  );
  assert.equal(
    localApp.services.alertMediaService.getTempRootDir().startsWith(expectedPrefix),
    true,
  );
});

test("community-scanned build files do not ship child_process anymore", () => {
  for (const relativePath of [
    path.join("dist", "dev", "tickflow-assist-cli.js"),
    path.join("dist", "services", "alert-service.js"),
    path.join("dist", "services", "indicator-service.js"),
    path.join("dist", "tools", "start-monitor.tool.js"),
  ]) {
    const output = readFileSync(path.resolve(process.cwd(), relativePath), "utf-8");
    assert.equal(
      output.includes("child_process"),
      false,
      `${relativePath} should not reference child_process`,
    );
  }

  assert.equal(
    existsSync(path.resolve(process.cwd(), "dist", "runtime", "daily-update-process.js")),
    false,
  );
});

test("ta_startmonitor command returns a user-visible error when watchlist is empty", async () => {
  const { api, registeredCommands } = createMockApi();
  pluginEntry.register(api);

  const command = registeredCommands.find((entry) => entry.name === "ta_startmonitor");
  assert.ok(command, "ta_startmonitor should be registered");

  const result = await command.handler({ args: undefined } as never);
  assert.equal(typeof result.text, "string");
  assert.match(result.text ?? "", /无法启动实时监控/);
  assert.match(result.text ?? "", /ta_addstock/);
});

test("start_monitor avoids heavy status rendering when managed loop is already running", async () => {
  const monitorServiceStub = {
    async enableManagedLoop() {
      return { started: false };
    },
    async getState() {
      return {
        lastHeartbeatAt: "2026-04-01 14:23:45",
      };
    },
    async getStatusReport() {
      throw new Error("should not be called");
    },
  } as unknown as MonitorService;

  const tool = startMonitorTool(
    monitorServiceStub,
    { pluginManagedServices: true },
  );

  const text = await tool.run();
  assert.match(text, /已在运行/);
  assert.match(text, /最近心跳: 2026-04-01 14:23:45/);
});
