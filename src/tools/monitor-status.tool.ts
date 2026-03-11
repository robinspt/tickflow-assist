import { MonitorService } from "../services/monitor-service.js";

export function monitorStatusTool(monitorService: MonitorService) {
  return {
    name: "monitor_status",
    description: "Show current monitor state, trading phase, watchlist, quote snapshot and config summary.",
    async run(): Promise<string> {
      return monitorService.getStatusReport();
    },
  };
}
