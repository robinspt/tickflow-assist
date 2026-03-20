import type { TickFlowIntradayKlineRow, TickFlowKlineRow } from "../types/tickflow.js";
import type { KeyLevelsHistoryEntry } from "../types/domain.js";
import { normalizeSymbol } from "../utils/symbol.js";
import { IntradayKlinesRepository } from "../storage/repositories/intraday-klines-repo.js";
import { KlinesRepository } from "../storage/repositories/klines-repo.js";
import { KeyLevelsHistoryRepository } from "../storage/repositories/key-levels-history-repo.js";
import { WatchlistService } from "./watchlist-service.js";

const HORIZONS = [1, 3, 5] as const;
const INTRADAY_PERIOD = "1m";
const LEVEL_BUFFER = 0.005;
const DEFAULT_RECENT_LIMIT = 5;

type Horizon = (typeof HORIZONS)[number];

interface ReactionStats {
  sampleCount: number;
  touchCount: number;
  validCount: number;
}

interface ThresholdStats {
  sampleCount: number;
  hitCount: number;
}

interface BreakthroughStats {
  sampleCount: number;
  hitCount: number;
  confirmCount: number;
}

interface TradePathStats {
  sampleCount: number;
  stopFirstCount: number;
  takeProfitFirstCount: number;
  unresolvedCount: number;
  sameDayConflictCount: number;
  intradayResolvedCount: number;
  intradayMissingCount: number;
  intradayAmbiguousCount: number;
}

interface HorizonStats {
  horizon: Horizon;
  support: ReactionStats;
  resistance: ReactionStats;
  stopLoss: ThresholdStats;
  takeProfit: ThresholdStats;
  breakthrough: BreakthroughStats;
  tradePath: TradePathStats;
}

export interface KeyLevelsBacktestReport {
  scopeLabel: string;
  snapshots: KeyLevelsHistoryEntry[];
  recentSnapshots: KeyLevelsHistoryEntry[];
  horizons: HorizonStats[];
  conclusion: string;
}

export class KeyLevelsBacktestService {
  constructor(
    private readonly keyLevelsHistoryRepository: KeyLevelsHistoryRepository,
    private readonly klinesRepository: KlinesRepository,
    private readonly intradayKlinesRepository: IntradayKlinesRepository,
    private readonly watchlistService: WatchlistService,
  ) {}

  async buildReport(input: {
    symbol?: string;
    recentLimit?: number;
  } = {}): Promise<KeyLevelsBacktestReport> {
    const symbol = input.symbol ? normalizeSymbol(input.symbol) : undefined;
    const snapshots = symbol
      ? await this.keyLevelsHistoryRepository.listBySymbol(symbol)
      : await this.listWatchlistSnapshots();
    const symbols = uniqueSymbols(snapshots);
    const [klinesMap, intradayMap] = await Promise.all([
      this.loadKlinesMap(symbols),
      this.loadIntradayMap(symbols),
    ]);
    const horizons = HORIZONS.map((horizon) => this.buildHorizonStats(snapshots, klinesMap, intradayMap, horizon));

    return {
      scopeLabel: symbol ? `活动价位回测: ${symbol}` : "活动价位回测: 全部关注股",
      snapshots,
      recentSnapshots: snapshots.slice(0, input.recentLimit ?? DEFAULT_RECENT_LIMIT),
      horizons,
      conclusion: buildConclusion(horizons),
    };
  }

  async render(input: { symbol?: string; recentLimit?: number } = {}): Promise<string> {
    const report = await this.buildReport(input);
    const lines = [`🧪 ${report.scopeLabel}`, `活动快照: ${report.snapshots.length} 条`];

    if (report.snapshots.length === 0) {
      lines.push("⚠️ 暂无活动价位历史快照，需先完成至少一次收盘后分析。", report.conclusion);
      return lines.join("\n");
    }

    for (const horizon of report.horizons) {
      lines.push(
        "",
        `${horizon.horizon}日窗口:`,
        `• 支撑: 样本 ${horizon.support.sampleCount} | 触达 ${horizon.support.touchCount} (${formatRate(horizon.support.touchCount, horizon.support.sampleCount)}) | 守住 ${horizon.support.validCount} (${formatRate(horizon.support.validCount, horizon.support.touchCount)})`,
        `• 压力: 样本 ${horizon.resistance.sampleCount} | 触达 ${horizon.resistance.touchCount} (${formatRate(horizon.resistance.touchCount, horizon.resistance.sampleCount)}) | 压制 ${horizon.resistance.validCount} (${formatRate(horizon.resistance.validCount, horizon.resistance.touchCount)})`,
        `• 止损: 样本 ${horizon.stopLoss.sampleCount} | 触发 ${horizon.stopLoss.hitCount} (${formatRate(horizon.stopLoss.hitCount, horizon.stopLoss.sampleCount)}) | 未触发 ${horizon.stopLoss.sampleCount - horizon.stopLoss.hitCount} (${formatRate(horizon.stopLoss.sampleCount - horizon.stopLoss.hitCount, horizon.stopLoss.sampleCount)})`,
        `• 止盈: 样本 ${horizon.takeProfit.sampleCount} | 触发 ${horizon.takeProfit.hitCount} (${formatRate(horizon.takeProfit.hitCount, horizon.takeProfit.sampleCount)}) | 未触发 ${horizon.takeProfit.sampleCount - horizon.takeProfit.hitCount} (${formatRate(horizon.takeProfit.sampleCount - horizon.takeProfit.hitCount, horizon.takeProfit.sampleCount)})`,
        `• 突破: 样本 ${horizon.breakthrough.sampleCount} | 触达 ${horizon.breakthrough.hitCount} (${formatRate(horizon.breakthrough.hitCount, horizon.breakthrough.sampleCount)}) | 确认 ${horizon.breakthrough.confirmCount} (${formatRate(horizon.breakthrough.confirmCount, horizon.breakthrough.hitCount)})`,
        `• 路径: 双目标样本 ${horizon.tradePath.sampleCount} | 先止损 ${horizon.tradePath.stopFirstCount} (${formatRate(horizon.tradePath.stopFirstCount, horizon.tradePath.sampleCount)}) | 先止盈 ${horizon.tradePath.takeProfitFirstCount} (${formatRate(horizon.tradePath.takeProfitFirstCount, horizon.tradePath.sampleCount)}) | 未决 ${horizon.tradePath.unresolvedCount} (${formatRate(horizon.tradePath.unresolvedCount, horizon.tradePath.sampleCount)})`,
        `• 分钟判定: 同日冲突 ${horizon.tradePath.sameDayConflictCount} | 分钟解开 ${horizon.tradePath.intradayResolvedCount} | 缺分钟线 ${horizon.tradePath.intradayMissingCount} | 同分钟未决 ${horizon.tradePath.intradayAmbiguousCount}`,
      );
    }

    if (input.symbol && report.recentSnapshots.length > 0) {
      lines.push("", "最近活动价位快照:");
      for (const snapshot of report.recentSnapshots) {
        lines.push(
          `• ${snapshot.analysis_date} | 评分 ${formatMaybeInt(snapshot.score)} | 支撑 ${formatMaybePrice(snapshot.support)} | 压力 ${formatMaybePrice(snapshot.resistance)} | 突破 ${formatMaybePrice(snapshot.breakthrough)} | 止损 ${formatMaybePrice(snapshot.stop_loss)} | 止盈 ${formatMaybePrice(snapshot.take_profit)}`,
        );
      }
    }

    lines.push("", report.conclusion);
    return lines.join("\n");
  }

  async buildSummaryLines(input: { symbol?: string; recentLimit?: number } = {}): Promise<string[]> {
    const report = await this.buildReport(input);
    const lines = [`🧪 ${report.scopeLabel} | 活动快照 ${report.snapshots.length} 条`];

    for (const horizon of report.horizons) {
      lines.push(
        `🧪 ${horizon.horizon}日: 支撑守住 ${formatRate(horizon.support.validCount, horizon.support.touchCount)} | 压力压制 ${formatRate(horizon.resistance.validCount, horizon.resistance.touchCount)} | 止损触发 ${formatRate(horizon.stopLoss.hitCount, horizon.stopLoss.sampleCount)} | 止盈触发 ${formatRate(horizon.takeProfit.hitCount, horizon.takeProfit.sampleCount)} | 突破确认 ${formatRate(horizon.breakthrough.confirmCount, horizon.breakthrough.hitCount)}`,
      );
      lines.push(
        `🧪 ${horizon.horizon}日先到: 止损 ${formatRate(horizon.tradePath.stopFirstCount, horizon.tradePath.sampleCount)} | 止盈 ${formatRate(horizon.tradePath.takeProfitFirstCount, horizon.tradePath.sampleCount)} | 未决 ${formatRate(horizon.tradePath.unresolvedCount, horizon.tradePath.sampleCount)} | 分钟判定 ${horizon.tradePath.intradayResolvedCount}/${horizon.tradePath.sameDayConflictCount}`,
      );
    }

    lines.push(report.conclusion);
    return lines;
  }

  private async listWatchlistSnapshots(): Promise<KeyLevelsHistoryEntry[]> {
    const watchlist = await this.watchlistService.list();
    if (watchlist.length === 0) {
      return [];
    }

    const symbols = new Set(watchlist.map((item) => item.symbol));
    const snapshots = await this.keyLevelsHistoryRepository.listLatest();
    return snapshots.filter((snapshot) => symbols.has(snapshot.symbol));
  }

  private async loadKlinesMap(symbols: string[]): Promise<Map<string, TickFlowKlineRow[]>> {
    const entries = await Promise.all(
      symbols.map(async (symbol) => [symbol, await this.klinesRepository.listBySymbol(symbol)] as const),
    );
    return new Map(entries);
  }

  private async loadIntradayMap(symbols: string[]): Promise<Map<string, Map<string, TickFlowIntradayKlineRow[]>>> {
    const entries = await Promise.all(
      symbols.map(async (symbol) => {
        const rows = await this.intradayKlinesRepository.listBySymbol(symbol, INTRADAY_PERIOD);
        return [symbol, groupIntradayByTradeDate(rows)] as const;
      }),
    );
    return new Map(entries);
  }

  private buildHorizonStats(
    snapshots: KeyLevelsHistoryEntry[],
    klinesMap: Map<string, TickFlowKlineRow[]>,
    intradayMap: Map<string, Map<string, TickFlowIntradayKlineRow[]>>,
    horizon: Horizon,
  ): HorizonStats {
    const support = createReactionStats();
    const resistance = createReactionStats();
    const stopLoss = createThresholdStats();
    const takeProfit = createThresholdStats();
    const breakthrough = createBreakthroughStats();
    const tradePath = createTradePathStats();

    for (const snapshot of snapshots) {
      const klines = klinesMap.get(snapshot.symbol) ?? [];
      const intradayByDate = intradayMap.get(snapshot.symbol) ?? new Map<string, TickFlowIntradayKlineRow[]>();
      const futureRows = getFutureRows(klines, snapshot.analysis_date, horizon);
      if (futureRows.length < horizon) {
        continue;
      }

      updateSupportStats(support, snapshot, futureRows);
      updateResistanceStats(resistance, snapshot, futureRows);
      updateStopLossStats(stopLoss, snapshot, futureRows);
      updateTakeProfitStats(takeProfit, snapshot, futureRows);
      updateBreakthroughStats(breakthrough, snapshot, futureRows);
      updateTradePathStats(tradePath, snapshot, futureRows, intradayByDate);
    }

    return {
      horizon,
      support,
      resistance,
      stopLoss,
      takeProfit,
      breakthrough,
      tradePath,
    };
  }
}

function createReactionStats(): ReactionStats {
  return {
    sampleCount: 0,
    touchCount: 0,
    validCount: 0,
  };
}

function createThresholdStats(): ThresholdStats {
  return {
    sampleCount: 0,
    hitCount: 0,
  };
}

function createBreakthroughStats(): BreakthroughStats {
  return {
    sampleCount: 0,
    hitCount: 0,
    confirmCount: 0,
  };
}

function createTradePathStats(): TradePathStats {
  return {
    sampleCount: 0,
    stopFirstCount: 0,
    takeProfitFirstCount: 0,
    unresolvedCount: 0,
    sameDayConflictCount: 0,
    intradayResolvedCount: 0,
    intradayMissingCount: 0,
    intradayAmbiguousCount: 0,
  };
}

function updateSupportStats(
  stats: ReactionStats,
  snapshot: KeyLevelsHistoryEntry,
  futureRows: TickFlowKlineRow[],
): void {
  if (!(snapshot.support != null && snapshot.support > 0)) {
    return;
  }

  stats.sampleCount += 1;
  const touchUpper = snapshot.support * (1 + LEVEL_BUFFER);
  const holdLower = snapshot.support * (1 - LEVEL_BUFFER);
  const touchIndex = futureRows.findIndex((row) => row.low <= touchUpper);
  if (touchIndex < 0) {
    return;
  }

  stats.touchCount += 1;
  const broken = futureRows.slice(touchIndex).some((row) => row.close < holdLower);
  if (!broken) {
    stats.validCount += 1;
  }
}

function updateResistanceStats(
  stats: ReactionStats,
  snapshot: KeyLevelsHistoryEntry,
  futureRows: TickFlowKlineRow[],
): void {
  if (!(snapshot.resistance != null && snapshot.resistance > 0)) {
    return;
  }

  stats.sampleCount += 1;
  const touchLower = snapshot.resistance * (1 - LEVEL_BUFFER);
  const holdUpper = snapshot.resistance * (1 + LEVEL_BUFFER);
  const touchIndex = futureRows.findIndex((row) => row.high >= touchLower);
  if (touchIndex < 0) {
    return;
  }

  stats.touchCount += 1;
  const broken = futureRows.slice(touchIndex).some((row) => row.close > holdUpper);
  if (!broken) {
    stats.validCount += 1;
  }
}

function updateStopLossStats(
  stats: ThresholdStats,
  snapshot: KeyLevelsHistoryEntry,
  futureRows: TickFlowKlineRow[],
): void {
  if (!(snapshot.stop_loss != null && snapshot.stop_loss > 0)) {
    return;
  }

  stats.sampleCount += 1;
  if (futureRows.some((row) => row.low <= snapshot.stop_loss!)) {
    stats.hitCount += 1;
  }
}

function updateTakeProfitStats(
  stats: ThresholdStats,
  snapshot: KeyLevelsHistoryEntry,
  futureRows: TickFlowKlineRow[],
): void {
  if (!(snapshot.take_profit != null && snapshot.take_profit > 0)) {
    return;
  }

  stats.sampleCount += 1;
  if (futureRows.some((row) => row.high >= snapshot.take_profit!)) {
    stats.hitCount += 1;
  }
}

function updateBreakthroughStats(
  stats: BreakthroughStats,
  snapshot: KeyLevelsHistoryEntry,
  futureRows: TickFlowKlineRow[],
): void {
  if (!(snapshot.breakthrough != null && snapshot.breakthrough > 0)) {
    return;
  }

  stats.sampleCount += 1;
  const touchIndex = futureRows.findIndex((row) => row.high >= snapshot.breakthrough!);
  if (touchIndex < 0) {
    return;
  }

  stats.hitCount += 1;
  const confirmed = futureRows
    .slice(touchIndex)
    .some((row) => row.close >= snapshot.breakthrough! * (1 + LEVEL_BUFFER));
  if (confirmed) {
    stats.confirmCount += 1;
  }
}

function updateTradePathStats(
  stats: TradePathStats,
  snapshot: KeyLevelsHistoryEntry,
  futureRows: TickFlowKlineRow[],
  intradayByDate: Map<string, TickFlowIntradayKlineRow[]>,
): void {
  if (!(snapshot.stop_loss != null && snapshot.stop_loss > 0)) {
    return;
  }
  if (!(snapshot.take_profit != null && snapshot.take_profit > 0)) {
    return;
  }

  stats.sampleCount += 1;
  const stopIndex = futureRows.findIndex((row) => row.low <= snapshot.stop_loss!);
  const takeProfitIndex = futureRows.findIndex((row) => row.high >= snapshot.take_profit!);

  if (stopIndex < 0 && takeProfitIndex < 0) {
    stats.unresolvedCount += 1;
    return;
  }
  if (stopIndex >= 0 && takeProfitIndex < 0) {
    stats.stopFirstCount += 1;
    return;
  }
  if (takeProfitIndex >= 0 && stopIndex < 0) {
    stats.takeProfitFirstCount += 1;
    return;
  }
  if (stopIndex < takeProfitIndex) {
    stats.stopFirstCount += 1;
    return;
  }
  if (takeProfitIndex < stopIndex) {
    stats.takeProfitFirstCount += 1;
    return;
  }

  stats.sameDayConflictCount += 1;
  const tradeDate = futureRows[stopIndex]?.trade_date;
  const resolution = resolveSameDayTradePath(
    snapshot.stop_loss,
    snapshot.take_profit,
    tradeDate ? intradayByDate.get(tradeDate) ?? [] : [],
  );
  if (resolution === "stop_first") {
    stats.stopFirstCount += 1;
    stats.intradayResolvedCount += 1;
    return;
  }
  if (resolution === "take_profit_first") {
    stats.takeProfitFirstCount += 1;
    stats.intradayResolvedCount += 1;
    return;
  }
  if (resolution === "missing_intraday") {
    stats.intradayMissingCount += 1;
    stats.unresolvedCount += 1;
    return;
  }

  stats.intradayAmbiguousCount += 1;
  stats.unresolvedCount += 1;
}

function resolveSameDayTradePath(
  stopLoss: number,
  takeProfit: number,
  intradayRows: TickFlowIntradayKlineRow[],
): "stop_first" | "take_profit_first" | "missing_intraday" | "ambiguous" {
  if (intradayRows.length === 0) {
    return "missing_intraday";
  }

  for (const row of intradayRows) {
    const hitsStop = row.low <= stopLoss;
    const hitsTakeProfit = row.high >= takeProfit;
    if (!hitsStop && !hitsTakeProfit) {
      continue;
    }
    if (hitsStop && !hitsTakeProfit) {
      return "stop_first";
    }
    if (hitsTakeProfit && !hitsStop) {
      return "take_profit_first";
    }

    if (row.open <= stopLoss) {
      return "stop_first";
    }
    if (row.open >= takeProfit) {
      return "take_profit_first";
    }
    return "ambiguous";
  }

  return "ambiguous";
}

function groupIntradayByTradeDate(rows: TickFlowIntradayKlineRow[]): Map<string, TickFlowIntradayKlineRow[]> {
  const grouped = new Map<string, TickFlowIntradayKlineRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.trade_date);
    if (list) {
      list.push(row);
      continue;
    }
    grouped.set(row.trade_date, [row]);
  }
  return grouped;
}

function getFutureRows(
  klines: TickFlowKlineRow[],
  analysisDate: string,
  horizon: Horizon,
): TickFlowKlineRow[] {
  const index = klines.findIndex((row) => row.trade_date === analysisDate);
  if (index < 0) {
    return [];
  }
  return klines.slice(index + 1, index + 1 + horizon);
}

function uniqueSymbols(snapshots: KeyLevelsHistoryEntry[]): string[] {
  return [...new Set(snapshots.map((snapshot) => snapshot.symbol))];
}

function buildConclusion(horizons: HorizonStats[]): string {
  const primary = [...horizons].reverse().find((item) => hasSamples(item));
  if (!primary) {
    return "💡 结论: 历史样本不足，先持续积累收盘后活动价位快照，再观察是否需要调整刷新频率。";
  }

  const supportHold = ratio(primary.support.validCount, primary.support.touchCount);
  const resistanceHold = ratio(primary.resistance.validCount, primary.resistance.touchCount);
  const touchAverage = average([
    ratio(primary.support.touchCount, primary.support.sampleCount),
    ratio(primary.resistance.touchCount, primary.resistance.sampleCount),
  ]);
  const holdAverage = average([supportHold, resistanceHold]);
  const stopHit = ratio(primary.stopLoss.hitCount, primary.stopLoss.sampleCount);
  const takeProfitHit = ratio(primary.takeProfit.hitCount, primary.takeProfit.sampleCount);
  const stopFirst = ratio(primary.tradePath.stopFirstCount, primary.tradePath.sampleCount);
  const takeProfitFirst = ratio(primary.tradePath.takeProfitFirstCount, primary.tradePath.sampleCount);
  const breakthroughConfirm = ratio(primary.breakthrough.confirmCount, primary.breakthrough.hitCount);
  const intradayResolved = ratio(primary.tradePath.intradayResolvedCount, primary.tradePath.sameDayConflictCount);
  const intradayMissing = ratio(primary.tradePath.intradayMissingCount, primary.tradePath.sameDayConflictCount);
  const parts: string[] = [];

  if (countSamples(primary) < 12) {
    parts.push("当前可评估样本仍偏少，结论只可作方向参考");
  }

  if (holdAverage != null && holdAverage >= 0.65) {
    parts.push("支撑压力整体稳定，维持收盘后日更刷新即可，无需盘中频繁重算");
  } else if (holdAverage != null && holdAverage >= 0.45) {
    parts.push("支撑压力有效性中性，建议继续日更刷新，并在临近触达时手动复核");
  } else if (holdAverage != null) {
    parts.push("支撑压力失效偏快，建议缩短有效期，并在波动日额外复核");
  }

  if (touchAverage != null && touchAverage < 0.2) {
    parts.push("支撑压力触达率偏低，说明部分关键位可能离现价偏远，可适度收窄区间");
  }

  if (supportHold != null && resistanceHold != null) {
    if (supportHold >= resistanceHold + 0.15) {
      parts.push("下沿支撑的稳定性明显强于上沿压力");
    } else if (resistanceHold >= supportHold + 0.15) {
      parts.push("上沿压力的压制性明显强于下沿支撑");
    }
  }

  if (takeProfitFirst != null && stopFirst != null) {
    if (takeProfitFirst >= stopFirst + 0.15) {
      parts.push("双目标样本里止盈先到明显多于止损先到，盈亏比结构偏正");
    } else if (stopFirst >= takeProfitFirst + 0.15) {
      parts.push("双目标样本里止损先到偏多，当前活动价位的风险收益结构偏弱");
    }
  }

  if (takeProfitHit != null && stopHit != null) {
    if (takeProfitHit >= stopHit + 0.15) {
      parts.push("止盈触发率高于止损触发率，关键价位具备一定兑现能力");
    } else if (stopHit >= takeProfitHit + 0.15) {
      parts.push("止损触发率高于止盈触发率，关键价位偏保守或偏离真实波动结构");
    }
  }

  if (primary.breakthrough.hitCount > 0 && breakthroughConfirm != null) {
    if (breakthroughConfirm >= 0.6) {
      parts.push("突破位在被触发后具备较高确认率");
    } else if (breakthroughConfirm < 0.35) {
      parts.push("突破位经常被试探但确认率偏低，需警惕假突破");
    }
  }

  if (primary.tradePath.sameDayConflictCount > 0 && intradayResolved != null && intradayResolved < 0.5) {
    parts.push("同日双触发样本里，分钟线可判定比例仍偏低，路径结论置信度一般");
  }

  if (primary.tradePath.sameDayConflictCount > 0 && intradayMissing != null && intradayMissing >= 0.35) {
    parts.push("历史分钟线覆盖仍有缺口，部分同日双触发样本只能保留为未决");
  }

  return `💡 结论: ${parts.join("；") || "当前回测统计没有形成明显倾向，先按收盘后日更节奏持续观察。"}`;
}

function hasSamples(stats: HorizonStats): boolean {
  return countSamples(stats) > 0;
}

function countSamples(stats: HorizonStats): number {
  return (
    stats.support.sampleCount +
    stats.resistance.sampleCount +
    stats.stopLoss.sampleCount +
    stats.takeProfit.sampleCount +
    stats.breakthrough.sampleCount +
    stats.tradePath.sampleCount
  );
}

function ratio(numerator: number, denominator: number): number | null {
  if (!(denominator > 0)) {
    return null;
  }
  return numerator / denominator;
}

function average(values: Array<number | null>): number | null {
  const normalized = values.filter((value): value is number => value != null);
  if (normalized.length === 0) {
    return null;
  }
  return normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
}

function formatRate(numerator: number, denominator: number): string {
  if (!(denominator > 0)) {
    return "样本不足";
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function formatMaybePrice(value: number | null | undefined): string {
  return value == null ? "-" : value.toFixed(2);
}

function formatMaybeInt(value: number | null | undefined): string {
  return value == null ? "-" : String(Math.trunc(value));
}
