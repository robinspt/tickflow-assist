import { DailyUpdateWorker } from "../background/daily-update.worker.js";

export function stopDailyUpdateTool(
  dailyUpdateWorker: DailyUpdateWorker,
  runtime: { pluginManagedServices: boolean },
) {
  return {
    name: "stop_daily_update",
    description: "Stop the TickFlow daily-update scheduler.",
    async run(): Promise<string> {
      const result = runtime.pluginManagedServices
        ? { stopped: (await dailyUpdateWorker.getState()).running, pid: null }
        : await dailyUpdateWorker.stopLoop();
      await dailyUpdateWorker.markSchedulerStopped();
      if (!result.stopped) {
        return "✅ TickFlow 定时日更已停止";
      }

      return [
        "🛑 TickFlow 定时日更已停止",
        `PID: ${result.pid ?? "托管服务"}`,
      ].join("\n");
    },
  };
}
