export interface ToolContext {
  rawInput?: unknown;
}

export interface LocalTool {
  name: string;
  description: string;
  run: (context: ToolContext) => Promise<string> | string;
}

export interface RegisteredAgentToolResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
}

export interface RegisteredAgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
  ) => Promise<RegisteredAgentToolResult> | RegisteredAgentToolResult;
}

export interface ServiceContext {
  signal?: AbortSignal;
}

export interface RegisteredService {
  id: string;
  description: string;
  start: (context: ServiceContext) => Promise<void> | void;
  stop?: () => Promise<void> | void;
}

export interface PluginApi {
  config?: unknown;
  log?: {
    info?: (message: string, meta?: Record<string, unknown>) => void;
    warn?: (message: string, meta?: Record<string, unknown>) => void;
    error?: (message: string, meta?: Record<string, unknown>) => void;
  };
  registerTool?: (tool: RegisteredAgentTool) => void;
  registerService?: (service: RegisteredService) => void;
}

export interface PluginDefinition {
  id: string;
  name: string;
  register: (api: PluginApi) => void | Promise<void>;
}

export function definePlugin(definition: PluginDefinition): PluginDefinition {
  return definition;
}
