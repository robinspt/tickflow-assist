import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import pluginEntry from "./plugin.js";
import type {
  PluginApi,
  RegisteredAgentTool,
  RegisteredCommand,
  RegisteredService,
} from "./runtime/plugin-api.js";

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
} {
  const registeredTools: RegisteredToolCall[] = [];
  const registeredServices: RegisteredService[] = [];
  const registeredCommands: RegisteredCommand[] = [];
  const hookEvents: string[] = [];
  const logger = {
    info() {},
    warn() {},
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
  };
}

function mapToolOptionality(registeredTools: RegisteredToolCall[]): Map<string, boolean> {
  return new Map(
    registeredTools.map(({ tool, opts }) => [tool.name, opts?.optional === true]),
  );
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
