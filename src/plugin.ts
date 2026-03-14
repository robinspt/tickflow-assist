import type { LocalTool, PluginApi, RegisteredAgentTool } from "./runtime/plugin-api.js";
import { normalizePluginConfig, validatePluginConfig } from "./config/normalize.js";
import { createAppContext } from "./bootstrap.js";
import { registerPluginCommands } from "./plugin-commands.js";

const GENERIC_TOOL_PARAMETERS_SCHEMA = {
  type: "object",
  description: "Pass tool arguments as top-level JSON fields.",
  properties: {},
  additionalProperties: true,
} as const;

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
    description: `${tool.description} Pass arguments as top-level JSON fields.`,
    parameters: GENERIC_TOOL_PARAMETERS_SCHEMA,
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      const text = await tool.run({ rawInput: extractRawInput(params) });
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
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

export default function registerTickFlowAssist(api: PluginApi): void {
  const config = normalizePluginConfig(api.config ?? {});
  const errors = validatePluginConfig(config);
  const pluginManagedServices = false;

  api.log?.info?.("tickflow-assist plugin registering", {
    rawConfigKeys: summarizeConfigKeys(api.config),
    calendarFile: config.calendarFile,
    databasePath: config.databasePath,
    requestInterval: config.requestInterval,
  });

  if (errors.length > 0) {
    api.log?.warn?.("tickflow-assist config is incomplete", { errors });
  }

  const app = createAppContext(config, {
    configSource: "openclaw_plugin",
    pluginManagedServices,
  });

  api.log?.info?.("tickflow-assist plugin loaded", {
    tickflowApiKeyLevel: config.tickflowApiKeyLevel,
    calendarFile: config.calendarFile,
    requestInterval: config.requestInterval,
    alertChannel: config.alertChannel,
    databasePath: config.databasePath,
    pluginManagedServices,
    toolNames: app.tools.map((tool) => tool.name),
  });

  for (const tool of app.tools) {
    api.registerTool?.(toAgentTool(tool));
  }

  registerPluginCommands(api, app.tools, app);
}
