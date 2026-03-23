
import path from "node:path";

import { Type } from "@sinclair/typebox";

import { createAppContext } from "./bootstrap.js";
import { normalizePluginConfig, validatePluginConfig } from "./config/normalize.js";
import { registerPluginCommands } from "./plugin-commands.js";
import {
  definePluginEntry,
  type LocalTool,
  type PluginApi,
  type RegisteredAgentTool,
} from "./runtime/plugin-api.js";

const PLUGIN_ID = "tickflow-assist";
const PLUGIN_NAME = "TickFlow Assist";
const PLUGIN_DESCRIPTION =
  "A-share watchlist analysis, monitoring, and alert delivery powered by TickFlow and OpenClaw.";
const STOCK_AGENT_ID = "stock";
const STOCK_PROMPT_ENFORCEMENT = [
  "You are handling the stock agent.",
  "For watchlist management and stock status intents, prefer TickFlow Assist plugin tools over generic built-in tools.",
  "If the user asks to add a stock and provides a symbol, your first action must be calling add_stock.",
  "If the user asks to remove a stock and provides symbol, your first action must be calling remove_stock.",
  "If the user asks for watchlist, your first action must be calling list_watchlist.",
  "Do not call read, write, edit, query_database, session tools, or environment-inspection tools to figure out how to perform add/remove/list watchlist actions.",
  "Do not say you need to inspect the environment, confirm available tools, or find the method first when add_stock/remove_stock/list_watchlist are available.",
  "If a required tool parameter is missing, ask only for that missing parameter.",
].join("\n");

const GENERIC_TOOL_PARAMETERS_SCHEMA = Type.Object(
  {},
  {
    additionalProperties: true,
    description: "Pass tool arguments as top-level JSON fields.",
  },
);

function extractRawInput(params: Record<string, unknown>): unknown {
  const keys = Object.keys(params);
  if (keys.length === 0) {
    return undefined;
  }
  if (keys.length === 1 && "rawInput" in params) {
    return params.rawInput;
  }
  if (keys.length === 1 && "input" in params) {
    return params.input;
  }
  return params;
}

function toAgentTool(tool: LocalTool): RegisteredAgentTool {
  return {
    name: tool.name,
    label: tool.name,
    description: `${tool.description} Pass arguments as top-level JSON fields.`,
    parameters: GENERIC_TOOL_PARAMETERS_SCHEMA,
    async execute(_toolCallId, params) {
      const text = await tool.run({
        rawInput: extractRawInput(params as Record<string, unknown>),
      });
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
        details: {
          text,
        },
      };
    },
  };
}

function summarizeConfigKeys(config: unknown): string[] {
  if (typeof config !== "object" || config === null) {
    return [];
  }
  return Object.keys(config as Record<string, unknown>).sort();
}

function resolvePluginPath(value: string, resolvePath: (input: string) => string): string {
  if (!value || path.isAbsolute(value)) {
    return value;
  }
  return resolvePath(value);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function logInfo(api: PluginApi, message: string, meta?: Record<string, unknown>): void {
  api.logger.info(meta ? `${message} ${safeJson(meta)}` : message);
}

function logWarn(api: PluginApi, message: string, meta?: Record<string, unknown>): void {
  api.logger.warn(meta ? `${message} ${safeJson(meta)}` : message);
}

function registerTickFlowAssist(api: PluginApi): void {
  const pluginConfigInput = api.pluginConfig ?? {};
  const normalizedConfig = normalizePluginConfig(pluginConfigInput);
  const config = {
    ...normalizedConfig,
    databasePath: resolvePluginPath(normalizedConfig.databasePath, api.resolvePath),
    calendarFile: resolvePluginPath(normalizedConfig.calendarFile, api.resolvePath),
    pythonWorkdir: resolvePluginPath(normalizedConfig.pythonWorkdir, api.resolvePath),
  };
  const errors = validatePluginConfig(config);
  const pluginManagedServices = api.registrationMode === "full";

  logInfo(api, "tickflow-assist plugin registering", {
    registrationMode: api.registrationMode,
    rawConfigKeys: summarizeConfigKeys(api.config),
    pluginConfigKeys: summarizeConfigKeys(pluginConfigInput),
    calendarFile: config.calendarFile,
    databasePath: config.databasePath,
    requestInterval: config.requestInterval,
  });

  if (errors.length > 0) {
    logWarn(api, "tickflow-assist config is incomplete", { errors });
  }

  if (api.registrationMode === "setup-only") {
    return;
  }

  const app = createAppContext(config, {
    configSource: "openclaw_plugin",
    pluginManagedServices,
    openclawConfig: api.config,
    pluginRuntime: api.runtime,
  });

  logInfo(api, "tickflow-assist plugin loaded", {
    tickflowApiKeyLevel: config.tickflowApiKeyLevel,
    calendarFile: config.calendarFile,
    requestInterval: config.requestInterval,
    alertChannel: config.alertChannel,
    databasePath: config.databasePath,
    pluginManagedServices,
    toolNames: app.tools.map((tool) => tool.name),
  });

  for (const tool of app.tools) {
    api.registerTool(toAgentTool(tool));
  }

  if (pluginManagedServices) {
    for (const service of app.backgroundServices) {
      api.registerService(service);
    }
  }

  registerPluginCommands(api, app.tools, app);

  api.on(
    "before_prompt_build",
    (_event, context) => {
      if (context.agentId !== STOCK_AGENT_ID) {
        return;
      }

      return {
        prependSystemContext: STOCK_PROMPT_ENFORCEMENT,
      };
    },
    { priority: 100 },
  );
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  description: PLUGIN_DESCRIPTION,
  register: registerTickFlowAssist,
});
