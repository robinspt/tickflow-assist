import type { PluginConfig } from "../config/schema.js";
import { DailyUpdateWorker } from "../background/daily-update.worker.js";
import { isPidAlive } from "../background/daily-update.worker.js";

export function startDailyUpdateTool(
  dailyUpdateWorker: DailyUpdateWorker,
  _config: PluginConfig,
  configSource: "openclaw_plugin" | "local_config",
  runtime: { pluginManagedServices: boolean },
) {
  return {
    name: "start_daily_update",
    description: "Start the TickFlow daily-update scheduler.",
    optional: true,
    async run(): Promise<string> {
      if (runtime.pluginManagedServices) {
        const result = await dailyUpdateWorker.enableManagedLoop(configSource);
        if (!result.started) {
          return await dailyUpdateWorker.getStatusReport();
        }

        const lines = [
          "✅ TickFlow 定时日更已启动",
          `PID: ${result.pid ?? "托管服务"}`,
          "运行方式: plugin_service",
          `配置来源: ${configSource}`,
          "说明: 后台按 15 分钟对齐轮询，交易日 15:25 后最多执行一次日更，20:00 后最多执行一次复盘",
        ];
        return lines.join("\n");
      }

      const state = await dailyUpdateWorker.getState();
      if (state.running && state.workerPid != null && isPidAlive(state.workerPid)) {
        return await dailyUpdateWorker.getStatusReport();
      }

      await dailyUpdateWorker.markSchedulerRunning(null, configSource);
      return [
        "✅ TickFlow 定时日更已启动",
        "PID: 手动循环",
        "运行方式: manual_loop",
        `配置来源: ${configSource}`,
        "下一步: 在另一个终端执行 `npm run daily-update-loop` 启动本地日更循环。",
      ].join("\n");
    },
  };
}
