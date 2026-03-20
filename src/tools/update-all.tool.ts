import { DailyUpdateWorker } from "../background/daily-update.worker.js";

export function updateAllTool(dailyUpdateWorker: DailyUpdateWorker) {
  return {
    name: "update_all",
    description:
      "Batch update daily/intraday market data for all watchlist symbols, then run post-close analysis and key-level backtest.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      let force = false;
      if (typeof rawInput === "object" && rawInput !== null) {
        force = Boolean((rawInput as Record<string, unknown>).force);
      }
      if (typeof rawInput === "string") {
        force = rawInput.includes("--force");
      }
      return dailyUpdateWorker.run(force);
    },
  };
}
