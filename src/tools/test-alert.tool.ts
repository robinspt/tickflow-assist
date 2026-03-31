import { AlertService } from "../services/alert-service.js";
import { AlertMediaService } from "../services/alert-media-service.js";
import { formatChinaDateTime } from "../utils/china-time.js";

export function testAlertTool(
  alertService: AlertService,
  alertMediaService: AlertMediaService,
  configSource: "openclaw_plugin" | "local_config" = "openclaw_plugin",
) {
  return {
    name: "test_alert",
    description: "Send a test alert through the configured OpenClaw alert delivery path. Plugin mode includes PNG; local mode sends text only.",
    optional: true,
    async run(): Promise<string> {
      const now = formatChinaDateTime();
      const message = alertService.formatSystemNotification("🧪 TickFlow 测试告警", [
        `时间: ${now}`,
        "说明: 这是一条手动触发的测试消息，用于验证文本与 PNG 告警卡投递链路正常。",
      ]);

      if (configSource === "local_config") {
        const result = await alertService.sendWithResult({ message });
        if (result.ok) {
          return [
            "✅ 测试告警文本已发送（本地命令模式）",
            "说明: `npm run tool -- test_alert` 仅验证文本链路；请通过 `/ta_testalert` 验证 PNG 图片链路。",
          ].join("\n");
        }

        const detail = result.error ?? alertService.getLastError();
        return detail
          ? `❌ 测试告警发送失败\n原因: ${detail}`
          : "❌ 测试告警发送失败";
      }

      let mediaFile: Awaited<ReturnType<AlertMediaService["writeAlertCard"]>> | null = null;
      try {
        mediaFile = await alertMediaService.writeAlertCard({
          symbol: "000001.SZ",
          ruleName: "test_alert",
          image: buildTestAlertImage(now),
        });
      } catch (error) {
        const textOnlyResult = await alertService.sendWithResult({ message });
        if (textOnlyResult.ok) {
          return [
            "⚠️ 测试告警文本已发送，但 PNG 生成失败",
            `原因: ${formatErrorMessage(error)}`,
          ].join("\n");
        }

        const detail = textOnlyResult.error ?? alertService.getLastError() ?? "未知错误";
        return [
          "❌ 测试告警发送失败",
          `PNG 生成失败: ${formatErrorMessage(error)}`,
          `文本发送失败: ${detail}`,
        ].join("\n");
      }

      try {
        const result = await alertService.sendWithResult({
          message,
          mediaPath: mediaFile.filePath,
          mediaLocalRoots: mediaFile.mediaLocalRoots,
          filename: mediaFile.filename,
        });

        if (result.ok && result.mediaDelivered) {
          if (result.error) {
            return [
              "⚠️ PNG 告警卡已发送，但文本补发失败",
              `原因: ${result.error}`,
            ].join("\n");
          }
          return "✅ 测试告警发送成功（文本 + PNG）";
        }

        if (result.ok) {
          return result.error
            ? `⚠️ 测试告警文本已发送，但 PNG 未送达，已回退为纯文本\n原因: ${result.error}`
            : "⚠️ 测试告警文本已发送，但 PNG 未送达，已回退为纯文本";
        }

        const detail = result.error ?? alertService.getLastError();
        return detail
          ? `❌ 测试告警发送失败\n原因: ${detail}`
          : "❌ 测试告警发送失败";
      } finally {
        if (mediaFile) {
          await alertMediaService.removeFile(mediaFile.filePath).catch(() => {});
        }
      }
    },
  };
}

function buildTestAlertImage(now: string) {
  const triggerPrice = 12.18;
  const currentPrice = 12.36;
  return {
    tone: "breakthrough" as const,
    alertLabel: "测试告警",
    name: "平安银行",
    symbol: "000001.SZ",
    timestampLabel: `测试告警 | ${now.slice(0, 16)}`,
    currentPrice,
    triggerPrice,
    changePct: 2.15,
    distancePct: ((currentPrice - triggerPrice) / triggerPrice) * 100,
    costPrice: 11.92,
    profitPct: ((currentPrice - 11.92) / 11.92) * 100,
    note: "用于验证 PNG 告警卡发送、媒体上传与纯文本回退链路。",
    points: [
      { time: "09:30", price: 12.02 },
      { time: "10:00", price: 12.08 },
      { time: "10:30", price: 12.12 },
      { time: "11:30", price: 12.15 },
      { time: "13:00", price: 12.19 },
      { time: "14:00", price: 12.27 },
      { time: "15:00", price: currentPrice },
    ],
    levels: {
      stopLoss: 11.86,
      support: 12.08,
      resistance: 12.30,
      breakthrough: triggerPrice,
      takeProfit: 12.68,
    },
  };
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
