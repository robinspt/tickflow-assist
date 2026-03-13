import { DailyUpdateWorker } from "../background/daily-update.worker.js";

export function stopDailyUpdateTool(dailyUpdateWorker: DailyUpdateWorker) {
  return {
    name: "stop_daily_update",
    description: "Stop the detached TickFlow daily-update scheduler process.",
    async run(): Promise<string> {
      const result = await dailyUpdateWorker.stopLoop();
      if (!result.stopped) {
        return "✅ TickFlow 定时日更已停止";
      }

      return [
        "🛑 TickFlow 定时日更已停止",
        `PID: ${result.pid ?? "未知"}`,
      ].join("\n");
    },
  };
}
