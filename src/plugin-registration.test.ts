import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createAppContext } from "./bootstrap.js";
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
    "start_monitor",
    "stop_monitor",
    "start_daily_update",
    "stop_daily_update",
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
    "fetch_intraday_klines",
    "fetch_klines",
    "list_watchlist",
    "monitor_status",
    "mx_search",
    "mx_select_stock",
    "query_database",
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
    hookEvents.includes("before_prompt_build"),
    "stock-agent prompt hook should remain registered",
  );
});

test("community install manifest does not require secrets before setup", () => {
  const manifestPath = path.resolve(process.cwd(), "openclaw.plugin.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
    configSchema?: { required?: string[] };
  };

  const required = manifest.configSchema?.required ?? [];
  assert.ok(!required.includes("tickflowApiKey"));
  assert.ok(!required.includes("llmApiKey"));
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
