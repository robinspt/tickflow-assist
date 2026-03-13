import { createAppContext } from "../bootstrap.js";
import { loadProcessConfig } from "../runtime/process-config.js";

async function main(): Promise<void> {
  const { config, configSource } = await loadProcessConfig();
  const app = createAppContext(config, { configSource });
  const worker = app.services.dailyUpdateWorker;
  const alertService = app.services.alertService;

  await worker.markSchedulerRunning(process.pid, configSource);

  process.stdout.write("TickFlow daily update loop started\n");

  const controller = new AbortController();
  const shutdown = async (signal: string) => {
    controller.abort();
    const state = await worker.getState();
    const isCurrentWorker = state.workerPid === process.pid;
    await worker.markSchedulerStopped();
    if (isCurrentWorker && state.running && !state.expectedStop) {
      await alertService.send(
        alertService.formatSystemNotification("⚠️ TickFlow 日更退出通知", [
          `时间: ${new Date().toISOString()}`,
          `原因: 收到信号 ${signal}`,
        ]),
      );
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await worker.runLoop(controller.signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const state = await worker.getState();
    const isCurrentWorker = state.workerPid === process.pid;
    await worker.markSchedulerStopped();
    if (isCurrentWorker) {
      await alertService.send(
        alertService.formatSystemNotification("⚠️ TickFlow 日更退出通知", [
          `时间: ${new Date().toISOString()}`,
          "原因: 日更循环异常退出",
          `详情: ${message}`,
        ]),
      );
    }
    throw error;
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
