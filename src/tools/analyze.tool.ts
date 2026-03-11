import { AnalysisService } from "../services/analysis-service.js";
import { WatchlistService } from "../services/watchlist-service.js";
import { KlinesRepository } from "../storage/repositories/klines-repo.js";
import { IndicatorsRepository } from "../storage/repositories/indicators-repo.js";
import { normalizeSymbol } from "../utils/symbol.js";

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
  watchlistService: WatchlistService,
  klinesRepository: KlinesRepository,
  indicatorsRepository: IndicatorsRepository,
) {
  return {
    name: "analyze",
    description: "Run LLM analysis on stored K-lines and indicators.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      const symbol = normalizeSymbol(parseSymbol(rawInput));
      const [watchlistItem, klines, indicators] = await Promise.all([
        watchlistService.getBySymbol(symbol),
        klinesRepository.listBySymbol(symbol),
        indicatorsRepository.listBySymbol(symbol),
      ]);
      const result = await analysisService.analyze({
        symbol,
        watchlistItem,
        klines,
        indicators,
      });
      return analysisService.formatAnalysisForUser(result.analysisText, result.levels);
    },
  };
}
