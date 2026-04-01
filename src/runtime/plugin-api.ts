import type {
  AnyAgentTool,
  OpenClawConfig,
  OpenClawPluginApi,
  OpenClawPluginCommandDefinition,
  OpenClawPluginDefinition,
  OpenClawPluginService,
  OpenClawPluginServiceContext,
  PluginCommandContext,
  PluginLogger,
} from "openclaw/plugin-sdk/plugin-entry";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

// ---------------------------------------------------------------------------
// Inline definePluginEntry to avoid a runtime import of the openclaw package.
// When installed via `openclaw plugins install`, the openclaw package is not
// present in the plugin's own node_modules (it is a devDependency used only
// for type-checking). The Gateway process provides the plugin API at runtime
// through the register() callback, so the only thing we need is this trivial
// helper that normalises the plugin definition object.
// ---------------------------------------------------------------------------

interface DefinePluginEntryOptions {
  id: string;
  name: string;
  description: string;
  kind?: OpenClawPluginDefinition["kind"];
  configSchema?: unknown;
  register: (api: OpenClawPluginApi) => void;
}

export interface PluginEntryResult {
  id: string;
  name: string;
  description: string;
  kind?: OpenClawPluginDefinition["kind"];
  register: (api: OpenClawPluginApi) => void;
}

export function definePluginEntry({
  id,
  name,
  description,
  kind,
  register,
}: DefinePluginEntryOptions): PluginEntryResult {
  return {
    id,
    name,
    description,
    ...(kind ? { kind } : {}),
    register,
  };
}

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
