import { MonitorService } from "../services/monitor-service.js";

export function monitorStatusTool(monitorService: MonitorService) {
  return {
    name: "monitor_status",
    description: "Show current monitor state, watchlist snapshot, latest quotes, and alert summary.",
    async run(): Promise<string> {
      return monitorService.getStatusReport();
    },
  };
}
