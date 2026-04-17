import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { WatchlistItem, KeyLevels } from "../types/domain.js";
import type { TickFlowIntradayKlineRow, TickFlowQuote } from "../types/tickflow.js";
import type { MonitorState } from "../types/monitor.js";
import {
  AlertDiagnosticLogger,
  basenameOrUndefined,
  buildAlertMessageHash,
  truncateDiagnosticText,
} from "../utils/alert-diagnostic-log.js";
import { formatChinaDateTime } from "../utils/china-time.js";
import { calculateProfitPct, formatCostPrice } from "../utils/cost-price.js";
import { resolveTickFlowQuoteChangePct } from "../utils/tickflow-quote.js";
import { QuoteService } from "./quote-service.js";
import { TradingCalendarService } from "./trading-calendar-service.js";
import { WatchlistService } from "./watchlist-service.js";
import { KeyLevelsRepository } from "../storage/repositories/key-levels-repo.js";
import { AlertLogRepository } from "../storage/repositories/alert-log-repo.js";
import { KlinesRepository } from "../storage/repositories/klines-repo.js";
import { IntradayKlinesRepository } from "../storage/repositories/intraday-klines-repo.js";
import { AlertService, type AlertSendInput } from "./alert-service.js";
import type { TradingPhase } from "./trading-calendar-service.js";
import { KlineService } from "./kline-service.js";
import { AlertMediaService } from "./alert-media-service.js";
import type { AlertImageInput, AlertImagePoint, AlertImageTone } from "./alert-image-service.js";

const DEFAULT_STATE: MonitorState = {
  running: false,
  startedAt: null,
  lastStoppedAt: null,
  lastMode: "manual",
  workerPid: null,
  expectedStop: false,
  runtimeHost: null,
  runtimeObservedAt: null,
  lastHeartbeatAt: null,
  lastLoopError: null,
  lastLoopErrorAt: null,
  lastObservedPhase: null,
  lastObservedPhaseDate: null,
  sessionNotificationsDate: null,
  sessionNotificationsSent: [],
};
const INTRADAY_PERIOD = "1m";
const MONITOR_RUN_LOCK_MIN_STALE_MS = 90_000;
const ALERT_CLAIM_MIN_STALE_MS = 90_000;
const SYSTEM_SESSION_ALERT_SYMBOL = "__system_session__";

export class MonitorService {
  constructor(
    private readonly baseDir: string,
    private readonly requestInterval: number,
    private readonly alertChannel: string,
    private readonly watchlistService: WatchlistService,
    private readonly quoteService: QuoteService,
    private readonly tradingCalendarService: TradingCalendarService,
    private readonly keyLevelsRepository: KeyLevelsRepository,
    private readonly alertLogRepository: AlertLogRepository,
    private readonly klinesRepository: KlinesRepository,
    private readonly intradayKlinesRepository: IntradayKlinesRepository,
    private readonly klineService: KlineService,
    private readonly alertService: AlertService,
    private readonly alertMediaService: AlertMediaService,
    private readonly diagnosticLogger?: AlertDiagnosticLogger,
  ) {}

  async start(): Promise<string> {
    const watchlist = await this.watchlistService.list();
    if (watchlist.length === 0) {
      throw new Error("关注列表为空，无法启动监控");
    }

    const state = await this.readState();
    if (!state.running) {
      await this.writeState({
        ...state,
        running: true,
        startedAt: formatChinaDateTime(),
        lastStoppedAt: state.lastStoppedAt,
        lastMode: "manual",
        workerPid: state.workerPid,
        expectedStop: false,
        runtimeHost: state.runtimeHost,
        runtimeObservedAt: state.runtimeObservedAt,
      });
    }

    const phase = await this.tradingCalendarService.getTradingPhase();
    const statusText = formatTradingPhase(phase);
    const lines = [
      "✅ 实时监控已启动",
      `轮询间隔: ${this.requestInterval} 秒`,
      `交易时段: ${statusText}`,
      `关注列表: ${watchlist.length}只`,
    ];

    for (const item of watchlist) {
      lines.push(`• ${item.name}（${item.symbol}） 成本: ${formatCostPrice(item.costPrice)}`);
    }

    return lines.join("\n");
  }

  async stop(): Promise<string> {
    const state = await this.readState();
    if (!state.running) {
      return "✅ 监控已停止";
    }

    await this.writeState({
      ...state,
      running: false,
      startedAt: null,
      lastStoppedAt: formatChinaDateTime(),
      lastMode: "manual",
      workerPid: null,
      expectedStop: state.expectedStop,
      runtimeHost: state.runtimeHost,
      runtimeObservedAt: state.runtimeObservedAt,
    });

    return [
      "🛑 TickFlow 监控已停止",
      `时间: ${formatChinaDateTime()}`,
      "停止方式: 手动停止",
    ].join("\n");
  }

  async enableManagedLoop(): Promise<{ started: boolean }> {
    const state = await this.readState();
    const watchlist = await this.watchlistService.list();
    if (watchlist.length === 0) {
      throw new Error("关注列表为空，无法启动监控");
    }

    const now = formatChinaDateTime();
    await this.writeState({
      ...state,
      running: true,
      startedAt: state.startedAt ?? now,
      workerPid: null,
      expectedStop: false,
      runtimeHost: "plugin_service",
      runtimeObservedAt: now,
    });
    return { started: !state.running };
  }

  async bindManagedServiceRuntime(): Promise<void> {
    const state = await this.readState();
    const now = formatChinaDateTime();
    await this.writeState({
      ...state,
      workerPid: null,
      expectedStop: false,
      runtimeHost: "plugin_service",
      runtimeObservedAt: now,
    });
  }

  async markStopped(): Promise<void> {
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

  async getStatusReport(): Promise<string> {
    const [state, watchlist, phase] = await Promise.all([
      this.readState(),
      this.watchlistService.list(),
      this.tradingCalendarService.getTradingPhase(),
    ]);

    const lines = [
      "📊 监控状态",
      `状态: ${state.running ? formatRunningState(state, this.requestInterval) : "⭕ 未启动"}`,
      `运行方式: ${formatRuntimeHost(state)}`,
      `交易时段: ${formatTradingPhase(phase)}`,
      `轮询间隔: ${this.requestInterval} 秒`,
      `告警通道: ${this.alertChannel}`,
      `最近心跳: ${formatMonitorHeartbeat(state, this.requestInterval)}`,
      await this.buildAlertLine(),
    ];

    if (state.lastLoopError) {
      lines.push(`最近异常: ${state.lastLoopErrorAt ?? "未知时间"} | ${state.lastLoopError}`);
    }

    lines.push("", `关注列表（${watchlist.length}只）:`);
    if (watchlist.length === 0) {
      lines.push("• 暂无关注股票");
    } else {
      for (const item of watchlist) {
        lines.push(`• ${item.name}（${item.symbol}） 成本 ${formatCostPrice(item.costPrice)}`);
      }
    }

    lines.push("");
    lines.push(...(await this.buildQuoteLines(watchlist)));
    lines.push("");
    lines.push(...(await this.buildKeyLevelsLines(watchlist)));
    return lines.join("\n");
  }

  async runMonitorOnce(
    runtimeHost?: "plugin_service" | "fallback_process",
  ): Promise<number> {
    const runLease = await this.tryAcquireRunLease();
    if (!runLease) {
      return 0;
    }

    try {
      await this.recordHeartbeat(runtimeHost);
      await this.alertMediaService.maybeCleanupExpired();
      const phase = await this.tradingCalendarService.getTradingPhase();
      let alertCount = await this.maybeSendSessionNotification(phase);
      if (phase !== "trading") {
        return alertCount;
      }

      const watchlist = await this.watchlistService.list();
      if (watchlist.length === 0) {
        return alertCount;
      }

      const quotes = await this.quoteService.fetchQuotes(watchlist.map((item) => item.symbol));
      const quoteMap = new Map(quotes.map((quote) => [quote.symbol, quote]));

      for (const item of watchlist) {
        const quote = quoteMap.get(item.symbol);
        if (!quote || !(Number(quote.last_price) > 0)) {
          continue;
        }

        const levels = await this.keyLevelsRepository.getBySymbol(item.symbol);
        let intradayRowsPromise: Promise<TickFlowIntradayKlineRow[]> | null = null;
        const getIntradayRows = (): Promise<TickFlowIntradayKlineRow[]> => {
          intradayRowsPromise ??= this.loadIntradayRows(item.symbol);
          return intradayRowsPromise;
        };

        const priceAlert = levels
          ? selectPrimaryAlertCandidate(buildPriceAlerts(item, quote, levels, this.alertService))
          : null;
        if (priceAlert) {
          if (await this.trySendCandidate(item, quote, priceAlert, levels, getIntradayRows)) {
            alertCount += 1;
          }
          continue;
        }

        const changeAlert = buildChangeAlert(item, quote, levels, this.alertService);
        if (changeAlert) {
          if (await this.trySendCandidate(item, quote, changeAlert, levels, getIntradayRows)) {
            alertCount += 1;
          }
          continue;
        }

        const volumeAlert = await this.buildVolumeAlert(item, quote, levels);
        if (volumeAlert && (await this.trySendAlert(item.symbol, volumeAlert.ruleName, volumeAlert.message))) {
          alertCount += 1;
        }
      }

      return alertCount;
    } finally {
      await runLease.release();
    }
  }

  private async maybeSendSessionNotification(phase: TradingPhase): Promise<number> {
    const now = formatChinaDateTime();
    const today = now.slice(0, 10);
    const hhmm = now.slice(11, 16);
    const state = await this.readState();
    const previousPhase = state.lastObservedPhaseDate === today ? state.lastObservedPhase : null;
    const sent = state.sessionNotificationsDate === today ? state.sessionNotificationsSent : [];
    const nextState: MonitorState = {
      ...state,
      lastObservedPhase: phase,
      lastObservedPhaseDate: today,
      sessionNotificationsDate: today,
      sessionNotificationsSent: [...sent],
    };

    const event = resolveSessionNotification(previousPhase, phase, hhmm, nextState.sessionNotificationsSent);
    if (!event) {
      await this.writeState(nextState);
      return 0;
    }

    const watchlistCount = (await this.watchlistService.list()).length;
    const message = this.alertService.formatSystemNotification(event.title, [
      `时间: ${now}`,
      `阶段: ${event.phaseText}`,
      `关注列表: ${watchlistCount}只`,
    ]);
    const ok = await this.trySendAlert(SYSTEM_SESSION_ALERT_SYMBOL, event.id, message);

    if (
      ok
      || await this.alertLogRepository.isSentThisSession(
        SYSTEM_SESSION_ALERT_SYMBOL,
        event.id,
        getSessionKey(),
      )
    ) {
      nextState.sessionNotificationsSent.push(event.id);
    }

    await this.writeState(nextState);
    return ok ? 1 : 0;
  }

  private async buildQuoteLines(watchlist: WatchlistItem[]): Promise<string[]> {
    const lines = ["💹 最新行情:"];
    if (watchlist.length === 0) {
      lines.push("• 暂无");
      return lines;
    }

    const quotes = await this.quoteService.fetchQuotes(watchlist.map((item) => item.symbol));
    const quoteMap = new Map(quotes.map((quote) => [quote.symbol, quote]));

    for (const item of watchlist) {
      const quote = quoteMap.get(item.symbol);
      if (!quote) {
        lines.push(`• ${item.name}（${item.symbol}）: ⚠️ 未获取到最新行情`);
        continue;
      }
      lines.push(formatQuoteLine(item, quote));
    }

    return lines;
  }

  private async buildKeyLevelsLines(watchlist: WatchlistItem[]): Promise<string[]> {
    if (watchlist.length === 0) {
      return ["关键价位:", "• 暂无"];
    }

    const entries = await Promise.all(
      watchlist.map(async (item) => ({ item, levels: await this.keyLevelsRepository.getBySymbol(item.symbol) })),
    );
    const covered = entries.filter((entry) => entry.levels != null);
    if (covered.length === 0) {
      return ["关键价位:", "• 暂无"];
    }

    const missing = entries.filter((entry) => entry.levels == null).map((entry) => `${entry.item.name}（${entry.item.symbol}）`);
    const scores = covered.map((entry) => `${entry.item.name} ${entry.levels?.score}/10`);
    const lines = ["关键价位:", `• 已分析: ${covered.length}/${watchlist.length}`];
    if (missing.length > 0) {
      lines.push(`• 缺失: ${missing.join(", ")}`);
    }
    if (scores.length > 0) {
      lines.push(`• 评分: ${scores.join(" / ")}`);
    }
    return lines;
  }

  private async buildAlertLine(): Promise<string> {
    const today = formatChinaDateTime().slice(0, 10);
    const alerts = (await this.alertLogRepository.listByNaturalDate(today))
      .filter((entry) => entry.symbol !== SYSTEM_SESSION_ALERT_SYMBOL);
    if (alerts.length === 0) {
      return "今日告警: 无";
    }
    return `今日告警: ${alerts.length}条`;
  }

  private async readState(): Promise<MonitorState> {
    const file = this.getStateFilePath();
    try {
      const raw = await readFile(file, "utf-8");
      return { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<MonitorState>) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ...DEFAULT_STATE };
      }
      throw error;
    }
  }

  private async writeState(state: MonitorState): Promise<void> {
    const file = this.getStateFilePath();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(state, null, 2), "utf-8");
  }

  private getStateFilePath(): string {
    return path.join(this.baseDir, "monitor-state.json");
  }

  async getState(): Promise<MonitorState> {
    return this.readState();
  }

  async setWorkerPid(pid: number | null): Promise<void> {
    const state = await this.readState();
    await this.writeState({
      ...state,
      workerPid: pid,
    });
  }

  async setExpectedStop(expectedStop: boolean): Promise<void> {
    const state = await this.readState();
    await this.writeState({
      ...state,
      expectedStop,
    });
  }

  async recordHeartbeat(
    runtimeHost?: "plugin_service" | "fallback_process",
  ): Promise<void> {
    const state = await this.readState();
    const now = formatChinaDateTime();
    await this.writeState({
      ...state,
      lastHeartbeatAt: now,
      runtimeHost: runtimeHost ?? state.runtimeHost,
      runtimeObservedAt: now,
    });
  }

  async recordLoopError(error: unknown): Promise<void> {
    const state = await this.readState();
    const message = error instanceof Error ? error.message : String(error);
    await this.writeState({
      ...state,
      lastLoopError: message,
      lastLoopErrorAt: formatChinaDateTime(),
    });
  }

  private async tryAcquireRunLease(): Promise<{ release(): Promise<void> } | null> {
    const lockPath = this.getRunLockFilePath();
    await mkdir(path.dirname(lockPath), { recursive: true });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await writeFile(
          lockPath,
          JSON.stringify({
            pid: process.pid,
            acquiredAt: formatChinaDateTime(),
          }),
          { flag: "wx" },
        );
        return {
          release: async () => {
            await rm(lockPath, { force: true });
          },
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") {
          throw error;
        }

        const cleared = await this.removeStaleRunLock(lockPath);
        if (!cleared) {
          return null;
        }
      }
    }

    return null;
  }

  private async removeStaleRunLock(lockPath: string): Promise<boolean> {
    try {
      const lockStat = await stat(lockPath);
      const staleMs = Math.max(this.requestInterval * 4 * 1000, MONITOR_RUN_LOCK_MIN_STALE_MS);
      if (Date.now() - lockStat.mtimeMs <= staleMs) {
        return false;
      }

      await rm(lockPath, { force: true });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return true;
      }
      throw error;
    }
  }

  private async tryAcquireAlertClaim(
    symbol: string,
    ruleName: string,
    sessionKey: string,
  ): Promise<{ release(): Promise<void> } | null> {
    const lockPath = this.getAlertClaimFilePath(symbol, ruleName, sessionKey);
    await mkdir(path.dirname(lockPath), { recursive: true });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await writeFile(
          lockPath,
          JSON.stringify({
            pid: process.pid,
            symbol,
            ruleName,
            sessionKey,
            acquiredAt: formatChinaDateTime(),
          }),
          { flag: "wx" },
        );
        return {
          release: async () => {
            await rm(lockPath, { force: true });
          },
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") {
          throw error;
        }

        const cleared = await this.removeStaleAlertClaim(lockPath);
        if (!cleared) {
          return null;
        }
      }
    }

    return null;
  }

  private async removeStaleAlertClaim(lockPath: string): Promise<boolean> {
    try {
      const lockStat = await stat(lockPath);
      const staleMs = Math.max(this.requestInterval * 4 * 1000, ALERT_CLAIM_MIN_STALE_MS);
      if (Date.now() - lockStat.mtimeMs <= staleMs) {
        return false;
      }

      await rm(lockPath, { force: true });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return true;
      }
      throw error;
    }
  }

  private async trySendAlert(symbol: string, ruleName: string, input: string | AlertSendInput): Promise<boolean> {
    const sessionKey = getSessionKey();
    const message = typeof input === "string" ? input : input.message;
    const messageHash = buildAlertMessageHash(message);
    const hasMedia = typeof input !== "string" && Boolean(input.mediaPath);

    await this.logDiagnostic("try_send_alert_enter", {
      symbol,
      ruleName,
      sessionKey,
      messageHash,
      hasMedia,
      mediaFile: typeof input === "string" ? undefined : basenameOrUndefined(input.mediaPath),
    });

    const claim = await this.tryAcquireAlertClaim(symbol, ruleName, sessionKey);
    if (!claim) {
      await this.logDiagnostic("try_send_alert_claim_busy", {
        symbol,
        ruleName,
        sessionKey,
        messageHash,
      });
      await this.cleanupAlertMedia(input);
      return false;
    }

    try {
      if (await this.alertLogRepository.isSentThisSession(symbol, ruleName, sessionKey)) {
        await this.logDiagnostic("try_send_alert_already_sent", {
          symbol,
          ruleName,
          sessionKey,
          messageHash,
        });
        await this.cleanupAlertMedia(input);
        return false;
      }

      const result = await this.sendAlertAndCleanupMedia(input);
      await this.logDiagnostic("try_send_alert_result", {
        symbol,
        ruleName,
        sessionKey,
        messageHash,
        ok: result.ok,
        mediaAttempted: result.mediaAttempted,
        mediaDelivered: result.mediaDelivered,
        deliveryUncertain: result.deliveryUncertain === true,
        error: result.error ? truncateDiagnosticText(result.error) : null,
      });
      if (!result.ok && !result.deliveryUncertain) {
        return false;
      }

      await this.alertLogRepository.append({
        symbol,
        alert_date: sessionKey,
        rule_name: ruleName,
        message,
        triggered_at: formatChinaDateTime(),
      });
      await this.logDiagnostic("try_send_alert_logged", {
        symbol,
        ruleName,
        sessionKey,
        messageHash,
      });
      return true;
    } finally {
      await claim.release();
    }
  }

  private async trySendCandidate(
    item: WatchlistItem,
    quote: TickFlowQuote,
    candidate: AlertCandidate,
    levels: KeyLevels | null,
    getIntradayRows: () => Promise<TickFlowIntradayKlineRow[]>,
  ): Promise<boolean> {
    if (await this.hasSentAlert(item.symbol, candidate.ruleName)) {
      return false;
    }

    const delivery = await this.buildAlertDelivery(item, quote, candidate, levels, getIntradayRows);
    return this.trySendAlert(item.symbol, candidate.ruleName, delivery);
  }

  private async buildAlertDelivery(
    item: WatchlistItem,
    quote: TickFlowQuote,
    candidate: AlertCandidate,
    levels: KeyLevels | null,
    getIntradayRows: () => Promise<TickFlowIntradayKlineRow[]>,
  ): Promise<string | AlertSendInput> {
    if (!candidate.image || !levels) {
      return candidate.message;
    }

    try {
      const rows = await getIntradayRows();
      const points = buildAlertImagePoints(rows, quote);
      if (points.length < 2) {
        return candidate.message;
      }

      const currentPrice = Number(quote.last_price);
      const image: AlertImageInput = {
        tone: candidate.image.tone,
        alertLabel: candidate.image.alertLabel,
        name: item.name,
        symbol: item.symbol,
        timestampLabel: `实时告警 | ${formatChinaDateTime().slice(0, 16)}`,
        currentPrice,
        triggerPrice: candidate.image.triggerPrice,
        changePct: getQuoteChangePct(quote),
        distancePct: candidate.image.triggerPrice > 0
          ? ((currentPrice - candidate.image.triggerPrice) / candidate.image.triggerPrice) * 100
          : null,
        costPrice: item.costPrice,
        profitPct: calculateProfitPct(currentPrice, item.costPrice),
        note: candidate.image.note,
        points,
        levels: {
          stopLoss: levels.stop_loss,
          support: levels.support,
          resistance: levels.resistance,
          breakthrough: levels.breakthrough,
          takeProfit: levels.take_profit,
        },
      };
      const media = await this.alertMediaService.writeAlertCard({
        symbol: item.symbol,
        ruleName: candidate.ruleName,
        image,
      });

      return {
        message: candidate.message,
        mediaPath: media.filePath,
        mediaLocalRoots: media.mediaLocalRoots,
        filename: media.filename,
      };
    } catch {
      return candidate.message;
    }
  }

  private async loadIntradayRows(symbol: string): Promise<TickFlowIntradayKlineRow[]> {
    const today = formatChinaDateTime().slice(0, 10);
    const cachedRows = (await this.intradayKlinesRepository.listBySymbol(symbol, INTRADAY_PERIOD))
      .filter((row) => row.trade_date === today);

    try {
      const fetchedRows = await this.klineService.fetchIntradayKlines(symbol, {
        period: INTRADAY_PERIOD,
      });
      const todayRows = fetchedRows.filter((row) => row.trade_date === today);
      if (todayRows.length > 0) {
        await this.intradayKlinesRepository.saveAll(symbol, INTRADAY_PERIOD, todayRows);
        return todayRows;
      }
    } catch {
      // 图片告警是增强能力，分钟线拉取失败时回退纯文本。
    }

    return cachedRows;
  }

  private async buildVolumeAlert(
    item: WatchlistItem,
    quote: TickFlowQuote,
    levels: KeyLevels | null,
  ): Promise<AlertCandidate | null> {
    const klines = await this.klinesRepository.listBySymbol(item.symbol);
    if (klines.length < 5 || !(Number(quote.volume ?? 0) > 0)) {
      return null;
    }

    const avgVolume = klines.slice(-5).reduce((sum, row) => sum + row.volume, 0) / 5;
    const ratio = Number(quote.volume) / avgVolume;
    if (!(ratio >= 3.0)) {
      return null;
    }

    return {
      ruleName: "volume_spike",
      message: this.alertService.formatVolumeAlert({
        symbol: item.symbol,
        name: item.name,
        currentPrice: Number(quote.last_price),
        currentVolume: Number(quote.volume),
        avgVolume,
        ratio,
        dailyChangePct: getQuoteChangePct(quote),
        relatedLevels: levels,
      }),
    };
  }

  private async hasSentAlert(symbol: string, ruleName: string): Promise<boolean> {
    return this.alertLogRepository.isSentThisSession(symbol, ruleName, getSessionKey());
  }

  private async sendAlertAndCleanupMedia(input: string | AlertSendInput) {
    try {
      return await this.alertService.sendWithResult(input);
    } finally {
      await this.cleanupAlertMedia(input);
    }
  }

  private async cleanupAlertMedia(input: string | AlertSendInput): Promise<void> {
    if (typeof input === "string" || !input.mediaPath) {
      return;
    }

    await this.alertMediaService.removeFile(input.mediaPath).catch(() => {});
  }

  private getRunLockFilePath(): string {
    return path.join(this.baseDir, "monitor-run.lock");
  }

  private getAlertClaimFilePath(symbol: string, ruleName: string, sessionKey: string): string {
    return path.join(
      this.baseDir,
      "alert-claims",
      `${sanitizeAlertClaimPart(sessionKey)}_${sanitizeAlertClaimPart(symbol)}_${sanitizeAlertClaimPart(ruleName)}.lock`,
    );
  }

  private async logDiagnostic(event: string, details: Record<string, unknown>): Promise<void> {
    await this.diagnosticLogger?.append("monitor_service", event, details);
  }
}

interface AlertCandidate {
  ruleName: string;
  message: string;
  image?: {
    tone: AlertImageTone;
    alertLabel: string;
    note: string;
    triggerPrice: number;
  };
}

function formatRunningState(state: MonitorState, requestInterval: number): string {
  const heartbeat = getHeartbeatStatus(state, requestInterval);
  const base = !state.startedAt
    ? state.workerPid ? `✅ 运行中 (PID=${state.workerPid})` : "✅ 运行中"
    : state.workerPid
      ? `✅ 运行中 (PID=${state.workerPid}, 启动于 ${state.startedAt})`
      : `✅ 运行中 (启动于 ${state.startedAt})`;

  if (heartbeat.isStale) {
    return `${base} ⚠️ 心跳超时`;
  }

  return base;
}

function formatMonitorHeartbeat(state: MonitorState, requestInterval: number): string {
  const heartbeat = getHeartbeatStatus(state, requestInterval);
  if (!heartbeat.heartbeatAt) {
    return "暂无";
  }
  if (heartbeat.isStale) {
    return `${heartbeat.heartbeatAt}（已超时 ${heartbeat.staleSeconds} 秒）`;
  }
  return heartbeat.heartbeatAt;
}

function getHeartbeatStatus(
  state: MonitorState,
  requestInterval: number,
): { observedAt: string | null; heartbeatAt: string | null; isStale: boolean; staleSeconds: number } {
  const observedAt = state.runtimeObservedAt;
  const heartbeatAt = state.lastHeartbeatAt ?? observedAt;
  if (!heartbeatAt || !state.running) {
    return { observedAt, heartbeatAt, isStale: false, staleSeconds: 0 };
  }

  const observedMs = parseChinaDateTime(heartbeatAt);
  if (observedMs == null) {
    return { observedAt, heartbeatAt, isStale: false, staleSeconds: 0 };
  }

  const diffSeconds = Math.max(0, Math.floor((Date.now() - observedMs) / 1000));
  const staleThresholdSeconds = Math.max(requestInterval * 3, 90);
  return {
    observedAt,
    heartbeatAt,
    isStale: diffSeconds > staleThresholdSeconds,
    staleSeconds: diffSeconds,
  };
}

function parseChinaDateTime(value: string): number | null {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - 8,
    Number(minute),
    Number(second),
  );
}

function sanitizeAlertClaimPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function formatRuntimeHost(state: MonitorState): string {
  return state.runtimeHost === "plugin_service"
    ? "plugin_service"
    : state.runtimeHost === "fallback_process"
      ? "fallback_process"
      : "unknown";
}

function formatTradingPhase(phase: string): string {
  switch (phase) {
    case "trading":
      return "🟢 交易中";
    case "pre_market":
      return "🟡 盘前等待";
    case "lunch_break":
      return "🟡 午间休市";
    case "closed":
      return "🔴 已收盘";
    default:
      return "❌ 非交易日";
  }
}

function formatQuoteLine(item: WatchlistItem, quote: TickFlowQuote): string {
  const lastPrice = Number(quote.last_price ?? 0);
  const changePct = resolveTickFlowQuoteChangePct(quote);
  const quoteTime = formatQuoteTimestamp(quote.timestamp);
  const profitPct = calculateProfitPct(lastPrice, item.costPrice);

  let line = `• ${item.name}（${item.symbol}） ${lastPrice.toFixed(2)}`;
  if (changePct != null) {
    line += ` | 涨跌 ${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
  }
  line += ` | ${quoteTime}`;
  if (profitPct != null) {
    line += ` | 浮盈 ${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(2)}%`;
  }
  return line;
}

function formatQuoteTimestamp(timestamp: number): string {
  const millis = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return formatter.format(new Date(millis));
}

function getSessionKey(): string {
  const current = formatChinaDateTime();
  const date = current.slice(0, 10);
  const hhmm = current.slice(11, 16);
  return hhmm < "13:00" ? `${date}_AM` : `${date}_PM`;
}

type SessionNotificationId =
  | "morning_start"
  | "morning_end"
  | "afternoon_start"
  | "day_end";

interface SessionNotification {
  id: SessionNotificationId;
  title: string;
  phaseText: string;
}

function resolveSessionNotification(
  previousPhase: TradingPhase | null,
  currentPhase: TradingPhase,
  hhmm: string,
  sent: string[],
): SessionNotification | null {
  const hasSent = (id: SessionNotificationId) => sent.includes(id);

  if (
    !hasSent("morning_start")
    && currentPhase === "trading"
    && hhmm <= "11:30"
    && ((previousPhase === "pre_market") || isWithinWindow(hhmm, "09:30", "09:40"))
  ) {
    return {
      id: "morning_start",
      title: "🔔 开始上午盯盘",
      phaseText: "上午盘开盘",
    };
  }

  if (
    !hasSent("morning_end")
    && currentPhase === "lunch_break"
    && ((previousPhase === "trading") || isWithinWindow(hhmm, "11:30", "11:40"))
  ) {
    return {
      id: "morning_end",
      title: "🔔 上午盯盘结束",
      phaseText: "上午盘收盘",
    };
  }

  if (
    !hasSent("afternoon_start")
    && currentPhase === "trading"
    && hhmm >= "13:00"
    && ((previousPhase === "lunch_break") || isWithinWindow(hhmm, "13:00", "13:10"))
  ) {
    return {
      id: "afternoon_start",
      title: "🔔 开始下午盯盘",
      phaseText: "下午盘开盘",
    };
  }

  if (
    !hasSent("day_end")
    && currentPhase === "closed"
    && ((previousPhase === "trading") || isWithinWindow(hhmm, "15:00", "15:10"))
  ) {
    return {
      id: "day_end",
      title: "🔔 今日盯盘结束",
      phaseText: "今日收盘",
    };
  }

  return null;
}

function isWithinWindow(value: string, start: string, end: string): boolean {
  return value >= start && value <= end;
}

function buildPriceAlerts(
  item: WatchlistItem,
  quote: TickFlowQuote,
  levels: KeyLevels,
  alertService: AlertService,
): AlertCandidate[] {
  const alerts: AlertCandidate[] = [];
  const currentPrice = Number(quote.last_price);
  const dailyChangePct = getQuoteChangePct(quote);
  const buffer = 0.005;

  const push = (ruleName: string, title: string, desc: string, levelPrice: number) => {
    alerts.push({
      ruleName,
      message: alertService.formatPriceAlert({
        symbol: item.symbol,
        name: item.name,
        currentPrice,
        ruleCode: ruleName,
        title,
        ruleDescription: desc,
        levelPrice,
        costPrice: item.costPrice,
        dailyChangePct,
        relatedLevels: levels,
      }),
      image: {
        tone: resolveAlertImageTone(ruleName),
        alertLabel: resolveAlertImageLabel(ruleName, title),
        note: desc,
        triggerPrice: levelPrice,
      },
    });
  };

  if (levels.stop_loss && currentPrice <= levels.stop_loss) {
    push("stop_loss_hit", "⛔ 触及止损", "价格已触及止损位，建议立即执行止损", levels.stop_loss);
  } else if (
    levels.stop_loss
    && currentPrice > levels.stop_loss
    && isWithinPriceBuffer(currentPrice, levels.stop_loss, buffer)
  ) {
    push("stop_loss_near", "⚠️ 接近止损", "价格接近止损位，请保持警惕", levels.stop_loss);
  }
  if (levels.take_profit && currentPrice >= levels.take_profit) {
    push("take_profit_hit", "💰 触及止盈", "价格已达止盈位，建议分批止盈", levels.take_profit);
  }
  if (levels.breakthrough && currentPrice >= levels.breakthrough) {
    push("breakthrough_hit", "🚀 突破", "价格已突破关键压力位，可能开启新行情", levels.breakthrough);
  }
  if (levels.support && isWithinPriceBuffer(currentPrice, levels.support, buffer)) {
    push("support_near", "📉 触及支撑", "价格接近支撑位，关注是否企稳", levels.support);
  }
  if (levels.resistance && isWithinPriceBuffer(currentPrice, levels.resistance, buffer)) {
    push("resistance_near", "📈 接近压力", "价格接近压力位，关注能否突破", levels.resistance);
  }
  return alerts;
}

function selectPrimaryAlertCandidate(candidates: AlertCandidate[]): AlertCandidate | null {
  let best: AlertCandidate | null = null;
  let bestPriority = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const priority = getAlertPriority(candidate.ruleName);
    if (priority > bestPriority) {
      best = candidate;
      bestPriority = priority;
    }
  }

  return best;
}

function getAlertPriority(ruleName: string): number {
  switch (ruleName) {
    case "stop_loss_hit":
      return 600;
    case "take_profit_hit":
      return 500;
    case "breakthrough_hit":
      return 400;
    case "stop_loss_near":
      return 300;
    case "support_near":
      return 200;
    case "resistance_near":
      return 100;
    default:
      return 0;
  }
}

function isWithinPriceBuffer(currentPrice: number, levelPrice: number, buffer: number): boolean {
  return currentPrice >= levelPrice * (1 - buffer) && currentPrice <= levelPrice * (1 + buffer);
}

function buildChangeAlert(
  item: WatchlistItem,
  quote: TickFlowQuote,
  levels: KeyLevels | null,
  alertService: AlertService,
): AlertCandidate | null {
  const currentPrice = Number(quote.last_price);
  const prevClose = Number(quote.prev_close ?? 0);
  const changePct = getQuoteChangePct(quote);
  if (!(prevClose > 0) || changePct == null) {
    return null;
  }

  if (Math.abs(changePct) < 5) {
    return null;
  }
  const direction = changePct > 0 ? "涨" : "跌";
  return {
    ruleName: `change_pct_${direction}`,
    message: alertService.formatPriceAlert({
      symbol: item.symbol,
      name: item.name,
      currentPrice,
      ruleCode: `change_pct_${direction}`,
      title: `${direction}幅异动`,
      ruleDescription: `当日${direction}幅 ${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%，超过 5% 阈值`,
      levelPrice: prevClose,
      costPrice: item.costPrice,
      referenceLabel: "昨收基准",
      dailyChangePct: changePct,
      relatedLevels: levels,
    }),
    image: {
      tone: direction === "涨" ? "breakthrough" : "stop_loss",
      alertLabel: direction === "涨" ? "涨幅异动" : "跌幅异动",
      note: `当日${direction}幅 ${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%，超过 5% 阈值`,
      triggerPrice: prevClose,
    },
  };
}

function buildAlertImagePoints(
  rows: TickFlowIntradayKlineRow[],
  quote: TickFlowQuote,
): AlertImagePoint[] {
  const points = rows.map((row) => ({
    time: row.trade_time.slice(0, 5),
    price: row.close,
  }));

  const currentPrice = Number(quote.last_price ?? 0);
  if (!(currentPrice > 0)) {
    return points;
  }

  const quoteTime = formatQuoteTimestamp(quote.timestamp).slice(0, 5);
  if (points.length === 0) {
    return [];
  }

  const lastPoint = points[points.length - 1];
  if (!lastPoint) {
    return points;
  }

  if (lastPoint.time === quoteTime) {
    lastPoint.price = currentPrice;
    return points;
  }

  if (quoteTime < lastPoint.time) {
    return points;
  }

  points.push({
    time: quoteTime,
    price: currentPrice,
  });
  return points;
}

function resolveAlertImageTone(ruleName: string): AlertImageTone {
  switch (ruleName) {
    case "stop_loss_hit":
    case "stop_loss_near":
    case "change_pct_跌":
      return "stop_loss";
    case "breakthrough_hit":
    case "change_pct_涨":
      return "breakthrough";
    case "support_near":
      return "support";
    case "resistance_near":
      return "pressure";
    case "take_profit_hit":
      return "take_profit";
    default:
      return "support";
  }
}

function resolveAlertImageLabel(ruleName: string, fallbackTitle: string): string {
  switch (ruleName) {
    case "stop_loss_hit":
      return "止损执行";
    case "stop_loss_near":
      return "止损预警";
    case "breakthrough_hit":
      return "突破确认";
    case "support_near":
      return "支撑观察";
    case "resistance_near":
      return "压力试探";
    case "take_profit_hit":
      return "止盈兑现";
    case "change_pct_涨":
      return "涨幅异动";
    case "change_pct_跌":
      return "跌幅异动";
    default:
      return fallbackTitle;
  }
}

function getQuoteChangePct(quote: TickFlowQuote): number | null {
  return resolveTickFlowQuoteChangePct(quote);
}
