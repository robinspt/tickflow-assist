import type { KeyLevels } from "../../types/domain.js";
import {
  ANALYSIS_COMMON_SYSTEM_PROMPT,
  buildKlineAnalysisUserPrompt,
} from "../../prompts/analysis/index.js";
import { formatChinaDateTime } from "../../utils/china-time.js";
import { parseKeyLevels, validateKeyLevels } from "../parsers/key-levels.parser.js";
import type { AnalysisStepTask } from "./analysis-step-task.js";
import type { MarketAnalysisContext, TechnicalSignalResult } from "../types/composite-analysis.js";

export class KlineTechnicalSignalTask
  implements AnalysisStepTask<MarketAnalysisContext, TechnicalSignalResult>
{
  readonly taskName = "kline_technical_signal";

  prepare(input: MarketAnalysisContext): { systemPrompt: string; userPrompt: string } {
    if (input.klines.length === 0) {
      throw new Error(`没有找到 ${input.symbol} 的K线数据，请先执行 fetch-klines`);
    }
    if (input.indicators.length === 0) {
      throw new Error(`没有找到 ${input.symbol} 的指标数据，请先执行 fetch-klines`);
    }

    return {
      systemPrompt: ANALYSIS_COMMON_SYSTEM_PROMPT,
      userPrompt: buildKlineAnalysisUserPrompt({
        symbol: input.symbol,
        costPrice: input.watchlistItem?.costPrice ?? 0,
        klines: input.klines,
        indicators: input.indicators,
        intradayKlines: input.intradayKlines,
        intradayIndicators: input.intradayIndicators,
        realtimeQuote: input.realtimeQuote,
        reviewMemory: input.reviewMemory,
      }),
    };
  }

  parseResult(analysisText: string, input: MarketAnalysisContext): TechnicalSignalResult {
    const parsed = parseKeyLevels(analysisText);
    if (!parsed) {
      return { analysisText, levels: null };
    }

    const levels: KeyLevels = {
      ...parsed,
      symbol: input.symbol,
      analysis_date: formatChinaDateTime().slice(0, 10),
      analysis_text: analysisText,
    };
    validateKeyLevels(levels);
    return { analysisText, levels };
  }
}
