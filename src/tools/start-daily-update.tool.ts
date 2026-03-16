import type { PluginConfig } from "../config/schema.js";
import { DailyUpdateWorker } from "../background/daily-update.worker.js";

export function startDailyUpdateTool(
  dailyUpdateWorker: DailyUpdateWorker,
  config: PluginConfig,
  configSource: "openclaw_plugin" | "local_config",
  runtime: { pluginManagedServices: boolean },
) {
  return {
    name: "start_daily_update",
    description: "Start the TickFlow daily-update scheduler.",
    async run(): Promise<string> {
      const result = runtime.pluginManagedServices
        ? await dailyUpdateWorker.enableManagedLoop(configSource)
        : await dailyUpdateWorker.ensureLoopRunning(config, configSource);
      if (!result.started) {
        return await dailyUpdateWorker.getStatusReport();
      }

      const lines = [
        "✅ TickFlow 定时日更已启动",
        `PID: ${result.pid ?? "托管服务"}`,
        `运行方式: ${runtime.pluginManagedServices ? "plugin_service" : "project_scheduler"}`,
        `配置来源: ${configSource}`,
        "说明: 后台将每 15 分钟轮询一次，交易日收盘后最多执行一次日更",
      ];
      return lines.join("\n");
    },
  };
}
