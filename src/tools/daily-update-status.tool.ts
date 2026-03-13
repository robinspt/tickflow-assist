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
        throw new Error(
          "daily_update_status 默认只用于 OpenClaw 插件后台状态；当前调用链路来自 local_config。本地调试如需查看该状态，必须显式传入 allowLocalConfig=true。",
        );
      }
      return dailyUpdateWorker.getStatusReport();
    },
  };
}
