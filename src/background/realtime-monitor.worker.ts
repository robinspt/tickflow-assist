import { MonitorService } from "../services/monitor-service.js";
import { sleepWithAbort } from "../utils/abortable-sleep.js";

export class RealtimeMonitorWorker {
  constructor(
    private readonly monitorService: MonitorService,
    private readonly intervalMs: number,
  ) {}

  async runOnce(
    runtimeHost?: "plugin_service" | "fallback_process",
  ): Promise<number> {
    const state = await this.monitorService.getState();
    if (!state.running) {
      return 0;
    }
    return this.monitorService.runMonitorOnce(runtimeHost);
  }

  async runLoop(
    signal?: AbortSignal,
    runtimeHost?: "plugin_service" | "fallback_process",
  ): Promise<void> {
    while (!signal?.aborted) {
      try {
        await this.runOnce(runtimeHost);
      } catch (error) {
        await this.monitorService.recordLoopError(error);
      }
      await sleepWithAbort(this.intervalMs, signal);
    }
  }
}
