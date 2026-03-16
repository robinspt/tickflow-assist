import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { WatchlistItem, KeyLevels } from "../types/domain.js";
import type { TickFlowQuote } from "../types/tickflow.js";
import type { MonitorState } from "../types/monitor.js";
import { formatChinaDateTime } from "../utils/china-time.js";
import { QuoteService } from "./quote-service.js";
import { TradingCalendarService } from "./trading-calendar-service.js";
import { WatchlistService } from "./watchlist-service.js";
import { KeyLevelsRepository } from "../storage/repositories/key-levels-repo.js";
import { AlertLogRepository } from "../storage/repositories/alert-log-repo.js";
import { KlinesRepository } from "../storage/repositories/klines-repo.js";
import { AlertService } from "./alert-service.js";

const DEFAULT_STATE: MonitorState = {
  running: false,
  startedAt: null,
  lastStoppedAt: null,
  lastMode: "manual",
  workerPid: null,
  expectedStop: false,
  runtimeHost: null,
  runtimeObservedAt: null,
};

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
    private readonly alertService: AlertService,
  ) {}

  async start(): Promise<string> {
    const watchlist = await this.watchlistService.list();
    if (watchlist.length === 0) {
      throw new Error("关注列表为空，无法启动监控");
    }

    const state = await this.readState();
    if (!state.running) {
      await this.writeState({
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
      lines.push(`• ${item.name}（${item.symbol}） 成本: ${item.costPrice.toFixed(2)}`);
    }

    return lines.join("\n");
  }

  async stop(): Promise<string> {
    const state = await this.readState();
    if (!state.running) {
      return "✅ 监控已停止";
    }

    await this.writeState({
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

  async getStatusReport(): Promise<string> {
    const [state, watchlist, phase] = await Promise.all([
      this.readState(),
      this.watchlistService.list(),
      this.tradingCalendarService.getTradingPhase(),
    ]);

    const lines = [
      "📊 监控状态",
      `状态: ${state.running ? formatRunningState(state) : "⭕ 未启动"}`,
      `运行方式: ${formatRuntimeHost(state)}`,
      `交易时段: ${formatTradingPhase(phase)}`,
      `轮询间隔: ${this.requestInterval} 秒`,
      `告警通道: ${this.alertChannel}`,
      await this.buildAlertLine(),
    ];

    lines.push("", `关注列表（${watchlist.length}只）:`);
    if (watchlist.length === 0) {
      lines.push("• 暂无关注股票");
    } else {
      for (const item of watchlist) {
        lines.push(`• ${item.name}（${item.symbol}） 成本 ${item.costPrice.toFixed(2)}`);
      }
    }

    lines.push("");
    lines.push(...(await this.buildQuoteLines(watchlist)));
    lines.push("");
    lines.push(...(await this.buildKeyLevelsLines(watchlist)));
    return lines.join("\n");
  }

  async runMonitorOnce(): Promise<number> {
    const phase = await this.tradingCalendarService.getTradingPhase();
    if (phase !== "trading") {
      return 0;
    }

    const watchlist = await this.watchlistService.list();
    if (watchlist.length === 0) {
      return 0;
    }

    const quotes = await this.quoteService.fetchQuotes(watchlist.map((item) => item.symbol));
    const quoteMap = new Map(quotes.map((quote) => [quote.symbol, quote]));
    let alertCount = 0;

    for (const item of watchlist) {
      const quote = quoteMap.get(item.symbol);
      if (!quote || !(Number(quote.last_price) > 0)) {
        continue;
      }

      const levels = await this.keyLevelsRepository.getBySymbol(item.symbol);
      if (levels) {
        for (const candidate of buildPriceAlerts(item, quote, levels, this.alertService)) {
          if (await this.trySendAlert(item.symbol, candidate.ruleName, candidate.message)) {
            alertCount += 1;
          }
        }
      }

      const changeAlert = buildChangeAlert(item, quote, this.alertService);
      if (changeAlert && (await this.trySendAlert(item.symbol, changeAlert.ruleName, changeAlert.message))) {
        alertCount += 1;
      }

      const volumeAlert = await this.buildVolumeAlert(item, quote);
      if (volumeAlert && (await this.trySendAlert(item.symbol, volumeAlert.ruleName, volumeAlert.message))) {
        alertCount += 1;
      }
    }

    return alertCount;
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
    const alerts = await this.alertLogRepository.listByNaturalDate(today);
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

  async markRuntimeHost(runtimeHost: "plugin_service" | "fallback_process"): Promise<void> {
    const state = await this.readState();
    await this.writeState({
      ...state,
      runtimeHost,
      runtimeObservedAt: formatChinaDateTime(),
    });
  }

  private async trySendAlert(symbol: string, ruleName: string, message: string): Promise<boolean> {
    const sessionKey = getSessionKey();
    if (await this.alertLogRepository.isSentThisSession(symbol, ruleName, sessionKey)) {
      return false;
    }

    const ok = await this.alertService.send(message);
    if (!ok) {
      return false;
    }

    await this.alertLogRepository.append({
      symbol,
      alert_date: sessionKey,
      rule_name: ruleName,
      message,
      triggered_at: formatChinaDateTime(),
    });
    return true;
  }

  private async buildVolumeAlert(item: WatchlistItem, quote: TickFlowQuote): Promise<AlertCandidate | null> {
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
      }),
    };
  }
}

interface AlertCandidate {
  ruleName: string;
  message: string;
}

function formatRunningState(state: MonitorState): string {
  if (!state.startedAt) {
    return state.workerPid ? `✅ 运行中 (PID=${state.workerPid})` : "✅ 运行中";
  }
  return state.workerPid
    ? `✅ 运行中 (PID=${state.workerPid}, 启动于 ${state.startedAt})`
    : `✅ 运行中 (启动于 ${state.startedAt})`;
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
  const prevClose = Number(quote.prev_close ?? 0);
  const tickflowChangePct = quote.ext?.change_pct;
  const changePct = tickflowChangePct != null
    ? Number(tickflowChangePct) * 100
    : prevClose > 0
      ? ((lastPrice - prevClose) / prevClose) * 100
      : null;
  const quoteTime = formatQuoteTimestamp(quote.timestamp);
  const profitPct = item.costPrice > 0 ? ((lastPrice - item.costPrice) / item.costPrice) * 100 : null;

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

function buildPriceAlerts(
  item: WatchlistItem,
  quote: TickFlowQuote,
  levels: KeyLevels,
  alertService: AlertService,
): AlertCandidate[] {
  const alerts: AlertCandidate[] = [];
  const currentPrice = Number(quote.last_price);
  const buffer = 0.005;

  const push = (ruleName: string, title: string, desc: string, levelPrice: number) => {
    alerts.push({
      ruleName,
      message: alertService.formatPriceAlert({
        symbol: item.symbol,
        name: item.name,
        currentPrice,
        ruleName: title,
        ruleDescription: desc,
        levelPrice,
        costPrice: item.costPrice,
      }),
    });
  };

  if (levels.stop_loss && currentPrice <= levels.stop_loss) {
    push("stop_loss_hit", "⛔ 触及止损", "价格已触及止损位，建议立即执行止损", levels.stop_loss);
  } else if (levels.stop_loss && currentPrice <= levels.stop_loss * (1 + buffer)) {
    push("stop_loss_near", "⚠️ 接近止损", "价格接近止损位，请保持警惕", levels.stop_loss);
  }
  if (levels.breakthrough && currentPrice >= levels.breakthrough) {
    push("breakthrough_hit", "🚀 突破", "价格已突破关键压力位，可能开启新行情", levels.breakthrough);
  }
  if (levels.support && currentPrice <= levels.support * (1 + buffer)) {
    push("support_near", "📉 触及支撑", "价格接近支撑位，关注是否企稳", levels.support);
  }
  if (levels.resistance && currentPrice >= levels.resistance * (1 - buffer)) {
    push("resistance_near", "📈 接近压力", "价格接近压力位，关注能否突破", levels.resistance);
  }
  if (levels.take_profit && currentPrice >= levels.take_profit) {
    push("take_profit_hit", "💰 触及止盈", "价格已达止盈位，建议分批止盈", levels.take_profit);
  }
  return alerts;
}

function buildChangeAlert(
  item: WatchlistItem,
  quote: TickFlowQuote,
  alertService: AlertService,
): AlertCandidate | null {
  const currentPrice = Number(quote.last_price);
  const prevClose = Number(quote.prev_close ?? 0);
  if (!(prevClose > 0)) {
    return null;
  }

  const changePct = (currentPrice - prevClose) / prevClose;
  if (Math.abs(changePct) < 0.05) {
    return null;
  }
  const direction = changePct > 0 ? "涨" : "跌";
  return {
    ruleName: `change_pct_${direction}`,
    message: alertService.formatPriceAlert({
      symbol: item.symbol,
      name: item.name,
      currentPrice,
      ruleName: `📊 ${direction}幅异动`,
      ruleDescription: `当日${direction}幅 ${changePct * 100 >= 0 ? "+" : ""}${(changePct * 100).toFixed(2)}%，超过 5% 阈值`,
      levelPrice: prevClose,
      costPrice: item.costPrice,
    }),
  };
}
