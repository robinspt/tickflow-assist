import type { LocalTool, PluginApi, RegisteredAgentTool } from "./runtime/plugin-api.js";
import { normalizePluginConfig, validatePluginConfig } from "./config/normalize.js";
import { createAppContext } from "./bootstrap.js";

const GENERIC_TOOL_PARAMETERS_SCHEMA = {
  type: "object",
  description:
    "Pass tool arguments as top-level fields. For tools that take a single free-form value, you may also use input or rawInput.",
  properties: {
    input: {
      type: "string",
      description: "Optional free-form text input for tools that accept a single textual argument.",
    },
    rawInput: {
      description: "Optional compatibility field; if present, it is forwarded directly to the tool.",
    },
  },
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

export default async function registerTickFlowAssist(api: PluginApi): Promise<void> {
  const config = normalizePluginConfig(api.config ?? {});
  const errors = validatePluginConfig(config);

  if (errors.length > 0) {
    api.log?.warn?.("tickflow-assist config is incomplete", { errors });
  }

  const app = createAppContext(config, {
    configSource: "openclaw_plugin",
    pluginManagedServices: typeof api.registerService === "function",
  });

  api.log?.info?.("tickflow-assist plugin loaded", {
    tickflowApiKeyLevel: config.tickflowApiKeyLevel,
    calendarFile: config.calendarFile,
    requestInterval: config.requestInterval,
    alertChannel: config.alertChannel,
    databasePath: config.databasePath,
    pluginManagedServices: app.runtime.pluginManagedServices,
  });

  for (const tool of app.tools) {
    api.registerTool?.(toAgentTool(tool));
  }

  for (const service of app.backgroundServices) {
    api.registerService?.(service);
  }
}
