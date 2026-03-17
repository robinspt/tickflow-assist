import { MonitorService } from "../services/monitor-service.js";

export function stopMonitorTool(
  monitorService: MonitorService,
  runtime: { pluginManagedServices: boolean },
) {
  return {
    name: "stop_monitor",
    description: "Stop logical monitor state and return stop summary.",
    async run(): Promise<string> {
      if (runtime.pluginManagedServices) {
        const wasRunning = (await monitorService.getState()).running;
        await monitorService.markStopped();
        if (!wasRunning) {
          return "✅ TickFlow 实时监控已停止";
        }
        return [
          "🛑 TickFlow 实时监控已停止",
          "运行方式: plugin_service（后台服务循环仍在，但不再执行监控）",
        ].join("\n");
      }

      const state = await monitorService.getState();
      const shouldSignalWorker = state.workerPid != null && isPidAlive(state.workerPid);
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
