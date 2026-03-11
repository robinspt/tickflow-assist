import { MonitorService } from "../services/monitor-service.js";

export class RealtimeMonitorWorker {
  constructor(
    private readonly monitorService: MonitorService,
    private readonly intervalMs: number,
  ) {}

  async runOnce(): Promise<number> {
    const state = await this.monitorService.getState();
    if (!state.running) {
      return 0;
    }
    return this.monitorService.runMonitorOnce();
  }

  async runLoop(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      await this.monitorService.runMonitorOnce();
      await new Promise((resolve) => setTimeout(resolve, this.intervalMs));
    }
  }
}
