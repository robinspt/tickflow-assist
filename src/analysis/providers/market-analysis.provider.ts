import type { IndicatorRow } from "../../types/indicator.js";
import type { TickFlowIntradayKlineRow } from "../../types/tickflow.js";
import {
  formatTickflowApiKeyLevel,
  supportsIntradayKlines,
  type TickflowApiKeyLevel,
} from "../../config/tickflow-access.js";
import { WatchlistService } from "../../services/watchlist-service.js";
import { KlineService } from "../../services/kline-service.js";
import { QuoteService } from "../../services/quote-service.js";
import { IndicatorService } from "../../services/indicator-service.js";
import { TradingCalendarService } from "../../services/trading-calendar-service.js";
import { KlinesRepository } from "../../storage/repositories/klines-repo.js";
import { IntradayKlinesRepository } from "../../storage/repositories/intraday-klines-repo.js";
import { IndicatorsRepository } from "../../storage/repositories/indicators-repo.js";
import type { MarketAnalysisContext } from "../types/composite-analysis.js";

const ANALYZE_INTRADAY_PERIOD = "1m";
const ANALYZE_INTRADAY_RETENTION_DAYS = 10;

export class MarketAnalysisProvider {
  constructor(
    private readonly tickflowApiKeyLevel: TickflowApiKeyLevel,
    private readonly watchlistService: WatchlistService,
    private readonly klineService: KlineService,
    private readonly quoteService: QuoteService,
    private readonly indicatorService: IndicatorService,
    private readonly tradingCalendarService: TradingCalendarService,
    private readonly klinesRepository: KlinesRepository,
    private readonly intradayKlinesRepository: IntradayKlinesRepository,
    private readonly indicatorsRepository: IndicatorsRepository,
  ) {}

  async load(symbol: string): Promise<MarketAnalysisContext> {
    const [watchlistItem, klines, indicators, quotes] = await Promise.all([
      this.watchlistService.getBySymbol(symbol),
      this.klinesRepository.listBySymbol(symbol),
      this.indicatorsRepository.listBySymbol(symbol),
      this.quoteService.fetchQuotes([symbol]),
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
    };
  }
}
