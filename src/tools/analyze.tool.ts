import { AnalysisService } from "../services/analysis-service.js";
import { KlineTechnicalAnalysisTask } from "../analysis/tasks/kline-technical.task.js";
import { WatchlistService } from "../services/watchlist-service.js";
import { KlineService } from "../services/kline-service.js";
import { QuoteService } from "../services/quote-service.js";
import { IndicatorService } from "../services/indicator-service.js";
import { TradingCalendarService } from "../services/trading-calendar-service.js";
import { KlinesRepository } from "../storage/repositories/klines-repo.js";
import { IntradayKlinesRepository } from "../storage/repositories/intraday-klines-repo.js";
import { IndicatorsRepository } from "../storage/repositories/indicators-repo.js";
import { normalizeSymbol } from "../utils/symbol.js";

const ANALYZE_INTRADAY_PERIOD = "1m";
const ANALYZE_INTRADAY_RETENTION_DAYS = 10;

function parseSymbol(rawInput: unknown): string {
  if (typeof rawInput === "string" && rawInput.trim()) {
    return rawInput.trim();
  }
  if (typeof rawInput === "object" && rawInput !== null) {
    const symbol = String((rawInput as Record<string, unknown>).symbol ?? "").trim();
    if (symbol) {
      return symbol;
    }
  }
  throw new Error("analyze requires a symbol");
}

export function analyzeTool(
  analysisService: AnalysisService,
  klineTechnicalAnalysisTask: KlineTechnicalAnalysisTask,
  watchlistService: WatchlistService,
  klineService: KlineService,
  quoteService: QuoteService,
  indicatorService: IndicatorService,
  tradingCalendarService: TradingCalendarService,
  klinesRepository: KlinesRepository,
  intradayKlinesRepository: IntradayKlinesRepository,
  indicatorsRepository: IndicatorsRepository,
) {
  return {
    name: "analyze",
    description: "Run LLM analysis using stored daily data plus fresh intraday K-lines and realtime quotes.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      const symbol = normalizeSymbol(parseSymbol(rawInput));
      const [watchlistItem, klines, indicators, quotes, intradayKlines] = await Promise.all([
        watchlistService.getBySymbol(symbol),
        klinesRepository.listBySymbol(symbol),
        indicatorsRepository.listBySymbol(symbol),
        quoteService.fetchQuotes([symbol]),
        klineService.fetchIntradayKlines(symbol, {
          period: ANALYZE_INTRADAY_PERIOD,
        }),
      ]);
      if (intradayKlines.length > 0) {
        await intradayKlinesRepository.saveAll(symbol, ANALYZE_INTRADAY_PERIOD, intradayKlines);
        const keepTradeDates = await tradingCalendarService.getRecentTradingDays(
          ANALYZE_INTRADAY_RETENTION_DAYS,
          new Date(intradayKlines[intradayKlines.length - 1].timestamp),
        );
        await intradayKlinesRepository.pruneToTradeDates(
          symbol,
          ANALYZE_INTRADAY_PERIOD,
          keepTradeDates,
        );
      }

      const intradayIndicators =
        intradayKlines.length > 0 ? await indicatorService.calculate(intradayKlines) : [];

      const result = await analysisService.runTask(klineTechnicalAnalysisTask, {
        symbol,
        watchlistItem,
        klines,
        indicators,
        intradayKlines,
        intradayIndicators,
        realtimeQuote: quotes[0] ?? null,
      });
      return klineTechnicalAnalysisTask.formatForUser(result);
    },
  };
}
