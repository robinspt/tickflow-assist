import assert from "node:assert/strict";
import test from "node:test";

import type { AlertSendInput, AlertSendResult } from "../services/alert-service.js";
import { testAlertTool } from "./test-alert.tool.js";

function createAlertServiceStub(results: AlertSendResult[]) {
  const calls: AlertSendInput[] = [];

  return {
    calls,
    service: {
      formatSystemNotification(title: string, lines: string[]): string {
        return `${title}\n\n${lines.join("\n")}`;
      },
      async sendWithResult(input: AlertSendInput): Promise<AlertSendResult> {
        calls.push(input);
        const next = results.shift();
        if (!next) {
          throw new Error("unexpected sendWithResult call");
        }
        return next;
      },
      getLastError(): string | null {
        return null;
      },
    },
  };
}

function createAlertMediaStub() {
  const writeCalls: Array<{ symbol: string; ruleName: string }> = [];
  const removed: string[] = [];

  return {
    writeCalls,
    removed,
    service: {
      async writeAlertCard(params: { symbol: string; ruleName: string }) {
        writeCalls.push(params);
        return {
          filePath: "/tmp/test-alert-card.png",
          filename: "test-alert-card.png",
          mediaLocalRoots: ["/tmp"],
        };
      },
      async removeFile(filePath: string) {
        removed.push(filePath);
      },
    },
  };
}

test("test_alert sends text plus png when media delivery succeeds", async () => {
  const alert = createAlertServiceStub([
    {
      ok: true,
      mediaAttempted: true,
      mediaDelivered: true,
      error: null,
    },
  ]);
  const media = createAlertMediaStub();

  const tool = testAlertTool(
    alert.service as never,
    media.service as never,
  );

  const result = await tool.run();

  assert.equal(result, "✅ 测试告警发送成功（文本 + PNG）");
  assert.equal(alert.calls.length, 1);
  assert.match(alert.calls[0]?.message ?? "", /PNG 告警卡投递链路/);
  assert.equal(alert.calls[0]?.mediaPath, "/tmp/test-alert-card.png");
  assert.equal(media.writeCalls.length, 1);
  assert.equal(media.writeCalls[0]?.symbol, "000001.SZ");
  assert.equal(media.writeCalls[0]?.ruleName, "test_alert");
  assert.deepEqual(media.removed, ["/tmp/test-alert-card.png"]);
});

test("test_alert reports text-only fallback when png delivery fails", async () => {
  const alert = createAlertServiceStub([
    {
      ok: true,
      mediaAttempted: true,
      mediaDelivered: false,
      error: null,
    },
  ]);
  const media = createAlertMediaStub();

  const tool = testAlertTool(
    alert.service as never,
    media.service as never,
  );

  const result = await tool.run();

  assert.equal(result, "⚠️ 测试告警文本已发送，但 PNG 未送达，已回退为纯文本");
  assert.equal(alert.calls.length, 1);
  assert.equal(alert.calls[0]?.mediaPath, "/tmp/test-alert-card.png");
  assert.deepEqual(media.removed, ["/tmp/test-alert-card.png"]);
});
