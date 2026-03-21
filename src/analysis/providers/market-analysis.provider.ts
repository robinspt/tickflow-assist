import type { IndicatorRow } from "../../types/indicator.js";
import type { TickFlowIntradayKlineRow } from "../../types/tickflow.js";
import { DEFAULT_MARKET_INDEXES } from "../../constants/market-indexes.js";
import {
  formatTickflowApiKeyLevel,
  supportsIntradayKlines,
  type TickflowApiKeyLevel,
} from "../../config/tickflow-access.js";
import { WatchlistService } from "../../services/watchlist-service.js";
import { KlineService } from "../../services/kline-service.js";
import { QuoteService } from "../../services/quote-service.js";
import { IndicatorService } from "../../services/indicator-service.js";
import { ReviewMemoryService } from "../../services/review-memory-service.js";
import { TradingCalendarService } from "../../services/trading-calendar-service.js";
import { KlinesRepository } from "../../storage/repositories/klines-repo.js";
import { IntradayKlinesRepository } from "../../storage/repositories/intraday-klines-repo.js";
import { IndicatorsRepository } from "../../storage/repositories/indicators-repo.js";
import type {
  MarketAnalysisContext,
  MarketBias,
  MarketIndexSnapshot,
  MarketOverviewContext,
} from "../types/composite-analysis.js";

const ANALYZE_INTRADAY_PERIOD = "1m";
const ANALYZE_INTRADAY_RETENTION_DAYS = 30;

export class MarketAnalysisProvider {
  constructor(
    private readonly tickflowApiKeyLevel: TickflowApiKeyLevel,
    private readonly watchlistService: WatchlistService,
    private readonly klineService: KlineService,
    private readonly quoteService: QuoteService,
    private readonly indicatorService: IndicatorService,
    private readonly reviewMemoryService: ReviewMemoryService,
    private readonly tradingCalendarService: TradingCalendarService,
    private readonly klinesRepository: KlinesRepository,
    private readonly intradayKlinesRepository: IntradayKlinesRepository,
    private readonly indicatorsRepository: IndicatorsRepository,
  ) {}

  async load(symbol: string): Promise<MarketAnalysisContext> {
    const [watchlistItem, klines, indicators, quotes, reviewMemory, marketOverview] = await Promise.all([
      this.watchlistService.getBySymbol(symbol, { refreshConceptBoards: true }),
      this.klinesRepository.listBySymbol(symbol),
      this.indicatorsRepository.listBySymbol(symbol),
      this.quoteService.fetchQuotes([symbol]),
      this.reviewMemoryService.getSymbolContext(symbol),
      this.loadMarketOverview(),
    ]);

    let intradayKlines: TickFlowIntradayKlineRow[] = [];
    let intradayIndicators: IndicatorRow[] = [];
    if (supportsIntradayKlines(this.tickflowApiKeyLevel)) {
      try {
        intradayKlines = await this.klineService.fetchIntradayKlines(symbol, {
          period: ANALYZE_INTRADAY_PERIOD,
        });
        if (intradayKlines.length > 0) {
          await this.intradayKlinesRepository.saveAll(symbol, ANALYZE_INTRADAY_PERIOD, intradayKlines);
          const keepTradeDates = await this.tradingCalendarService.getRecentTradingDays(
            ANALYZE_INTRADAY_RETENTION_DAYS,
            new Date(intradayKlines[intradayKlines.length - 1].timestamp),
          );
          await this.intradayKlinesRepository.pruneToTradeDates(
            symbol,
            ANALYZE_INTRADAY_PERIOD,
            keepTradeDates,
          );
          intradayIndicators = await this.indicatorService.calculate(intradayKlines);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[analyze] intraday fetch skipped for ${symbol} (${formatTickflowApiKeyLevel(this.tickflowApiKeyLevel)}): ${message}`,
        );
      }
    }

    return {
      symbol,
      companyName: watchlistItem?.name || symbol,
      watchlistItem,
      klines,
      indicators,
      intradayKlines,
      intradayIndicators,
      realtimeQuote: quotes[0] ?? null,
      reviewMemory,
      marketOverview,
    };
  }

  private async loadMarketOverview(): Promise<MarketOverviewContext> {
    const snapshots = (await Promise.all(DEFAULT_MARKET_INDEXES.map((spec) => this.loadIndexSnapshot(spec)))).filter(
      (item): item is MarketIndexSnapshot => item != null,
    );

    if (snapshots.length === 0) {
      return {
        available: false,
        bias: "neutral",
        summary: "未获取到上证指数/深证成指数据，本轮无法判断大盘顺风还是逆风。",
        indices: [],
      };
    }

    const bias = deriveMarketBias(snapshots);
    const summary = [
      ...snapshots.map((snapshot) => snapshot.summary),
      `市场风格: ${formatMarketBiasLabel(bias)}`,
    ].join("；");

    return {
      available: true,
      bias,
      summary,
      indices: snapshots,
    };
  }

  private async loadIndexSnapshot(spec: { symbol: string; name: string }): Promise<MarketIndexSnapshot | null> {
    const [klines, indicators, intradayRows] = await Promise.all([
      this.klinesRepository.listBySymbol(spec.symbol),
      this.indicatorsRepository.listBySymbol(spec.symbol),
      this.intradayKlinesRepository.listBySymbol(spec.symbol, ANALYZE_INTRADAY_PERIOD),
    ]);

    const latest = klines[klines.length - 1];
    if (!latest) {
      return null;
    }

    const prevClose = latest.prev_close > 0 ? latest.prev_close : (klines[klines.length - 2]?.close ?? null);
    const latestIndicator = indicators[indicators.length - 1] ?? null;
    const changePct = prevClose != null && prevClose > 0
      ? ((latest.close - prevClose) / prevClose) * 100
      : null;
    const snapshot: MarketIndexSnapshot = {
      symbol: spec.symbol,
      name: spec.name,
      latestClose: latest.close,
      prevClose,
      changePct,
      intradayClose: intradayRows[intradayRows.length - 1]?.close ?? null,
      aboveMa5: isAbove(latest.close, latestIndicator?.ma5),
      aboveMa10: isAbove(latest.close, latestIndicator?.ma10),
      summary: "",
    };

    snapshot.summary = buildIndexSummary(snapshot);
    return snapshot;
  }
}

function isAbove(price: number, reference: number | null | undefined): boolean | null {
  if (!(reference != null && Number.isFinite(reference))) {
    return null;
  }
  return price >= reference;
}

function buildIndexSummary(snapshot: MarketIndexSnapshot): string {
  const parts = [`${snapshot.name} ${formatMaybePrice(snapshot.latestClose)}`];
  if (snapshot.changePct != null) {
    parts.push(`${snapshot.changePct >= 0 ? "+" : ""}${snapshot.changePct.toFixed(2)}%`);
  }

  if (snapshot.aboveMa5 === true && snapshot.aboveMa10 === true) {
    parts.push("站上 MA5/MA10");
  } else if (snapshot.aboveMa5 === true) {
    parts.push("站上 MA5");
  } else if (snapshot.aboveMa10 === false) {
    parts.push("位于 MA10 下方");
  }

  return parts.join(" | ");
}

function deriveMarketBias(snapshots: MarketIndexSnapshot[]): MarketBias {
  let score = 0;
  for (const snapshot of snapshots) {
    if (snapshot.changePct != null) {
      if (snapshot.changePct >= 0.6) {
        score += 2;
      } else if (snapshot.changePct > 0) {
        score += 1;
      } else if (snapshot.changePct <= -0.6) {
        score -= 2;
      } else if (snapshot.changePct < 0) {
        score -= 1;
      }
    }

    if (snapshot.aboveMa5 === true) {
      score += 1;
    } else if (snapshot.aboveMa5 === false) {
      score -= 1;
    }
  }

  if (score >= 3) {
    return "tailwind";
  }
  if (score <= -3) {
    return "headwind";
  }
  return "neutral";
}

function formatMarketBiasLabel(bias: MarketBias): string {
  switch (bias) {
    case "tailwind":
      return "大盘偏顺风";
    case "headwind":
      return "大盘偏逆风";
    default:
      return "大盘中性";
  }
}

function formatMaybePrice(value: number | null | undefined): string {
  return value == null ? "-" : value.toFixed(2);
}
