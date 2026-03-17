import { MonitorService } from "../services/monitor-service.js";
import { spawn } from "node:child_process";
import path from "node:path";

export function startMonitorTool(
  monitorService: MonitorService,
  runtime: { pluginManagedServices: boolean },
) {
  return {
    name: "start_monitor",
    description: "Start logical monitor state and return startup summary.",
    async run(): Promise<string> {
      if (runtime.pluginManagedServices) {
        const result = await monitorService.enableManagedLoop();
        if (!result.started) {
          return await monitorService.getStatusReport();
        }

        return [
          "✅ TickFlow 实时监控已启动",
          "运行方式: plugin_service",
          `轮询间隔: 由后台服务管理`,
          "说明: 后台服务按配置间隔轮询，交易时段自动执行监控",
        ].join("\n");
      }

      const currentState = await monitorService.getState();
      if (
        currentState.running
        && currentState.workerPid != null
        && isPidAlive(currentState.workerPid)
      ) {
        return await monitorService.getStatusReport();
      }

      const summary = await monitorService.start();
      const workerPid = spawnMonitorLoop();
      await monitorService.setWorkerPid(workerPid);
      return summary;
    },
  };
}

function spawnMonitorLoop(): number | null {
  const scriptPath = path.resolve("dist/dev/run-monitor-loop.js");
  const child = spawn(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child.pid ?? null;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
