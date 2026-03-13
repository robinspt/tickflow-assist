import { DailyUpdateWorker } from "../background/daily-update.worker.js";

function allowLocalConfig(rawInput: unknown): boolean {
  if (typeof rawInput === "object" && rawInput !== null) {
    return Boolean((rawInput as Record<string, unknown>).allowLocalConfig);
  }
  if (typeof rawInput === "string") {
    return rawInput.includes("--allow-local-config");
  }
  return false;
}

export function dailyUpdateStatusTool(dailyUpdateWorker: DailyUpdateWorker, configSource: string) {
  return {
    name: "daily_update_status",
    description: "Show the scheduled daily update worker status, config source, heartbeat, and recent execution result.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      if (configSource === "local_config" && !allowLocalConfig(rawInput)) {
        return [
          "⚠️ 当前调用链路来自 local_config，不代表 OpenClaw 插件后台状态。",
          "请在 OpenClaw 对话中直接调用插件工具查看插件后台状态。",
          "如果你只是想在命令行排查本地调试状态，请执行：",
          `npm run tool -- daily_update_status '{"allowLocalConfig":true}'`,
        ].join("\n");
      }
      return dailyUpdateWorker.getStatusReport();
    },
  };
}
