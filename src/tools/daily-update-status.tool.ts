import { DailyUpdateWorker } from "../background/daily-update.worker.js";

export function dailyUpdateStatusTool(dailyUpdateWorker: DailyUpdateWorker) {
  return {
    name: "daily_update_status",
    description: "Show the scheduled daily update worker status and recent execution result.",
    async run(): Promise<string> {
      return dailyUpdateWorker.getStatusReport();
    },
  };
}
