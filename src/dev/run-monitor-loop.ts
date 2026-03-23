import { readFile } from "node:fs/promises";
import path from "node:path";

import { createAppContext } from "../bootstrap.js";
import { normalizePluginConfig, resolvePluginConfigPaths } from "../config/normalize.js";

interface LocalConfigShape {
  plugin?: Record<string, unknown>;
}

async function main(): Promise<void> {
  const config = await loadLocalConfig();
  const app = createAppContext(config, { configSource: "local_config" });
  const worker = app.services.realtimeMonitorWorker;
  const alertService = app.services.alertService;
  const monitorService = app.services.monitorService;

  await monitorService.recordHeartbeat("fallback_process");
  await monitorService.setWorkerPid(process.pid);

  process.stdout.write(`TickFlow monitor loop started, interval=${config.requestInterval}s\n`);

  const controller = new AbortController();
  const shutdown = async (signal: string) => {
    controller.abort();
    const state = await monitorService.getState();
    const isCurrentWorker = state.workerPid === process.pid;
    await monitorService.setWorkerPid(null);
    if (isCurrentWorker && state.running && !state.expectedStop) {
      await alertService.send(
        alertService.formatSystemNotification("⚠️ TickFlow 监控退出通知", [
          `时间: ${new Date().toISOString()}`,
          `原因: 收到信号 ${signal}`,
        ]),
      );
    }
    await monitorService.setExpectedStop(false);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await worker.runLoop(controller.signal, "fallback_process");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const state = await monitorService.getState();
    const isCurrentWorker = state.workerPid === process.pid;
    await monitorService.setWorkerPid(null);
    await monitorService.setExpectedStop(false);
    if (isCurrentWorker) {
      await alertService.send(
        alertService.formatSystemNotification("⚠️ TickFlow 监控退出通知", [
          `时间: ${new Date().toISOString()}`,
          "原因: 监控循环异常退出",
          `详情: ${message}`,
        ]),
      );
    }
    throw error;
  }
}

async function loadLocalConfig() {
  const configPath = path.resolve("local.config.json");
  const raw = await readFile(configPath, "utf-8");
  const parsed = JSON.parse(raw) as LocalConfigShape;
  return resolvePluginConfigPaths(normalizePluginConfig(parsed.plugin ?? {}), process.cwd());
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
