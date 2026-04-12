import { formatConfigEnvFallback } from "../config/env.js";
import type { Jin10FlashItem, Jin10FlashPage } from "../types/jin10.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id?: string | number;
  result?: T;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface McpToolCallResult {
  content?: Array<{
    type?: string;
    text?: string;
    structuredContent?: unknown;
  }>;
  isError?: boolean;
  structuredContent?: unknown;
}

export class Jin10McpService {
  private requestId = 1;
  private initialized = false;
  private sessionId: string | null = null;
  private initializePromise: Promise<void> | null = null;

  constructor(
    private readonly serverUrl: string,
    private readonly apiToken: string,
  ) {}

  isConfigured(): boolean {
    return this.getConfigurationError() == null;
  }

  getConfigurationError(): string | null {
    if (!this.serverUrl.trim()) {
      return `Jin10 MCP 未配置接口地址，请设置 jin10McpUrl 或环境变量 ${formatConfigEnvFallback("jin10McpUrl")}`;
    }
    if (!this.apiToken.trim()) {
      return `Jin10 MCP 未配置 API Token，请设置 jin10ApiToken 或环境变量 ${formatConfigEnvFallback("jin10ApiToken")}`;
    }
    return null;
  }

  async listFlash(cursor?: string): Promise<Jin10FlashPage> {
    const payload = await this.callTool("list_flash", cursor ? { cursor } : {});
    return normalizeFlashPage(payload);
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initializePromise ??= this.performInitialize().finally(() => {
      this.initializePromise = null;
    });
    await this.initializePromise;
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      await this.initialize();
      const result = await this.request<McpToolCallResult>("tools/call", {
        name,
        arguments: args,
      });

      if (!result) {
        throw new Error(`jin10 tool ${name} returned empty result`);
      }
      if (result.isError) {
        throw new Error(`jin10 tool ${name} returned MCP error`);
      }
      if (result.structuredContent !== undefined) {
        return result.structuredContent;
      }

      const structured = result.content?.find((item) => item.structuredContent !== undefined)?.structuredContent;
      if (structured !== undefined) {
        return structured;
      }

      const text = result.content?.find((item) => typeof item.text === "string")?.text;
      if (typeof text === "string" && text.trim()) {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }

      return result;
    } catch (error) {
      if (!isSessionExpiredError(error)) {
        throw error;
      }

      this.resetSession();
      await this.initialize();
      return await this.callToolAfterRecovery(name, args);
    }
  }

  private async performInitialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: {
        name: "mcp-client",
        version: "1.0.0",
      },
    });
    await this.notify("notifications/initialized");

    try {
      await this.request("tools/list", {});
      await this.request("resources/list", {});
    } catch {
      // Tool listing is a best-effort handshake step.
    }

    this.initialized = true;
  }

  private async callToolAfterRecovery(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.request<McpToolCallResult>("tools/call", {
      name,
      arguments: args,
    });

    if (!result) {
      throw new Error(`jin10 tool ${name} returned empty result`);
    }
    if (result.isError) {
      throw new Error(`jin10 tool ${name} returned MCP error`);
    }
    if (result.structuredContent !== undefined) {
      return result.structuredContent;
    }

    const structured = result.content?.find((item) => item.structuredContent !== undefined)?.structuredContent;
    if (structured !== undefined) {
      return structured;
    }

    const text = result.content?.find((item) => typeof item.text === "string")?.text;
    if (typeof text === "string" && text.trim()) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    return result;
  }

  private resetSession(): void {
    this.initialized = false;
    this.sessionId = null;
    this.initializePromise = null;
  }

  private async request<T>(method: string, params: unknown): Promise<T> {
    const configError = this.getConfigurationError();
    if (configError) {
      throw new Error(configError);
    }

    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: this.requestId++,
      method,
      params,
    };

    const response = await fetch(this.serverUrl, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(payload),
    });

    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) {
      this.sessionId = sessionId;
    }

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`jin10 MCP request failed: ${response.status} ${response.statusText} ${rawText}`);
    }

    const parsed = parseJsonRpcResponse<T>(rawText, payload.id);
    if (parsed.error) {
      throw new Error(
        `jin10 MCP error (${parsed.error.code ?? "unknown"}): ${parsed.error.message ?? "unknown"}`,
      );
    }
    return parsed.result as T;
  }

  private async notify(method: string): Promise<void> {
    const configError = this.getConfigurationError();
    if (configError) {
      throw new Error(configError);
    }

    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
    };

    const response = await fetch(this.serverUrl, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(payload),
    });

    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) {
      this.sessionId = sessionId;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`jin10 MCP notification failed: ${response.status} ${response.statusText} ${text}`);
    }
  }

  private buildHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiToken}`,
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    return headers;
  }
}

export function parseJsonRpcResponse<T>(
  rawText: string,
  expectedId?: string | number,
): JsonRpcResponse<T> {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("jin10 MCP returned empty body");
  }

  if (!looksLikeSsePayload(trimmed)) {
    return JSON.parse(trimmed) as JsonRpcResponse<T>;
  }

  const candidates = parseSseJsonRpcResponses<T>(trimmed);
  if (candidates.length === 0) {
    throw new Error(`jin10 MCP SSE payload missing JSON-RPC data: ${truncate(trimmed, 160)}`);
  }

  if (expectedId !== undefined) {
    const matched = candidates.find((entry) => entry.id === expectedId);
    if (matched) {
      return matched;
    }
  }

  const withResult = candidates.find((entry) => entry.result !== undefined || entry.error !== undefined);
  if (withResult) {
    return withResult;
  }

  return candidates[candidates.length - 1] as JsonRpcResponse<T>;
}

function parseSseJsonRpcResponses<T>(rawText: string): JsonRpcResponse<T>[] {
  const events = rawText
    .split(/\r?\n\r?\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const responses: JsonRpcResponse<T>[] = [];
  for (const eventText of events) {
    const payload = extractSseData(eventText);
    if (!payload || payload === "[DONE]") {
      continue;
    }

    try {
      responses.push(JSON.parse(payload) as JsonRpcResponse<T>);
    } catch {
      continue;
    }
  }

  return responses;
}

function extractSseData(eventText: string): string {
  const dataLines = eventText
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s?/, ""));
  return dataLines.join("\n").trim();
}

function looksLikeSsePayload(value: string): boolean {
  return value.startsWith("data:")
    || value.startsWith("event:")
    || value.startsWith(":")
    || /\r?\ndata:/.test(value)
    || /\r?\nevent:/.test(value);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function isSessionExpiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /session not found|unknown session|invalid session/i.test(message);
}

function normalizeFlashPage(value: unknown): Jin10FlashPage {
  const root = isRecord(value) ? value : {};
  const data = isRecord(root.data) ? root.data : {};
  const items = Array.isArray(data.items) ? data.items : [];

  return {
    hasMore: data.has_more === true,
    items: items
      .map((item) => normalizeFlashItem(item))
      .filter((item): item is Jin10FlashItem => item != null),
    nextCursor: normalizeNullableString(data.next_cursor),
  };
}

function normalizeFlashItem(value: unknown): Jin10FlashItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const content = String(value.content ?? "").trim();
  const time = String(value.time ?? "").trim();
  const url = String(value.url ?? "").trim();
  if (!content || !time || !url) {
    return null;
  }

  return {
    content,
    time,
    url,
    raw: value,
  };
}

function normalizeNullableString(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
