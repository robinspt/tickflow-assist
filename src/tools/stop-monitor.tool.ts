import { MonitorService } from "../services/monitor-service.js";

export function stopMonitorTool(
  monitorService: MonitorService,
  runtime: { pluginManagedServices: boolean },
) {
  return {
    name: "stop_monitor",
    description: "Stop logical monitor state and return stop summary.",
    async run(): Promise<string> {
      const state = await monitorService.getState();
      const shouldSignalWorker = !runtime.pluginManagedServices && state.workerPid && isPidAlive(state.workerPid);
      if (shouldSignalWorker) {
        await monitorService.setExpectedStop(true);
      }
      const summary = await monitorService.stop();
      if (shouldSignalWorker && state.workerPid) {
        try {
          process.kill(state.workerPid, "SIGTERM");
        } catch {
          // Best-effort stop for the dev/VPS worker.
        }
      }
      return summary;
    },
  };
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
