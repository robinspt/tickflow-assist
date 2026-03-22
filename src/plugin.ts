import type { LocalTool, PluginApi, RegisteredAgentTool } from "./runtime/plugin-api.js";
import { normalizePluginConfig, validatePluginConfig } from "./config/normalize.js";
import { createAppContext } from "./bootstrap.js";
import { registerPluginCommands } from "./plugin-commands.js";

const PLUGIN_ID = "tickflow-assist";
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

function extractPluginConfig(rawConfig: unknown): unknown {
  if (typeof rawConfig !== "object" || rawConfig === null) {
    return rawConfig;
  }

  const root = rawConfig as {
    plugins?: {
      entries?: Record<string, { config?: unknown } | undefined>;
    };
  };

  return root.plugins?.entries?.[PLUGIN_ID]?.config ?? rawConfig;
}

function extractAgentId(event: unknown, context: unknown): string | undefined {
  if (typeof context === "object" && context !== null) {
    const ctx = context as {
      agentId?: unknown;
      agent?: {
        id?: unknown;
      };
    };
    if (typeof ctx.agentId === "string" && ctx.agentId.trim()) {
      return ctx.agentId;
    }
    if (typeof ctx.agent?.id === "string" && ctx.agent.id.trim()) {
      return ctx.agent.id;
    }
  }

  if (typeof event === "object" && event !== null) {
    const evt = event as {
      agentId?: unknown;
      agent?: {
        id?: unknown;
      };
    };
    if (typeof evt.agentId === "string" && evt.agentId.trim()) {
      return evt.agentId;
    }
    if (typeof evt.agent?.id === "string" && evt.agent.id.trim()) {
      return evt.agent.id;
    }
  }

  return undefined;
}

export default function registerTickFlowAssist(api: PluginApi): void {
  const pluginConfigInput = extractPluginConfig(api.config);
  const config = normalizePluginConfig(pluginConfigInput ?? {});
  const errors = validatePluginConfig(config);
  const pluginManagedServices = typeof api.registerService === "function";

  api.log?.info?.("tickflow-assist plugin registering", {
    rawConfigKeys: summarizeConfigKeys(api.config),
    pluginConfigKeys: summarizeConfigKeys(pluginConfigInput),
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

  if (pluginManagedServices) {
    for (const service of app.backgroundServices) {
      api.registerService?.(service);
    }
  }

  registerPluginCommands(api, app.tools, app);

  api.on?.(
    "before_prompt_build",
    (event, context) => {
      if (extractAgentId(event, context) !== STOCK_AGENT_ID) {
        return;
      }

      return {
        prependSystemContext: STOCK_PROMPT_ENFORCEMENT,
      };
    },
    { priority: 100 },
  );
}
