import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PluginConfig } from "../config/schema.js";
import { UpdateService } from "../services/update-service.js";
import { AlertService } from "../services/alert-service.js";
import type { DailyUpdateResultType, DailyUpdateState } from "../types/daily-update.js";
import { chinaToday, formatChinaDateTime } from "../utils/china-time.js";
import { isPidAlive, spawnDailyUpdateLoop } from "../runtime/daily-update-process.js";

const DEFAULT_STATE: DailyUpdateState = {
  running: false,
  startedAt: null,
  lastStoppedAt: null,
  workerPid: null,
  expectedStop: false,
  runtimeHost: null,
  runtimeObservedAt: null,
  runtimeConfigSource: null,
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
    private readonly configSource: "openclaw_plugin" | "local_config",
    private readonly calendarFile: string,
    private readonly intervalMs = 15 * 60 * 1000,
  ) {}

  async run(force = false): Promise<string> {
    return this.executeAndRecord(force, "manual", true);
  }

  async runLoop(
    signal?: AbortSignal,
    runtimeHost?: "project_scheduler" | "plugin_service",
    runtimeConfigSource?: "openclaw_plugin" | "local_config",
  ): Promise<void> {
    while (!signal?.aborted) {
      await this.recordHeartbeat(runtimeHost, runtimeConfigSource);
      const state = await this.readState();
      if (state.running) {
        await this.runScheduledPass();
      }
      await sleep(getNextAlignedDelayMs(this.intervalMs));
    }
  }

  async ensureLoopRunning(
    config: PluginConfig,
    configSource: "openclaw_plugin" | "local_config",
  ): Promise<{ started: boolean; pid: number | null }> {
    const state = await this.readState();
    if (state.workerPid != null && isPidAlive(state.workerPid)) {
      await this.markSchedulerRunning(state.workerPid, state.runtimeConfigSource ?? configSource);
      return { started: false, pid: state.workerPid };
    }

    const workerPid = spawnDailyUpdateLoop(config, configSource);
    if (workerPid == null) {
      throw new Error("无法启动 TickFlow 日更定时进程");
    }

    await this.markSchedulerRunning(workerPid, configSource);
    return { started: true, pid: workerPid };
  }

  async stopLoop(): Promise<{ stopped: boolean; pid: number | null }> {
    const state = await this.readState();
    const workerPid = state.workerPid;
    const alive = workerPid != null && isPidAlive(workerPid);
    if (!alive) {
      await this.markSchedulerStopped();
      return { stopped: false, pid: null };
    }

    await this.setExpectedStop(true);
    await this.markSchedulerStopped();
    try {
      process.kill(workerPid, "SIGTERM");
    } catch {
      // Best-effort stop for the detached daily-update worker.
    }
    return { stopped: true, pid: workerPid };
  }

  async enableManagedLoop(
    configSource: "openclaw_plugin" | "local_config",
  ): Promise<{ started: boolean; pid: number | null }> {
    const state = await this.readState();
    const now = formatChinaDateTime();
    await this.writeState({
      ...state,
      running: true,
      startedAt: state.startedAt ?? now,
      workerPid: null,
      expectedStop: false,
      runtimeHost: "plugin_service",
      runtimeObservedAt: now,
      runtimeConfigSource: configSource,
    });
    return { started: !state.running, pid: null };
  }

  async bindManagedServiceRuntime(
    configSource: "openclaw_plugin" | "local_config",
  ): Promise<void> {
    const state = await this.readState();
    const now = formatChinaDateTime();
    await this.writeState({
      ...state,
      workerPid: null,
      expectedStop: false,
      runtimeHost: "plugin_service",
      runtimeObservedAt: now,
      runtimeConfigSource: configSource,
    });
  }

  async markSchedulerRunning(
    workerPid: number | null,
    runtimeConfigSource: "openclaw_plugin" | "local_config",
  ): Promise<void> {
    const state = await this.readState();
    const now = formatChinaDateTime();
    await this.writeState({
      ...state,
      running: true,
      startedAt: state.startedAt ?? now,
      workerPid,
      expectedStop: false,
      runtimeHost: "project_scheduler",
      runtimeObservedAt: now,
      runtimeConfigSource,
    });
  }

  async markSchedulerStopped(): Promise<void> {
    const state = await this.readState();
    await this.writeState({
      ...state,
      running: false,
      startedAt: null,
      lastStoppedAt: formatChinaDateTime(),
      workerPid: null,
      expectedStop: false,
    });
  }

  async setExpectedStop(expectedStop: boolean): Promise<void> {
    const state = await this.readState();
    await this.writeState({
      ...state,
      expectedStop,
    });
  }

  async getState(): Promise<DailyUpdateState> {
    return this.readState();
  }

  async getStatusReport(): Promise<string> {
    const state = await this.readState();
    const today = chinaToday();
    const lines = [
      "🕒 定时日更状态",
      `状态: ${formatProcessState(state)}`,
      `运行方式: ${formatRuntimeHost(state)}`,
      `配置来源: ${this.configSource}`,
      `调度: ${Math.floor(this.intervalMs / 60_000)} 分钟对齐轮询 | 交易日 15:25 后执行`,
      "",
      "执行情况:",
      `• 今日已更新: ${state.lastSuccessDate === today ? "是" : "否"}`,
      `• 最近心跳: ${state.lastHeartbeatAt ?? "暂无"}`,
      `• 最近尝试: ${state.lastAttemptAt ?? "暂无"}`,
      `• 最近成功: ${state.lastSuccessAt ?? "暂无"}`,
      `• 最近结果: ${formatResultType(state.lastResultType)}`,
    ];

    if (state.consecutiveFailures > 0) {
      lines.push(`• 连续失败: ${state.consecutiveFailures}`);
    }

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

    await this.executeAndRecord(false, "scheduled", false);
  }

  private async executeAndRecord(
    force: boolean,
    trigger: "manual" | "scheduled",
    throwOnError: boolean,
  ): Promise<string> {
    const today = chinaToday();
    const state = await this.readState();
    const attemptedAt = formatChinaDateTime();

    try {
      const result = await this.updateService.updateAll(force);
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
      if (trigger === "scheduled") {
        await this.maybeSendNotification(resultType, result);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureText = `异常: ${message}`;
      await this.writeState({
        ...state,
        lastAttemptAt: attemptedAt,
        lastAttemptDate: today,
        lastResultType: "failed",
        lastResultSummary: failureText,
        consecutiveFailures: state.consecutiveFailures + 1,
      });
      if (trigger === "scheduled") {
        await this.maybeSendNotification("failed", failureText);
      }
      if (throwOnError) {
        throw error;
      }
      return failureText;
    }
  }

  private getStateFilePath(): string {
    return path.join(this.baseDir, "daily-update-state.json");
  }

  private async recordHeartbeat(
    runtimeHost?: "project_scheduler" | "plugin_service",
    runtimeConfigSource?: "openclaw_plugin" | "local_config",
  ): Promise<void> {
    const state = await this.readState();
    const observedAt = formatChinaDateTime();
    await this.writeState({
      ...state,
      lastHeartbeatAt: observedAt,
      runtimeHost: runtimeHost ?? state.runtimeHost,
      runtimeObservedAt: observedAt,
      runtimeConfigSource: runtimeConfigSource ?? state.runtimeConfigSource,
    });
  }

  private async readState(): Promise<DailyUpdateState> {
    const file = this.getStateFilePath();
    try {
      const raw = await readFile(file, "utf-8");
      return { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<DailyUpdateState>) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ...DEFAULT_STATE };
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
    if (!this.notifyEnabled || resultType === "skipped") {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNextAlignedDelayMs(intervalMs: number): number {
  const intervalMinutes = Math.max(1, Math.floor(intervalMs / 60_000));
  const anchorMinute = 10;
  const now = new Date();
  const chinaNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  const currentMinute = chinaNow.getMinutes();
  const currentSecond = chinaNow.getSeconds();
  const currentMillisecond = chinaNow.getMilliseconds();
  const normalized = ((currentMinute - anchorMinute) % intervalMinutes + intervalMinutes) % intervalMinutes;
  let minutesToAdd = intervalMinutes - normalized;
  if (minutesToAdd === intervalMinutes && currentSecond === 0 && currentMillisecond === 0) {
    minutesToAdd = intervalMinutes;
  }
  if (normalized === 0 && (currentSecond > 0 || currentMillisecond > 0)) {
    minutesToAdd = intervalMinutes;
  }

  const next = new Date(chinaNow);
  next.setSeconds(0, 0);
  next.setMinutes(currentMinute + minutesToAdd);
  return Math.max(1_000, next.getTime() - chinaNow.getTime());
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

function formatProcessState(state: DailyUpdateState): string {
  if (!state.running) {
    return "⭕ 未启动";
  }
  if (state.workerPid == null) {
    return state.startedAt ? `✅ 运行中 (启动于 ${state.startedAt})` : "✅ 运行中";
  }
  if (!isPidAlive(state.workerPid)) {
    return `⚠️ 状态残留 (PID=${state.workerPid} 已不存在)`;
  }
  return state.startedAt
    ? `✅ 运行中 (PID=${state.workerPid}, 启动于 ${state.startedAt})`
    : `✅ 运行中 (PID=${state.workerPid})`;
}

function formatRuntimeHost(state: DailyUpdateState): string {
  return state.runtimeHost === "project_scheduler"
    ? "project_scheduler"
    : state.runtimeHost === "plugin_service"
      ? "plugin_service"
      : "unknown";
}
