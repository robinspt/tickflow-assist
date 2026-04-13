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
    "openclaw_plugin",
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

test("test_alert reports text-only fallback when png delivery fails in plugin mode", async () => {
  const alert = createAlertServiceStub([
    {
      ok: true,
      mediaAttempted: true,
      mediaDelivered: false,
      error: "media upload failed",
    },
  ]);
  const media = createAlertMediaStub();

  const tool = testAlertTool(
    alert.service as never,
    media.service as never,
    "openclaw_plugin",
  );

  const result = await tool.run();

  assert.equal(result, "⚠️ 测试告警文本已发送，但 PNG 未送达，已回退为纯文本\n原因: media upload failed");
  assert.equal(alert.calls.length, 1);
  assert.equal(alert.calls[0]?.mediaPath, "/tmp/test-alert-card.png");
  assert.deepEqual(media.removed, ["/tmp/test-alert-card.png"]);
});

test("test_alert reports ambiguous png delivery without split retries", async () => {
  const alert = createAlertServiceStub([
    {
      ok: false,
      mediaAttempted: true,
      mediaDelivered: false,
      error: "runtime delivery failed: message send timed out after upload",
      deliveryUncertain: true,
    },
  ]);
  const media = createAlertMediaStub();

  const tool = testAlertTool(
    alert.service as never,
    media.service as never,
    "openclaw_plugin",
  );

  const result = await tool.run();

  assert.equal(
    result,
    "⚠️ PNG 告警疑似已送达，但通道返回异常；为避免重复未执行拆分补发\n"
      + "原因: runtime delivery failed: message send timed out after upload",
  );
  assert.equal(alert.calls.length, 1);
  assert.equal(alert.calls[0]?.mediaPath, "/tmp/test-alert-card.png");
  assert.deepEqual(media.removed, ["/tmp/test-alert-card.png"]);
});

test("test_alert treats png fallback as expected in local command mode", async () => {
  const alert = createAlertServiceStub([
    {
      ok: true,
      mediaAttempted: false,
      mediaDelivered: false,
      error: null,
    },
  ]);
  const media = createAlertMediaStub();

  const tool = testAlertTool(
    alert.service as never,
    media.service as never,
    "local_config",
  );

  const result = await tool.run();

  assert.equal(
    result,
    "✅ 测试告警文本已发送（本地命令模式）\n"
      + "说明: `npm run tool -- test_alert` 仅验证文本链路；请通过 `/ta_testalert` 验证 PNG 图片链路。",
  );
  assert.equal(alert.calls.length, 1);
  assert.equal(alert.calls[0]?.mediaPath, undefined);
  assert.equal(media.writeCalls.length, 0);
  assert.deepEqual(media.removed, []);
});
