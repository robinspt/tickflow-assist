import { AlertService } from "../services/alert-service.js";
import { formatChinaDateTime } from "../utils/china-time.js";

export function testAlertTool(alertService: AlertService) {
  return {
    name: "test_alert",
    description: "Send a test alert through the configured OpenClaw alert delivery path.",
    async run(): Promise<string> {
      const ok = await alertService.send(
        alertService.formatSystemNotification("🧪 TickFlow 测试告警", [
          `时间: ${formatChinaDateTime()}`,
          "说明: 这是一条手动触发的测试消息，用于验证 channel 投递链路正常。",
        ]),
      );
      if (ok) {
        return "✅ 测试告警发送成功";
      }
      const detail = alertService.getLastError();
      return detail
        ? `❌ 测试告警发送失败\n原因: ${detail}`
        : "❌ 测试告警发送失败";
    },
  };
}
