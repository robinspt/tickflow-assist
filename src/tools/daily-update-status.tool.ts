import { DailyUpdateWorker } from "../background/daily-update.worker.js";

export function dailyUpdateStatusTool(dailyUpdateWorker: DailyUpdateWorker, _configSource: string) {
  return {
    name: "daily_update_status",
    description: "Show the daily-update scheduler status, config source, heartbeat, and recent execution result.",
    async run(): Promise<string> {
      return dailyUpdateWorker.getStatusReport();
    },
  };
}
