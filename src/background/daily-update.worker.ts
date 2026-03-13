import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { UpdateService } from "../services/update-service.js";
import { AlertService } from "../services/alert-service.js";
import { chinaToday, formatChinaDateTime } from "../utils/china-time.js";

type DailyUpdateResultType = "success" | "skipped" | "failed";

interface DailyUpdateState {
  lastHeartbeatAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptDate: string | null;
  lastSuccessAt: string | null;
  lastSuccessDate: string | null;
  lastResultType: DailyUpdateResultType | null;
  lastResultSummary: string | null;
  consecutiveFailures: number;
}

const EMPTY_STATE: DailyUpdateState = {
  lastHeartbeatAt: null,
  lastAttemptAt: null,
  lastAttemptDate: null,
  lastSuccessAt: null,
  lastSuccessDate: null,
  lastResultType: null,
  lastResultSummary: null,
  consecutiveFailures: 0,
};

export class DailyUpdateWorker {
  constructor(
    private readonly updateService: UpdateService,
    private readonly baseDir: string,
    private readonly alertService: AlertService,
    private readonly notifyEnabled: boolean,
    private readonly configSource: string,
    private readonly calendarFile: string,
    private readonly intervalMs = 15 * 60 * 1000,
  ) {}

  async run(force = false): Promise<string> {
    return this.updateService.updateAll(force);
  }

  async runLoop(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      await this.recordHeartbeat();
      try {
        await this.runScheduledPass();
      } catch (error) {
        await this.recordFailure(error);
      }
      await new Promise((resolve) => setTimeout(resolve, this.intervalMs));
    }
  }

  async getStatusReport(): Promise<string> {
    const state = await this.readState();
    const today = chinaToday();
    const lines = [
      "🕒 定时日更状态",
      `配置来源: ${this.configSource}`,
      `交易日历: ${this.calendarFile}`,
      `轮询间隔: ${Math.floor(this.intervalMs / 60_000)} 分钟`,
      `最近心跳: ${state.lastHeartbeatAt ?? "暂无"}`,
      `今日已更新: ${state.lastSuccessDate === today ? "是" : "否"}`,
      `最近尝试: ${state.lastAttemptAt ?? "暂无"}`,
      `最近成功: ${state.lastSuccessAt ?? "暂无"}`,
      `最近结果: ${formatResultType(state.lastResultType)}`,
      `连续失败: ${state.consecutiveFailures}`,
      `状态文件: ${this.getStateFilePath()}`,
    ];

    if (state.lastResultSummary) {
      lines.push("", "最近摘要:", state.lastResultSummary);
    }

    return lines.join("\n");
  }

  private async runScheduledPass(): Promise<void> {
    const today = chinaToday();
    const state = await this.readState();
    if (state.lastSuccessDate === today) {
      return;
    }

    const attemptedAt = formatChinaDateTime();
    const result = await this.updateService.updateAll(false);
    const resultType = classifyResult(result);
    const nextState: DailyUpdateState = {
      ...state,
      lastAttemptAt: attemptedAt,
      lastAttemptDate: today,
      lastResultType: resultType,
      lastResultSummary: summarizeResult(result),
      consecutiveFailures: resultType === "failed" ? state.consecutiveFailures + 1 : 0,
    };

    if (resultType === "success") {
      nextState.lastSuccessAt = attemptedAt;
      nextState.lastSuccessDate = today;
    }

    await this.writeState(nextState);
    await this.maybeSendNotification(resultType, result);
  }

  private getStateFilePath(): string {
    return path.join(this.baseDir, "daily-update-state.json");
  }

  private async recordHeartbeat(): Promise<void> {
    const state = await this.readState();
    await this.writeState({
      ...state,
      lastHeartbeatAt: formatChinaDateTime(),
    });
  }

  private async recordFailure(error: unknown): Promise<void> {
    const today = chinaToday();
    const state = await this.readState();
    const message = error instanceof Error ? error.message : String(error);
    await this.writeState({
      ...state,
      lastAttemptAt: formatChinaDateTime(),
      lastAttemptDate: today,
      lastResultType: "failed",
      lastResultSummary: `异常: ${message}`,
      consecutiveFailures: state.consecutiveFailures + 1,
    });
  }

  private async readState(): Promise<DailyUpdateState> {
    const file = this.getStateFilePath();
    try {
      const raw = await readFile(file, "utf-8");
      const parsed = JSON.parse(raw) as Partial<DailyUpdateState>;
      return {
        lastHeartbeatAt: parsed.lastHeartbeatAt ?? null,
        lastAttemptAt: parsed.lastAttemptAt ?? null,
        lastAttemptDate: parsed.lastAttemptDate ?? null,
        lastSuccessAt: parsed.lastSuccessAt ?? null,
        lastSuccessDate: parsed.lastSuccessDate ?? null,
        lastResultType: parsed.lastResultType ?? null,
        lastResultSummary: parsed.lastResultSummary ?? null,
        consecutiveFailures: parsed.consecutiveFailures ?? 0,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ...EMPTY_STATE };
      }
      throw error;
    }
  }

  private async writeState(state: DailyUpdateState): Promise<void> {
    const file = this.getStateFilePath();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(state, null, 2), "utf-8");
  }

  private async maybeSendNotification(resultType: DailyUpdateResultType, result: string): Promise<void> {
    if (!this.notifyEnabled) {
      return;
    }
    if (resultType === "skipped") {
      return;
    }

    const title = resultType === "success" ? "📊 定时日更完成" : "❌ 定时日更失败";
    const lines = result
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8);
    const message = this.alertService.formatSystemNotification(title, lines);
    await this.alertService.send(message);
  }
}

function classifyResult(result: string): DailyUpdateResultType {
  if (result.startsWith("📊") || result.startsWith("📋")) {
    return "success";
  }
  if (result.startsWith("🚫")) {
    return "skipped";
  }
  return "failed";
}

function summarizeResult(result: string): string {
  const lines = result
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(0, 3).join(" | ");
}

function formatResultType(type: DailyUpdateResultType | null): string {
  switch (type) {
    case "success":
      return "成功";
    case "skipped":
      return "跳过";
    case "failed":
      return "失败";
    default:
      return "暂无";
  }
}
