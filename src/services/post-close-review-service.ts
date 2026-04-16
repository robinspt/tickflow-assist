import type { KeyLevelsHistoryEntry, WatchlistItem } from "../types/domain.js";
import { formatChinaDateTime } from "../utils/china-time.js";
import { CompositeAnalysisOrchestrator } from "../analysis/orchestrators/composite-analysis.orchestrator.js";
import type {
  CompositeAnalysisResult,
  FlashNewsContext,
  FlashNewsItem,
  IndustryPeerContext,
  MarketOverviewContext,
  PostCloseReviewResult,
  PriorKeyLevelValidationContext,
} from "../analysis/types/composite-analysis.js";
import { PostCloseReviewTask } from "../analysis/tasks/post-close-review.task.js";
import { WatchlistService } from "./watchlist-service.js";
import { AnalysisService } from "./analysis-service.js";
import { KeyLevelsRepository } from "../storage/repositories/key-levels-repo.js";
import { KeyLevelsHistoryRepository } from "../storage/repositories/key-levels-history-repo.js";
import { KlinesRepository } from "../storage/repositories/klines-repo.js";
import { IntradayKlinesRepository } from "../storage/repositories/intraday-klines-repo.js";
import { Jin10FlashDeliveryRepository } from "../storage/repositories/jin10-flash-delivery-repo.js";
import { Jin10FlashRepository } from "../storage/repositories/jin10-flash-repo.js";
import { IndustryPeerService } from "./industry-peer-service.js";
import type { TickFlowKlineRow, TickFlowQuote } from "../types/tickflow.js";
import { formatCostPrice } from "../utils/cost-price.js";
import { normalizeTickFlowChangePct, resolveTickFlowKlineChangePct } from "../utils/tickflow-quote.js";

const LEVEL_BUFFER = 0.005;
const INTRADAY_PERIOD = "1m";

const MARKET_OVERVIEW_FLASH_KEYWORDS = [
  "港股收评",
  "金十数据整理：每日投行/机构观点梳理",
  "金十数据整理：A股每日市场要闻回顾",
];

interface ReviewSuccessEntry {
  ok: true;
  item: WatchlistItem;
  validation: PriorKeyLevelValidationContext;
  review: PostCloseReviewResult;
}

interface ReviewFailureEntry {
  ok: false;
  item: WatchlistItem;
  errorMessage: string;
}

type ReviewEntry = ReviewSuccessEntry | ReviewFailureEntry;

interface ReviewMarketSummary {
  latestClose: number | null;
  dailyChangePct: number | null;
}

export interface PostCloseReviewRunResult {
  overviewMessage: string;
  detailMessages: string[];
  combinedText: string;
}

export class PostCloseReviewService {
  constructor(
    private readonly watchlistService: WatchlistService,
    private readonly compositeAnalysisOrchestrator: CompositeAnalysisOrchestrator,
    private readonly analysisService: AnalysisService,
    private readonly postCloseReviewTask: PostCloseReviewTask,
    private readonly keyLevelsRepository: KeyLevelsRepository,
    private readonly keyLevelsHistoryRepository: KeyLevelsHistoryRepository,
    private readonly klinesRepository: KlinesRepository,
    private readonly intradayKlinesRepository: IntradayKlinesRepository,
    private readonly flashDeliveryRepository: Jin10FlashDeliveryRepository,
    private readonly flashRepository: Jin10FlashRepository,
    private readonly industryPeerService: IndustryPeerService,
  ) {}

  async run(): Promise<PostCloseReviewRunResult> {
    const watchlist = await this.watchlistService.list();
    if (watchlist.length === 0) {
      const overviewMessage = "🧭 收盘复盘总览\n\n关注列表为空，已跳过收盘复盘。";
      return {
        overviewMessage,
        detailMessages: [],
        combinedText: overviewMessage,
      };
    }

    const entries: ReviewEntry[] = [];
    const detailMessages: string[] = [];
    let marketOverview: MarketOverviewContext | null = null;

    for (const item of watchlist) {
      let compositeResult: CompositeAnalysisResult | null = null;
      let marketSummary: ReviewMarketSummary | null = null;
      try {
        const input = await this.compositeAnalysisOrchestrator.buildInput(item.symbol);
        marketSummary = buildReviewMarketSummary(input.market.klines, input.market.realtimeQuote);
        marketOverview ??= input.market.marketOverview;
        const tradeDate = input.market.klines[input.market.klines.length - 1]?.trade_date ?? formatChinaDateTime().slice(0, 10);
        const validation = await this.buildValidationContext(item.symbol, tradeDate);
        const peerContext = await this.industryPeerService.buildContext(item.symbol)
          .catch((error) => ({
            available: false,
            summary: "未获取到申万三级同业表现。",
            sw1Name: null,
            sw2Name: null,
            sw3Name: null,
            sw3UniverseId: null,
            peerCount: 0,
            otherStockCount: 0,
            advanceCount: 0,
            declineCount: 0,
            flatCount: 0,
            averageChangePct: null,
            medianChangePct: null,
            targetChangePct: null,
            targetRank: null,
            targetPercentile: null,
            leaders: [],
            laggards: [],
            note: error instanceof Error ? error.message : String(error),
          }));

        compositeResult = await this.compositeAnalysisOrchestrator.analyzeInput(input);
        const flashContext = await this.buildFlashContext(item.symbol, tradeDate);
        const review = await this.analysisService.runTask(this.postCloseReviewTask, {
          ...input,
          compositeResult,
          validation,
          flashContext,
          peerContext,
        });
        const message = this.formatDetailMessage(item, validation, review, marketSummary, peerContext);
        await this.persistReview(item.symbol, message, review);

        entries.push({
          ok: true,
          item,
          validation,
          review,
        });
        detailMessages.push(message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (compositeResult?.levels) {
          await this.persistFallbackCompositeReview(item.symbol, compositeResult);
        }
        entries.push({ ok: false, item, errorMessage: message });
        detailMessages.push(this.formatFailureMessage(item, message, compositeResult, marketSummary));
      }
    }

    const overviewMessage = this.formatOverviewMessage(marketOverview, entries);
    return {
      overviewMessage,
      detailMessages,
      combinedText: [overviewMessage, ...detailMessages].join("\n\n"),
    };
  }

  private async persistReview(symbol: string, message: string, review: PostCloseReviewResult): Promise<void> {
    if (review.decision === "invalidate" || !review.levels) {
      await this.keyLevelsRepository.remove(symbol);
      return;
    }

    const levels = {
      ...review.levels,
      analysis_text: message,
    };
    await this.keyLevelsRepository.save(symbol, levels);
    await this.keyLevelsHistoryRepository.saveDailySnapshot(
      toHistoryEntry(symbol, message, levels),
    );
  }

  private async persistFallbackCompositeReview(symbol: string, result: CompositeAnalysisResult): Promise<void> {
    if (!result.levels) {
      return;
    }

    await this.keyLevelsHistoryRepository.saveDailySnapshot(
      toHistoryEntry(symbol, result.analysisText, result.levels),
    );
  }

  private async buildValidationContext(symbol: string, tradeDate: string): Promise<PriorKeyLevelValidationContext> {
    const snapshots = await this.keyLevelsHistoryRepository.listBySymbol(symbol);
    const snapshot = snapshots.find((item) => item.analysis_date < tradeDate) ?? null;
    if (!snapshot) {
      return {
        available: false,
        snapshotDate: null,
        evaluatedTradeDate: tradeDate,
        verdict: "unavailable",
        snapshot: null,
        summary: "昨日无可验证的活动关键位快照，本轮只能基于今日数据直接重算。",
        lines: ["暂无昨日活动关键位快照。"],
      };
    }

    const dailyRows = await this.klinesRepository.listBySymbol(symbol);
    const row = dailyRows.find((item) => item.trade_date === tradeDate)
      ?? dailyRows.find((item) => item.trade_date > snapshot.analysis_date)
      ?? null;
    if (!row) {
      return {
        available: false,
        snapshotDate: snapshot.analysis_date,
        evaluatedTradeDate: null,
        verdict: "unavailable",
        snapshot,
        summary: `已找到 ${snapshot.analysis_date} 的关键位快照，但尚无后续交易日数据可供验证。`,
        lines: ["缺少后续交易日数据。"],
      };
    }

    const intradayRows = (await this.intradayKlinesRepository.listBySymbol(symbol, INTRADAY_PERIOD))
      .filter((item) => item.trade_date === row.trade_date);

    const support = evaluateSupport(snapshot, row);
    const resistance = evaluateResistance(snapshot, row);
    const stopLoss = evaluateStopLoss(snapshot, row);
    const takeProfit = evaluateTakeProfit(snapshot, row);
    const breakthrough = evaluateBreakthrough(snapshot, row);
    const path = evaluatePath(snapshot, row, intradayRows);

    const verdict = deriveValidationVerdict({
      support,
      stopLoss,
      takeProfit,
      breakthrough,
      path,
    });

    const lines = [
      `快照日期 ${snapshot.analysis_date}，验证交易日 ${row.trade_date}。`,
      `当日K线: 高 ${row.high.toFixed(2)} | 低 ${row.low.toFixed(2)} | 收 ${row.close.toFixed(2)}`,
      support,
      resistance,
      stopLoss,
      takeProfit,
      breakthrough,
      path,
    ];

    return {
      available: true,
      snapshotDate: snapshot.analysis_date,
      evaluatedTradeDate: row.trade_date,
      verdict,
      snapshot,
      summary: `昨日关键位${formatValidationVerdictLabel(verdict)}。`,
      lines,
    };
  }

  private async buildFlashContext(symbol: string, datePrefix: string): Promise<FlashNewsContext> {
    const [deliveries, overviewFlashes] = await Promise.all([
      this.flashDeliveryRepository.listBySymbolsAndDate([symbol], datePrefix),
      this.flashRepository.searchByContentKeywords(MARKET_OVERVIEW_FLASH_KEYWORDS, datePrefix),
    ]);

    const stockAlerts: FlashNewsItem[] = deliveries.map((entry) => ({
      publishedAt: entry.published_at,
      content: entry.reason,
      headline: entry.headline,
      source: "stock_alert" as const,
    }));

    const marketOverviewFlashes: FlashNewsItem[] = overviewFlashes.map((record) => ({
      publishedAt: record.published_at,
      content: record.content,
      headline: extractHeadlineFromContent(record.content),
      source: "market_overview" as const,
    }));

    return { stockAlerts, marketOverviewFlashes };
  }

  private formatOverviewMessage(
    marketOverview: MarketOverviewContext | null,
    entries: ReviewEntry[],
  ): string {
    const successEntries = entries.filter((entry): entry is ReviewSuccessEntry => entry.ok);
    const failureCount = entries.length - successEntries.length;
    const validationCounts = countBy(successEntries.map((entry) => entry.validation.verdict));
    const decisionCounts = countBy(successEntries.map((entry) => entry.review.decision));
    const marketBiasCounts = countBy(successEntries.map((entry) => entry.review.marketBias));
    const sectorBiasCounts = countBy(successEntries.map((entry) => entry.review.sectorBias));
    const newsImpactCounts = countBy(successEntries.map((entry) => entry.review.newsImpact));

    const lines = [
      formatSectionTitle("🌐", "市场总览"),
      marketOverview?.summary ?? "未获取到大盘总览，本轮仅输出个股复盘。",
      "",
      formatSectionTitle("📊", "本轮统计"),
      "",
      `复盘数量: ${entries.length} 只 | 成功 ${successEntries.length} | 失败 ${failureCount}`,
      `关键位验证: 有效 ${validationCounts.validated ?? 0} | 混合 ${validationCounts.mixed ?? 0} | 失效 ${validationCounts.invalidated ?? 0} | 缺样本 ${validationCounts.unavailable ?? 0}`,
      `明日处理: 沿用 ${decisionCounts.keep ?? 0} | 微调 ${decisionCounts.adjust ?? 0} | 重算 ${decisionCounts.recompute ?? 0} | 暂停 ${decisionCounts.invalidate ?? 0}`,
      `大盘风向: 顺风 ${marketBiasCounts.tailwind ?? 0} | 中性 ${marketBiasCounts.neutral ?? 0} | 逆风 ${marketBiasCounts.headwind ?? 0}`,
      `板块风向: 顺风 ${sectorBiasCounts.tailwind ?? 0} | 中性 ${sectorBiasCounts.neutral ?? 0} | 逆风 ${sectorBiasCounts.headwind ?? 0}`,
      `新闻影响: 支持 ${newsImpactCounts.supportive ?? 0} | 中性 ${newsImpactCounts.neutral ?? 0} | 扰动 ${newsImpactCounts.disruptive ?? 0}`,
    ];

    return `**🧭 收盘复盘总览**\n\n${lines.join("\n")}`.trim();
  }

  private formatDetailMessage(
    item: WatchlistItem,
    validation: PriorKeyLevelValidationContext,
    review: PostCloseReviewResult,
    marketSummary: ReviewMarketSummary | null,
    peerContext: IndustryPeerContext | null = null,
  ): string {
    return formatPostCloseReviewDetailMessage(item, validation, review, marketSummary, peerContext);
  }

  private formatFailureMessage(
    item: WatchlistItem,
    errorMessage: string,
    compositeResult: CompositeAnalysisResult | null,
    marketSummary: ReviewMarketSummary | null,
  ): string {
    return formatPostCloseReviewFailureMessage(item, errorMessage, compositeResult, marketSummary);
  }
}

export function formatPostCloseReviewDetailMessage(
  item: WatchlistItem,
  validation: PriorKeyLevelValidationContext,
  review: PostCloseReviewResult,
  marketSummary: ReviewMarketSummary | null = null,
  peerContext: IndustryPeerContext | null = null,
): string {
  const marketMeta = formatReviewMarketMeta(item, marketSummary);
  const industryPosition = formatIndustryPosition(peerContext);
  const lines = [
    `**📘 收盘复盘｜${item.name}（${item.symbol}）**`,
    `${formatValidationVerdictBadge(validation.verdict)} 昨日验证：${formatValidationVerdictLabel(validation.verdict)} | ${formatDecisionBadge(review.decision)} 明日处理：${formatDecisionLabel(review.decision)}`,
    ...(marketMeta ? [marketMeta] : []),
    "",
    formatSectionTitle("📍", "昨日关键位验证"),
    `• 结论：${validation.summary}`,
    ...validation.lines.map((line) => `• ${line}`),
    "",
    formatSectionTitle("🧭", "今日盘面"),
    review.sessionSummary || "未生成盘面一句话总结。",
    "",
    formatSectionTitle("🌐", "大盘与板块"),
    [
      `• 风向：大盘 ${formatMarketBiasBadge(review.marketBias)}${formatMarketBiasLabel(review.marketBias)}`,
      `板块 ${formatMarketBiasBadge(review.sectorBias)}${formatMarketBiasLabel(review.sectorBias)}`,
      industryPosition ? `同业 ${industryPosition}` : null,
    ].filter(Boolean).join(" | "),
    review.marketSectorSummary || "未生成大盘/板块总结。",
    "",
    formatSectionTitle("📰", "新闻与公告"),
    `• 影响：${formatNewsImpactBadge(review.newsImpact)}${formatNewsImpactLabel(review.newsImpact)}`,
    review.newsSummary || "未生成新闻影响总结。",
    "",
    formatSectionTitle("🛠️", "明日关键位处理"),
    `• 结论：${formatDecisionBadge(review.decision)}${formatDecisionLabel(review.decision)}`,
    review.decisionReason || "未生成处理理由。",
    "",
    formatSectionTitle("🎯", "更新后关键位"),
  ];

  if (review.decision === "invalidate" || !review.levels) {
    lines.push(
      "• 已暂停沿用昨日关键位，等待下一轮重算。",
      "",
      formatSectionTitle("✅", "操作建议"),
      review.actionAdvice || "明日先观察，等待新的关键位再执行。",
    );
    return lines.join("\n");
  }

  const levelRail = formatPriceRail([
    { icon: "⛔", label: "止损", value: review.levels.stop_loss },
    { icon: "🛡️", label: "支撑", value: review.levels.support },
    { icon: "💹", label: "现价", value: review.levels.current_price },
    { icon: "🚧", label: "压力", value: review.levels.resistance },
    { icon: "🚀", label: "突破", value: review.levels.breakthrough },
    { icon: "🎯", label: "止盈", value: review.levels.take_profit },
  ]);

  lines.push(
    `• 支撑 ${formatMaybePrice(review.levels.support)} | 压力 ${formatMaybePrice(review.levels.resistance)} | 突破 ${formatMaybePrice(review.levels.breakthrough)}`,
    `• 止损 ${formatMaybePrice(review.levels.stop_loss)} | 止盈 ${formatMaybePrice(review.levels.take_profit)} | 评分 ${review.levels.score}/10`,
    ...(levelRail ? [`• 价位框架：${levelRail}`] : []),
    "",
    formatSectionTitle("✅", "操作建议"),
    review.actionAdvice || "按关键位和次日量价配合再决定是否执行。",
  );
  return lines.join("\n");
}

export function formatPostCloseReviewFailureMessage(
  item: WatchlistItem,
  errorMessage: string,
  compositeResult: CompositeAnalysisResult | null,
  marketSummary: ReviewMarketSummary | null = null,
): string {
  const fallback = compositeResult?.levels
    ? "已保留综合分析生成的关键位，可稍后用 view_analysis 或 analyze 复核。"
    : "本轮未生成可用关键位。";
  const marketMeta = formatReviewMarketMeta(item, marketSummary);
  return [
    `**⚠️ 收盘复盘｜${item.name}（${item.symbol}）**`,
    ...(marketMeta ? ["", marketMeta] : []),
    "",
    formatSectionTitle("❌", "失败原因"),
    errorMessage,
    "",
    formatSectionTitle("🧷", "保底处理"),
    fallback,
  ].join("\n");
}

function toHistoryEntry(
  symbol: string,
  analysisText: string,
  levels: import("../types/domain.js").KeyLevels,
): KeyLevelsHistoryEntry {
  return {
    symbol,
    analysis_date: levels.analysis_date ?? formatChinaDateTime().slice(0, 10),
    activated_at: formatChinaDateTime(),
    profile: "composite",
    current_price: levels.current_price,
    stop_loss: levels.stop_loss ?? null,
    breakthrough: levels.breakthrough ?? null,
    support: levels.support ?? null,
    cost_level: levels.cost_level ?? null,
    resistance: levels.resistance ?? null,
    take_profit: levels.take_profit ?? null,
    gap: levels.gap ?? null,
    target: levels.target ?? null,
    round_number: levels.round_number ?? null,
    analysis_text: analysisText,
    score: levels.score,
  };
}

function buildReviewMarketSummary(
  klines: TickFlowKlineRow[],
  realtimeQuote: TickFlowQuote | null,
): ReviewMarketSummary | null {
  const latestKline = klines[klines.length - 1] ?? null;
  if (!latestKline && !realtimeQuote) {
    return null;
  }

  const latestClose = latestKline?.close ?? realtimeQuote?.last_price ?? null;
  const dailyChangePct = normalizeTickFlowChangePct(realtimeQuote?.ext?.change_pct)
    ?? resolveTickFlowKlineChangePct(latestKline);

  return {
    latestClose,
    dailyChangePct,
  };
}

function formatReviewMarketMeta(item: WatchlistItem, marketSummary: ReviewMarketSummary | null): string | null {
  const parts: string[] = [];
  if (marketSummary?.latestClose != null && Number.isFinite(marketSummary.latestClose)) {
    parts.push(`• 收盘 ${marketSummary.latestClose.toFixed(2)}`);
  }
  if (marketSummary?.dailyChangePct != null && Number.isFinite(marketSummary.dailyChangePct)) {
    parts.push(`当日 ${formatSignedPct(marketSummary.dailyChangePct)}`);
  }
  if (item.costPrice != null && Number.isFinite(item.costPrice) && item.costPrice > 0) {
    parts.push(`成本 ${formatCostPrice(item.costPrice)}`);
  }
  return parts.length > 0 ? parts.join(" | ") : null;
}

function formatSignedPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatIndustryPosition(context: IndustryPeerContext | null): string | null {
  if (!context?.available || !context.targetRank || !(context.peerCount > 0)) {
    return null;
  }

  return `${classifyIndustryPosition(context)}（${context.targetRank}/${context.peerCount}）`;
}

function classifyIndustryPosition(context: IndustryPeerContext): string {
  const { targetRank, peerCount } = context;
  if (!targetRank || !(peerCount > 0)) {
    return "位置未知";
  }

  if (targetRank === 1) {
    return "领涨";
  }
  if (targetRank === peerCount) {
    return "领跌";
  }

  if (peerCount <= 3) {
    return "中游";
  }

  const percentile = context.targetPercentile
    ?? (peerCount > 1 ? 1 - ((targetRank - 1) / (peerCount - 1)) : 1);

  if (percentile >= 0.8) {
    return "领涨区";
  }
  if (percentile >= 0.6) {
    return "偏强";
  }
  if (percentile > 0.4) {
    return "中游";
  }
  if (percentile > 0.2) {
    return "偏弱";
  }
  return "领跌区";
}

function evaluateSupport(snapshot: KeyLevelsHistoryEntry, row: { low: number; close: number }): string {
  if (!(snapshot.support != null && snapshot.support > 0)) {
    return "支撑: 昨日未设置支撑位。";
  }
  const touchUpper = snapshot.support * (1 + LEVEL_BUFFER);
  const holdLower = snapshot.support * (1 - LEVEL_BUFFER);
  if (row.low > touchUpper) {
    return `支撑 ${snapshot.support.toFixed(2)}: 当日未触达。`;
  }
  if (row.close < holdLower) {
    return `支撑 ${snapshot.support.toFixed(2)}: 盘中触达后收盘失守，验证失败。`;
  }
  return `支撑 ${snapshot.support.toFixed(2)}: 盘中触达后收盘仍守住，验证有效。`;
}

function evaluateResistance(snapshot: KeyLevelsHistoryEntry, row: { high: number; close: number }): string {
  if (!(snapshot.resistance != null && snapshot.resistance > 0)) {
    return "压力: 昨日未设置压力位。";
  }
  const touchLower = snapshot.resistance * (1 - LEVEL_BUFFER);
  const holdUpper = snapshot.resistance * (1 + LEVEL_BUFFER);
  if (row.high < touchLower) {
    return `压力 ${snapshot.resistance.toFixed(2)}: 当日未触达。`;
  }
  if (row.close > holdUpper) {
    return `压力 ${snapshot.resistance.toFixed(2)}: 当日已被有效站上，原压力失效。`;
  }
  return `压力 ${snapshot.resistance.toFixed(2)}: 盘中触达但未有效站上，压制仍在。`;
}

function evaluateStopLoss(snapshot: KeyLevelsHistoryEntry, row: { low: number }): string {
  if (!(snapshot.stop_loss != null && snapshot.stop_loss > 0)) {
    return "止损: 昨日未设置止损位。";
  }
  if (row.low <= snapshot.stop_loss) {
    return `止损 ${snapshot.stop_loss.toFixed(2)}: 已触发。`;
  }
  return `止损 ${snapshot.stop_loss.toFixed(2)}: 未触发。`;
}

function evaluateTakeProfit(snapshot: KeyLevelsHistoryEntry, row: { high: number }): string {
  if (!(snapshot.take_profit != null && snapshot.take_profit > 0)) {
    return "止盈: 昨日未设置止盈位。";
  }
  if (row.high >= snapshot.take_profit) {
    return `止盈 ${snapshot.take_profit.toFixed(2)}: 已触发。`;
  }
  return `止盈 ${snapshot.take_profit.toFixed(2)}: 未触发。`;
}

function evaluateBreakthrough(snapshot: KeyLevelsHistoryEntry, row: { high: number; close: number }): string {
  if (!(snapshot.breakthrough != null && snapshot.breakthrough > 0)) {
    return "突破: 昨日未设置突破位。";
  }
  if (row.high < snapshot.breakthrough) {
    return `突破 ${snapshot.breakthrough.toFixed(2)}: 未触发。`;
  }
  if (row.close >= snapshot.breakthrough * (1 + LEVEL_BUFFER)) {
    return `突破 ${snapshot.breakthrough.toFixed(2)}: 已触发且收盘确认。`;
  }
  return `突破 ${snapshot.breakthrough.toFixed(2)}: 盘中试探但收盘未确认。`;
}

function evaluatePath(
  snapshot: KeyLevelsHistoryEntry,
  row: { low: number; high: number },
  intradayRows: Array<{ low: number; high: number; open: number }>,
): string {
  if (!(snapshot.stop_loss != null && snapshot.stop_loss > 0 && snapshot.take_profit != null && snapshot.take_profit > 0)) {
    return "路径: 缺少双目标，无法判断先止损还是先止盈。";
  }

  const hitsStop = row.low <= snapshot.stop_loss;
  const hitsTakeProfit = row.high >= snapshot.take_profit;
  if (!hitsStop && !hitsTakeProfit) {
    return "路径: 当日未触发双目标。";
  }
  if (hitsStop && !hitsTakeProfit) {
    return `路径: 当日先到止损 ${snapshot.stop_loss.toFixed(2)}。`;
  }
  if (!hitsStop && hitsTakeProfit) {
    return `路径: 当日先到止盈 ${snapshot.take_profit.toFixed(2)}。`;
  }

  for (const intradayRow of intradayRows) {
    const intradayHitsStop = intradayRow.low <= snapshot.stop_loss;
    const intradayHitsTakeProfit = intradayRow.high >= snapshot.take_profit;
    if (!intradayHitsStop && !intradayHitsTakeProfit) {
      continue;
    }
    if (intradayHitsStop && !intradayHitsTakeProfit) {
      return `路径: 同日双触发中，分钟线判定先到止损 ${snapshot.stop_loss.toFixed(2)}。`;
    }
    if (!intradayHitsStop && intradayHitsTakeProfit) {
      return `路径: 同日双触发中，分钟线判定先到止盈 ${snapshot.take_profit.toFixed(2)}。`;
    }
    if (intradayRow.open <= snapshot.stop_loss) {
      return `路径: 同日双触发中，分钟线按开盘位置判定先到止损 ${snapshot.stop_loss.toFixed(2)}。`;
    }
    if (intradayRow.open >= snapshot.take_profit) {
      return `路径: 同日双触发中，分钟线按开盘位置判定先到止盈 ${snapshot.take_profit.toFixed(2)}。`;
    }
    return "路径: 同日双触发，但分钟线仍无法明确先后。";
  }

  return "路径: 同日双触发，但缺少有效分钟线判定先后。";
}

function deriveValidationVerdict(input: {
  support: string;
  stopLoss: string;
  takeProfit: string;
  breakthrough: string;
  path: string;
}): PriorKeyLevelValidationContext["verdict"] {
  if (
    input.support.includes("验证失败")
    || input.stopLoss.includes("已触发")
    || input.path.includes("先到止损")
  ) {
    return "invalidated";
  }

  if (
    input.takeProfit.includes("已触发")
    || input.breakthrough.includes("收盘确认")
    || input.support.includes("验证有效")
    || input.path.includes("先到止盈")
  ) {
    return "validated";
  }

  return "mixed";
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function formatDecisionLabel(value: PostCloseReviewResult["decision"]): string {
  switch (value) {
    case "keep":
      return "沿用";
    case "adjust":
      return "微调";
    case "invalidate":
      return "暂停沿用";
    default:
      return "重算";
  }
}

function formatDecisionBadge(value: PostCloseReviewResult["decision"]): string {
  switch (value) {
    case "keep":
      return "🟩";
    case "adjust":
      return "🟨";
    case "invalidate":
      return "⬛";
    default:
      return "🟥";
  }
}

function formatMarketBiasLabel(value: PostCloseReviewResult["marketBias"]): string {
  switch (value) {
    case "tailwind":
      return "顺风";
    case "headwind":
      return "逆风";
    default:
      return "中性";
  }
}

function formatMarketBiasBadge(value: PostCloseReviewResult["marketBias"]): string {
  switch (value) {
    case "tailwind":
      return "🟩";
    case "headwind":
      return "🟥";
    default:
      return "🟨";
  }
}

function formatNewsImpactLabel(value: PostCloseReviewResult["newsImpact"]): string {
  switch (value) {
    case "supportive":
      return "支持";
    case "disruptive":
      return "扰动";
    default:
      return "中性";
  }
}

function formatNewsImpactBadge(value: PostCloseReviewResult["newsImpact"]): string {
  switch (value) {
    case "supportive":
      return "🟩";
    case "disruptive":
      return "🟥";
    default:
      return "🟨";
  }
}

function formatValidationVerdictLabel(value: PriorKeyLevelValidationContext["verdict"]): string {
  switch (value) {
    case "validated":
      return "验证有效";
    case "invalidated":
      return "明显失效";
    case "mixed":
      return "效果偏混合";
    default:
      return "暂无可验证样本";
  }
}

function formatValidationVerdictBadge(value: PriorKeyLevelValidationContext["verdict"]): string {
  switch (value) {
    case "validated":
      return "🟩";
    case "invalidated":
      return "🟥";
    case "mixed":
      return "🟨";
    default:
      return "⬜";
  }
}

function formatMaybePrice(value: number | null | undefined): string {
  return value == null ? "-" : value.toFixed(2);
}

function formatSectionTitle(icon: string, title: string): string {
  return `**【${icon} ${title}】**`;
}

function formatPriceRail(
  markers: Array<{ icon: string; label: string; value: number | null | undefined }>,
): string | null {
  const merged = new Map<string, { value: number; parts: string[] }>();

  for (const marker of markers) {
    if (!(marker.value != null && Number.isFinite(marker.value) && marker.value > 0)) {
      continue;
    }

    const key = marker.value.toFixed(2);
    const part = `${marker.icon}${marker.label}`;
    const existing = merged.get(key);
    if (existing) {
      if (!existing.parts.includes(part)) {
        existing.parts.push(part);
      }
      continue;
    }

    merged.set(key, {
      value: marker.value,
      parts: [part],
    });
  }

  if (merged.size < 2) {
    return null;
  }

  return [...merged.values()]
    .sort((left, right) => left.value - right.value)
    .map((entry) => `${entry.parts.join("/")} ${entry.value.toFixed(2)}`)
    .join(" → ");
}

function extractHeadlineFromContent(content: string): string {
  const firstLine = content.split(/[\n。！!]/)[0]?.trim() ?? "";
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}...` : firstLine;
}
