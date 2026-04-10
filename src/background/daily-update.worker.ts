import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { UpdateService } from "../services/update-service.js";
import { AlertService } from "../services/alert-service.js";
import {
  PostCloseReviewService,
  type PostCloseReviewRunResult,
} from "../services/post-close-review-service.js";
import {
  PreMarketBriefService,
  type PreMarketBriefRunResult,
} from "../services/pre-market-brief-service.js";
import { TradingCalendarService } from "../services/trading-calendar-service.js";
import type { DailyUpdateResultType, DailyUpdateState } from "../types/daily-update.js";
import { chinaToday, formatChinaDateTime } from "../utils/china-time.js";
import { sleepWithAbort } from "../utils/abortable-sleep.js";

const PRE_MARKET_BRIEF_READY_TIME = "09:20";
const DAILY_UPDATE_READY_TIME = "15:25";
const POST_CLOSE_REVIEW_READY_TIME = "20:00";

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
  lastReviewAttemptAt: null,
  lastReviewAttemptDate: null,
  lastReviewSuccessAt: null,
  lastReviewSuccessDate: null,
  lastReviewResultType: null,
  lastReviewResultSummary: null,
  reviewConsecutiveFailures: 0,
  lastPreMarketAttemptAt: null,
  lastPreMarketAttemptDate: null,
  lastPreMarketSuccessAt: null,
  lastPreMarketSuccessDate: null,
  lastPreMarketResultType: null,
  lastPreMarketResultSummary: null,
  preMarketConsecutiveFailures: 0,
};

interface DailyUpdateExecutionOutput {
  resultType: DailyUpdateResultType;
  message: string;
}

interface PostCloseReviewExecutionOutput {
  resultType: DailyUpdateResultType;
  overviewMessage: string | null;
  detailMessages: string[];
  combinedText: string;
}

interface PreMarketBriefExecutionOutput {
  resultType: DailyUpdateResultType;
  message: string;
}

interface ScheduleReadiness {
  ok: boolean;
  reason: string;
  code: "ready" | "waiting_time" | "waiting_daily_update" | "non_trading_day";
}

export class DailyUpdateWorker {
  constructor(
    private readonly updateService: UpdateService,
    private readonly preMarketBriefService: PreMarketBriefService,
    private readonly postCloseReviewService: PostCloseReviewService | null,
    private readonly tradingCalendarService: TradingCalendarService,
    private readonly baseDir: string,
    private readonly alertService: AlertService,
    private readonly notifyEnabled: boolean,
    private readonly configSource: "openclaw_plugin" | "local_config",
    private readonly intervalMs = 15 * 60 * 1000,
  ) {}

  async run(force = false): Promise<string> {
    const updateOutput = await this.executeDailyUpdateAndRecord(force, "manual", true);
    if (updateOutput.resultType !== "success") {
      return updateOutput.message;
    }

    const reviewOutput = await this.executeReviewAndRecord("manual");
    return joinMessages(updateOutput.message, reviewOutput?.combinedText);
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
        await this.runScheduledPasses();
      }
      await sleepWithAbort(getNextAlignedDelayMs(this.intervalMs), signal);
    }
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
      "🕒 盘前资讯 / 定时日更 / 收盘复盘状态",
      `状态: ${formatProcessState(state)}`,
      `运行方式: ${formatRuntimeHost(state)}`,
      `配置来源: ${this.configSource}`,
      `调度: ${Math.floor(this.intervalMs / 60_000)} 分钟对齐轮询 | 盘前资讯 ${PRE_MARKET_BRIEF_READY_TIME} 后执行 | 日更 ${DAILY_UPDATE_READY_TIME} 后执行 | 复盘 ${POST_CLOSE_REVIEW_READY_TIME} 后执行`,
      `最近心跳: ${state.lastHeartbeatAt ?? "暂无"}`,
      "",
      "盘前资讯:",
      `• 今日已推送: ${state.lastPreMarketSuccessDate === today ? "是" : "否"}`,
      `• 最近尝试: ${state.lastPreMarketAttemptAt ?? "暂无"}`,
      `• 最近成功: ${state.lastPreMarketSuccessAt ?? "暂无"}`,
      `• 最近结果: ${formatResultType(state.lastPreMarketResultType)}`,
      "",
      "日更执行:",
      `• 今日已更新: ${state.lastSuccessDate === today ? "是" : "否"}`,
      `• 最近尝试: ${state.lastAttemptAt ?? "暂无"}`,
      `• 最近成功: ${state.lastSuccessAt ?? "暂无"}`,
      `• 最近结果: ${formatResultType(state.lastResultType)}`,
    ];

    if (state.preMarketConsecutiveFailures > 0) {
      lines.push(`• 连续失败: ${state.preMarketConsecutiveFailures}`);
    }
    if (state.lastPreMarketResultSummary) {
      lines.push(`• 最近摘要: ${state.lastPreMarketResultSummary}`);
    }

    if (state.consecutiveFailures > 0) {
      lines.push(`• 连续失败: ${state.consecutiveFailures}`);
    }
    if (state.lastResultSummary) {
      lines.push(`• 最近摘要: ${state.lastResultSummary}`);
    }

    lines.push(
      "",
      "复盘执行:",
      `• 今日已复盘: ${state.lastReviewSuccessDate === today ? "是" : "否"}`,
      `• 最近尝试: ${state.lastReviewAttemptAt ?? "暂无"}`,
      `• 最近成功: ${state.lastReviewSuccessAt ?? "暂无"}`,
      `• 最近结果: ${formatResultType(state.lastReviewResultType)}`,
    );

    if (state.reviewConsecutiveFailures > 0) {
      lines.push(`• 连续失败: ${state.reviewConsecutiveFailures}`);
    }
    if (state.lastReviewResultSummary) {
      lines.push(`• 最近摘要: ${state.lastReviewResultSummary}`);
    }

    return lines.join("\n");
  }

  private async runScheduledPasses(): Promise<void> {
    await this.runScheduledPreMarketBriefPass();
    await this.runScheduledUpdatePass();
    await this.runScheduledReviewPass();
  }

  private async runScheduledPreMarketBriefPass(): Promise<void> {
    const today = chinaToday();
    const state = await this.readState();
    if (hasCompletedScheduledWindow(
      state.lastPreMarketSuccessDate,
      state.lastPreMarketSuccessAt,
      today,
      PRE_MARKET_BRIEF_READY_TIME,
    )) {
      return;
    }
    if (hasAttemptedScheduledWindow(
      state.lastPreMarketAttemptDate,
      state.lastPreMarketAttemptAt,
      today,
      PRE_MARKET_BRIEF_READY_TIME,
    )) {
      return;
    }

    const readiness = await this.tradingCalendarService.canRunPreMarketBrief();
    if (!readiness.ok) {
      await this.recordPreMarketSkip(state, today, readiness.reason);
      return;
    }

    await this.executePreMarketBriefAndRecord("scheduled");
  }

  private async runScheduledUpdatePass(): Promise<void> {
    const today = chinaToday();
    const state = await this.readState();
    if (hasCompletedScheduledWindow(state.lastSuccessDate, state.lastSuccessAt, today, DAILY_UPDATE_READY_TIME)) {
      return;
    }

    const readiness = await this.tradingCalendarService.canRunDailyUpdate();
    if (!readiness.ok && readiness.reason.includes("须等到") && state.lastSuccessDate === today) {
      return;
    }

    await this.executeDailyUpdateAndRecord(false, "scheduled", false);
  }

  private async runScheduledReviewPass(): Promise<void> {
    if (!this.postCloseReviewService) {
      return;
    }

    const today = chinaToday();
    const state = await this.readState();
    if (hasCompletedScheduledWindow(
      state.lastReviewSuccessDate,
      state.lastReviewSuccessAt,
      today,
      POST_CLOSE_REVIEW_READY_TIME,
    )) {
      return;
    }

    const readiness = await this.getScheduledReviewReadiness(state, today);
    if (!readiness.ok) {
      if (readiness.code === "waiting_time" && state.lastReviewSuccessDate === today) {
        return;
      }
      await this.recordReviewSkip(state, today, readiness.reason);
      return;
    }

    await this.executeReviewAndRecord("scheduled");
  }

  private async getScheduledReviewReadiness(
    state: DailyUpdateState,
    today: string,
  ): Promise<ScheduleReadiness> {
    if (!hasCompletedScheduledWindow(state.lastSuccessDate, state.lastSuccessAt, today, DAILY_UPDATE_READY_TIME)) {
      return {
        ok: false,
        reason: `今日日更尚未在 ${DAILY_UPDATE_READY_TIME} 后成功完成，暂不执行收盘复盘`,
        code: "waiting_daily_update",
      };
    }

    const readiness = await this.tradingCalendarService.canRunPostCloseReview();
    if (!readiness.ok) {
      return {
        ok: false,
        reason: readiness.reason,
        code: readiness.reason.includes("须等到") ? "waiting_time" : "non_trading_day",
      };
    }

    return {
      ok: true,
      reason: readiness.reason,
      code: "ready",
    };
  }

  private async recordReviewSkip(
    state: DailyUpdateState,
    today: string,
    reason: string,
  ): Promise<void> {
    await this.writeState({
      ...state,
      lastReviewAttemptAt: formatChinaDateTime(),
      lastReviewAttemptDate: today,
      lastReviewResultType: "skipped",
      lastReviewResultSummary: reason,
      reviewConsecutiveFailures: 0,
    });
  }

  private async recordPreMarketSkip(
    state: DailyUpdateState,
    today: string,
    reason: string,
  ): Promise<void> {
    await this.writeState({
      ...state,
      lastPreMarketAttemptAt: formatChinaDateTime(),
      lastPreMarketAttemptDate: today,
      lastPreMarketResultType: "skipped",
      lastPreMarketResultSummary: reason,
      preMarketConsecutiveFailures: 0,
    });
  }

  private async executeDailyUpdateAndRecord(
    force: boolean,
    trigger: "manual" | "scheduled",
    throwOnError: boolean,
  ): Promise<DailyUpdateExecutionOutput> {
    const today = chinaToday();
    const state = await this.readState();
    const attemptedAt = formatChinaDateTime();

    try {
      const message = await this.updateService.updateAll(force);
      const output: DailyUpdateExecutionOutput = {
        resultType: classifyResult(message),
        message,
      };

      const nextState: DailyUpdateState = {
        ...state,
        lastAttemptAt: attemptedAt,
        lastAttemptDate: today,
        lastResultType: output.resultType,
        lastResultSummary: summarizeUpdateResult(output.message),
        consecutiveFailures: output.resultType === "failed" ? state.consecutiveFailures + 1 : 0,
      };

      if (output.resultType === "success") {
        nextState.lastSuccessAt = attemptedAt;
        nextState.lastSuccessDate = today;
      }

      await this.writeState(nextState);
      if (trigger === "scheduled") {
        await this.maybeSendDailyUpdateNotification(output);
      }
      return output;
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
      const output: DailyUpdateExecutionOutput = {
        resultType: "failed",
        message: failureText,
      };
      if (trigger === "scheduled") {
        await this.maybeSendDailyUpdateNotification(output);
      }
      if (throwOnError) {
        throw error;
      }
      return output;
    }
  }

  private async executeReviewAndRecord(
    trigger: "manual" | "scheduled",
  ): Promise<PostCloseReviewExecutionOutput | null> {
    if (!this.postCloseReviewService) {
      return null;
    }

    const today = chinaToday();
    const state = await this.readState();
    const attemptedAt = formatChinaDateTime();

    try {
      const reviewResult = await this.postCloseReviewService.run();
      const output = createReviewExecutionOutput(reviewResult);
      await this.writeState({
        ...state,
        lastReviewAttemptAt: attemptedAt,
        lastReviewAttemptDate: today,
        lastReviewSuccessAt: attemptedAt,
        lastReviewSuccessDate: today,
        lastReviewResultType: output.resultType,
        lastReviewResultSummary: summarizeReviewResult(output.combinedText),
        reviewConsecutiveFailures: 0,
      });
      if (trigger === "scheduled") {
        await this.maybeSendReviewNotification(output);
      }
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureText = `⚠️ 收盘复盘失败: ${message}`;
      await this.writeState({
        ...state,
        lastReviewAttemptAt: attemptedAt,
        lastReviewAttemptDate: today,
        lastReviewResultType: "failed",
        lastReviewResultSummary: failureText,
        reviewConsecutiveFailures: state.reviewConsecutiveFailures + 1,
      });
      const output: PostCloseReviewExecutionOutput = {
        resultType: "failed",
        overviewMessage: null,
        detailMessages: [],
        combinedText: failureText,
      };
      if (trigger === "scheduled") {
        await this.maybeSendReviewNotification(output);
      }
      return output;
    }
  }

  private async executePreMarketBriefAndRecord(
    trigger: "manual" | "scheduled",
  ): Promise<PreMarketBriefExecutionOutput> {
    const today = chinaToday();
    const state = await this.readState();
    const attemptedAt = formatChinaDateTime();

    try {
      const result = await this.preMarketBriefService.run();
      const output = createPreMarketBriefExecutionOutput(result);
      const nextState: DailyUpdateState = {
        ...state,
        lastPreMarketAttemptAt: attemptedAt,
        lastPreMarketAttemptDate: today,
        lastPreMarketResultType: output.resultType,
        lastPreMarketResultSummary: summarizePreMarketBriefResult(output.message),
        preMarketConsecutiveFailures: output.resultType === "failed" ? state.preMarketConsecutiveFailures + 1 : 0,
      };

      if (output.resultType === "success") {
        nextState.lastPreMarketSuccessAt = attemptedAt;
        nextState.lastPreMarketSuccessDate = today;
      }

      await this.writeState(nextState);
      if (trigger === "scheduled") {
        await this.maybeSendPreMarketBriefNotification(output);
      }
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureText = `⚠️ 开盘前资讯简报失败: ${message}`;
      await this.writeState({
        ...state,
        lastPreMarketAttemptAt: attemptedAt,
        lastPreMarketAttemptDate: today,
        lastPreMarketResultType: "failed",
        lastPreMarketResultSummary: failureText,
        preMarketConsecutiveFailures: state.preMarketConsecutiveFailures + 1,
      });
      const output: PreMarketBriefExecutionOutput = {
        resultType: "failed",
        message: failureText,
      };
      if (trigger === "scheduled") {
        await this.maybeSendPreMarketBriefNotification(output);
      }
      return output;
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

  private async maybeSendDailyUpdateNotification(output: DailyUpdateExecutionOutput): Promise<void> {
    if (!this.notifyEnabled || output.resultType === "skipped") {
      return;
    }

    if (output.resultType !== "success") {
      const message = this.alertService.formatSystemNotification(
        "❌ 定时日更失败",
        selectUpdateNotificationLines(output.message),
      );
      await this.alertService.send(message);
      return;
    }

    const message = this.alertService.formatSystemNotification(
      "📊 定时日更完成",
      normalizeResultLines(output.message),
    );
    await this.alertService.send(message);
  }

  private async maybeSendPreMarketBriefNotification(output: PreMarketBriefExecutionOutput): Promise<void> {
    if (!this.notifyEnabled || output.resultType === "skipped") {
      return;
    }

    if (output.resultType !== "success") {
      const message = this.alertService.formatSystemNotification(
        "❌ 开盘前资讯简报失败",
        selectPreMarketBriefNotificationLines(output.message),
      );
      await this.alertService.send(message);
      return;
    }

    await this.alertService.send(output.message);
  }

  private async maybeSendReviewNotification(output: PostCloseReviewExecutionOutput): Promise<void> {
    if (!this.notifyEnabled || output.resultType === "skipped") {
      return;
    }

    if (output.resultType !== "success") {
      const message = this.alertService.formatSystemNotification(
        "❌ 收盘复盘失败",
        selectReviewNotificationLines(output.combinedText),
      );
      await this.alertService.send(message);
      return;
    }

    const messages = [
      this.alertService.formatSystemNotification(
        "📘 收盘复盘完成",
        selectReviewNotificationLines(output.combinedText),
      ),
      output.overviewMessage,
      ...output.detailMessages,
    ].filter((message): message is string => Boolean(message));

    for (const message of messages) {
      await this.alertService.send(message);
    }
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function createReviewExecutionOutput(
  reviewResult: PostCloseReviewRunResult,
): PostCloseReviewExecutionOutput {
  return {
    resultType: "success",
    overviewMessage: reviewResult.overviewMessage,
    detailMessages: reviewResult.detailMessages,
    combinedText: joinMessages(reviewResult.overviewMessage, ...reviewResult.detailMessages),
  };
}

function createPreMarketBriefExecutionOutput(
  result: PreMarketBriefRunResult,
): PreMarketBriefExecutionOutput {
  return {
    resultType: result.resultType,
    message: result.message,
  };
}

function joinMessages(...parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
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

function summarizeUpdateResult(result: string): string {
  return selectUpdateSummaryLines(result).join(" | ");
}

function summarizeReviewResult(result: string): string {
  return selectReviewSummaryLines(result).join(" | ");
}

function summarizePreMarketBriefResult(result: string): string {
  return selectPreMarketBriefNotificationLines(result).join(" | ");
}

function selectUpdateSummaryLines(result: string): string[] {
  const lines = normalizeResultLines(result);
  const head = lines.slice(0, 2);
  const highlights = lines.filter((line) => /^🏁/.test(line));
  return dedupeLines([...head, ...highlights]).slice(0, 6);
}

function selectReviewSummaryLines(result: string): string[] {
  const lines = normalizeResultLines(result);
  const head = lines.slice(0, 2);
  const highlights = lines.filter((line) => /^(🧭|复盘数量:|关键位验证:|明日处理:|⚠️ 收盘复盘失败|⚠️ 收盘分析\/回测失败)/.test(line));
  return dedupeLines([...head, ...highlights]).slice(0, 6);
}

function selectUpdateNotificationLines(result: string): string[] {
  const lines = normalizeResultLines(result);
  const head = lines.slice(0, 4);
  const highlights = lines.filter((line) => /^🏁/.test(line));
  return dedupeLines([...head, ...highlights]).slice(0, 12);
}

function selectReviewNotificationLines(result: string): string[] {
  const lines = normalizeResultLines(result);
  const head = lines.slice(0, 4);
  const highlights = lines.filter((line) => /^(🧭|复盘数量:|关键位验证:|明日处理:|⚠️ 收盘复盘失败|⚠️ 收盘分析\/回测失败)/.test(line));
  return dedupeLines([...head, ...highlights]).slice(0, 12);
}

function selectPreMarketBriefNotificationLines(result: string): string[] {
  const lines = normalizeResultLines(result);
  const head = lines.slice(0, 4);
  const highlights = lines.filter((line) => /^\*\*【/.test(line));
  return dedupeLines([...head, ...highlights]).slice(0, 12);
}

function normalizeResultLines(result: string): string[] {
  return result
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function dedupeLines(lines: string[]): string[] {
  return [...new Set(lines)];
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

function hasCompletedScheduledWindow(
  successDate: string | null,
  successAt: string | null,
  today: string,
  readyTime: string,
): boolean {
  return successDate === today && extractChinaTime(successAt) >= readyTime;
}

function hasAttemptedScheduledWindow(
  attemptDate: string | null,
  attemptAt: string | null,
  today: string,
  readyTime: string,
): boolean {
  return attemptDate === today && extractChinaTime(attemptAt) >= readyTime;
}

function extractChinaTime(dateTime: string | null): string {
  return dateTime?.slice(11, 16) ?? "00:00";
}
