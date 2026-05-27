import { UpdateCheckService } from "../services/update-check-service.js";
import { sleepWithAbort } from "../utils/abortable-sleep.js";

export class UpdateCheckWorker {
  constructor(private readonly updateCheckService: UpdateCheckService) {}

  async runOnce(date = new Date()): Promise<number> {
    const result = await this.updateCheckService.runScheduledCheck(date);
    return result.notified ? 1 : 0;
  }

  async runLoop(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      const delayMs = await this.updateCheckService.getDelayUntilNextCheckMs();
      await sleepWithAbort(delayMs, signal);
      if (signal?.aborted) {
        return;
      }

      await this.runOnce();
      await sleepWithAbort(60_000, signal);
    }
  }
}
