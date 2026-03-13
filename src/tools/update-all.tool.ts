import { UpdateService } from "../services/update-service.js";

export function updateAllTool(updateService: UpdateService) {
  return {
    name: "update_all",
    description: "Batch update daily K-lines, daily indicators, and today's intraday K-lines for all watchlist symbols.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      let force = false;
      if (typeof rawInput === "object" && rawInput !== null) {
        force = Boolean((rawInput as Record<string, unknown>).force);
      }
      if (typeof rawInput === "string") {
        force = rawInput.includes("--force");
      }
      return updateService.updateAll(force);
    },
  };
}
