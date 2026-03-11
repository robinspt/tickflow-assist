import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { UpdateService } from "../services/update-service.js";
import { chinaToday } from "../utils/china-time.js";

export class DailyUpdateWorker {
  constructor(
    private readonly updateService: UpdateService,
    private readonly baseDir: string,
    private readonly intervalMs = 15 * 60 * 1000,
  ) {}

  async run(force = false): Promise<string> {
    return this.updateService.updateAll(force);
  }

  async runLoop(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      await this.runScheduledPass();
      await new Promise((resolve) => setTimeout(resolve, this.intervalMs));
    }
  }

  private async runScheduledPass(): Promise<void> {
    const today = chinaToday();
    const state = await this.readState();
    if (state.lastSuccessDate === today) {
      return;
    }

    const result = await this.updateService.updateAll(false);
    if (result.startsWith("📊") || result.startsWith("📋")) {
      await this.writeState({ lastSuccessDate: today });
    }
  }

  private getStateFilePath(): string {
    return path.join(this.baseDir, "daily-update-state.json");
  }

  private async readState(): Promise<{ lastSuccessDate: string | null }> {
    const file = this.getStateFilePath();
    try {
      const raw = await readFile(file, "utf-8");
      const parsed = JSON.parse(raw) as { lastSuccessDate?: string | null };
      return { lastSuccessDate: parsed.lastSuccessDate ?? null };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { lastSuccessDate: null };
      }
      throw error;
    }
  }

  private async writeState(state: { lastSuccessDate: string | null }): Promise<void> {
    const file = this.getStateFilePath();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(state, null, 2), "utf-8");
  }
}
