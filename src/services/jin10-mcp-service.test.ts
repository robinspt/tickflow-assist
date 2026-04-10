import assert from "node:assert/strict";
import test from "node:test";

import { Jin10McpService, parseJsonRpcResponse } from "./jin10-mcp-service.js";

test("parseJsonRpcResponse parses plain JSON-RPC bodies", () => {
  const parsed = parseJsonRpcResponse<{ ok: boolean }>(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { ok: true },
    }),
    1,
  );

  assert.deepEqual(parsed, {
    jsonrpc: "2.0",
    id: 1,
    result: { ok: true },
  });
});

test("parseJsonRpcResponse parses SSE message events", () => {
  const parsed = parseJsonRpcResponse<{ ok: boolean }>(
    [
      "event: message",
      'data: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}',
      "",
    ].join("\n"),
    2,
  );

  assert.deepEqual(parsed, {
    jsonrpc: "2.0",
    id: 2,
    result: { ok: true },
  });
});

test("parseJsonRpcResponse skips non-JSON SSE data and matches the expected id", () => {
  const parsed = parseJsonRpcResponse<{ value: string }>(
    [
      "event: endpoint",
      "data: /mcp/messages/?session_id=test",
      "",
      "event: message",
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":0.5}}',
      "",
      "event: message",
      'data: {"jsonrpc":"2.0","id":3,"result":{"value":"ok"}}',
      "",
    ].join("\n"),
    3,
  );

  assert.deepEqual(parsed, {
    jsonrpc: "2.0",
    id: 3,
    result: { value: "ok" },
  });
});

test("listFlash resets the MCP session and retries once when the server returns session not found", async () => {
  const originalFetch = globalThis.fetch;
  const seenSessionIds: Array<string | null> = [];

  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    seenSessionIds.push(headers.get("Mcp-Session-Id"));
    const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };

    switch (seenSessionIds.length) {
      case 1:
        assert.equal(body.method, "initialize");
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { protocolVersion: "2025-11-25" },
          }),
          {
            status: 200,
            headers: { "mcp-session-id": "session-a" },
          },
        );
      case 2:
        assert.equal(body.method, "notifications/initialized");
        return new Response("", {
          status: 200,
          headers: { "mcp-session-id": "session-a" },
        });
      case 3:
      case 4:
        assert.match(String(body.method), /^(tools|resources)\/list$/);
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: seenSessionIds.length - 1,
            result: {},
          }),
          {
            status: 200,
            headers: { "mcp-session-id": "session-a" },
          },
        );
      case 5:
        assert.equal(body.method, "tools/call");
        return new Response("session not found", { status: 404, statusText: "Not Found" });
      case 6:
        assert.equal(body.method, "initialize");
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 5,
            result: { protocolVersion: "2025-11-25" },
          }),
          {
            status: 200,
            headers: { "mcp-session-id": "session-b" },
          },
        );
      case 7:
        assert.equal(body.method, "notifications/initialized");
        return new Response("", {
          status: 200,
          headers: { "mcp-session-id": "session-b" },
        });
      case 8:
      case 9:
        assert.match(String(body.method), /^(tools|resources)\/list$/);
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: seenSessionIds.length - 3,
            result: {},
          }),
          {
            status: 200,
            headers: { "mcp-session-id": "session-b" },
          },
        );
      case 10:
        assert.equal(body.method, "tools/call");
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 9,
            result: {
              structuredContent: {
                data: {
                  items: [],
                  has_more: false,
                  next_cursor: null,
                },
              },
            },
          }),
          {
            status: 200,
            headers: { "mcp-session-id": "session-b" },
          },
        );
      default:
        throw new Error(`unexpected fetch call #${seenSessionIds.length}`);
    }
  };

  try {
    const service = new Jin10McpService("https://mcp.jin10.com/mcp", "test-token");
    const page = await service.listFlash();

    assert.deepEqual(page, {
      items: [],
      hasMore: false,
      nextCursor: null,
    });
    assert.deepEqual(seenSessionIds, [
      null,
      "session-a",
      "session-a",
      "session-a",
      "session-a",
      null,
      "session-b",
      "session-b",
      "session-b",
      "session-b",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
