import { Jin10FlashMonitorService } from "../services/jin10-flash-monitor-service.js";

export function flashMonitorStatusTool(flashMonitorService: Jin10FlashMonitorService) {
  return {
    name: "flash_monitor_status",
    description: "Show Jin10 flash monitor state, recent poll summary, and storage counters.",
    async run(): Promise<string> {
      return flashMonitorService.getStatusReport();
    },
  };
}
