import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  AnyAgentTool,
  OpenClawConfig,
  OpenClawPluginApi,
  OpenClawPluginCommandDefinition,
  OpenClawPluginService,
  OpenClawPluginServiceContext,
  PluginCommandContext,
  PluginLogger,
} from "openclaw/plugin-sdk/plugin-entry";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

export { definePluginEntry };

export interface ToolContext {
  rawInput?: unknown;
}

export interface LocalTool {
  name: string;
  description: string;
  optional?: boolean;
  run: (context: ToolContext) => Promise<string> | string;
}

export type PluginApi = OpenClawPluginApi;
export type RegisteredAgentTool = AnyAgentTool;
export type RegisteredService = OpenClawPluginService;
export type ServiceContext = OpenClawPluginServiceContext;
export type RegisteredCommand = OpenClawPluginCommandDefinition;
export type CommandContext = PluginCommandContext;
export type OpenClawPluginConfig = OpenClawConfig;
export type OpenClawPluginRuntime = PluginRuntime;
export type OpenClawPluginLogger = PluginLogger;
