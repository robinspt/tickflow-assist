import assert from "node:assert/strict";
import test from "node:test";

import { parseJsonRpcResponse } from "./jin10-mcp-service.js";

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
