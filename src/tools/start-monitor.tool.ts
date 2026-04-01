import { MonitorService } from "../services/monitor-service.js";

export function startMonitorTool(
  monitorService: MonitorService,
  runtime: { pluginManagedServices: boolean },
) {
  return {
    name: "start_monitor",
    description: "Start logical monitor state and return startup summary.",
    optional: true,
    async run(): Promise<string> {
      if (runtime.pluginManagedServices) {
        let result: { started: boolean };
        try {
          result = await monitorService.enableManagedLoop();
        } catch (error) {
          return formatManagedStartError(error);
        }

        if (!result.started) {
          return await buildManagedAlreadyRunningSummary(monitorService);
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
        return [
          "✅ TickFlow 实时监控已在运行",
          "运行方式: manual_loop",
          `PID: ${currentState.workerPid}`,
          "说明: 本地监控循环已存在，无需重复启动。",
        ].join("\n");
      }

      const summary = await monitorService.start();
      return [
        summary,
        "运行方式: manual_loop",
        "下一步: 在另一个终端执行 `npm run monitor-loop` 启动本地监控循环。",
      ].join("\n");
    },
  };
}

async function buildManagedAlreadyRunningSummary(
  monitorService: MonitorService,
): Promise<string> {
  const state = await monitorService.getState();
  return [
    "✅ TickFlow 实时监控已在运行",
    "运行方式: plugin_service",
    `最近心跳: ${state.lastHeartbeatAt ?? "暂无"}`,
    "说明: 后台服务按配置间隔轮询，交易时段自动执行监控。",
  ].join("\n");
}

function formatManagedStartError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("关注列表为空")) {
    return [
      "⚠️ 无法启动实时监控",
      "原因: 关注列表为空，请先添加至少一只自选股。",
      "示例: /ta_addstock 000001 10.50",
    ].join("\n");
  }
  return [
    "⚠️ 启动实时监控失败",
    `原因: ${message}`,
  ].join("\n");
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
