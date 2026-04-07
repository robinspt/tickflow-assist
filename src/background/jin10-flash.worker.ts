import { sleepWithAbort } from "../utils/abortable-sleep.js";
import { Jin10FlashMonitorService } from "../services/jin10-flash-monitor-service.js";

export class Jin10FlashWorker {
  constructor(
    private readonly monitorService: Jin10FlashMonitorService,
    private readonly intervalMs: number,
  ) {}

  async runOnce(): Promise<number> {
    return this.monitorService.runMonitorOnce();
  }

  async runLoop(
    signal?: AbortSignal,
    runtimeHost?: "plugin_service" | "fallback_process",
  ): Promise<void> {
    while (!signal?.aborted) {
      await this.monitorService.recordHeartbeat(runtimeHost);
      try {
        await this.runOnce();
      } catch (error) {
        await this.monitorService.recordLoopError(error);
      }
      await sleepWithAbort(this.intervalMs, signal);
    }
  }
}
