import type { AnalysisLogEntry, KeyLevels, WatchlistItem } from "../../types/domain.js";
import type { IndicatorRow } from "../../types/indicator.js";
import type { TickFlowIntradayKlineRow, TickFlowKlineRow, TickFlowQuote } from "../../types/tickflow.js";
import {
  ANALYSIS_COMMON_SYSTEM_PROMPT,
  buildKlineAnalysisUserPrompt,
} from "../../prompts/analysis/index.js";
import { formatChinaDateTime } from "../../utils/china-time.js";
import { KeyLevelsRepository } from "../../storage/repositories/key-levels-repo.js";
import { AnalysisLogRepository } from "../../storage/repositories/analysis-log-repo.js";
import { AnalysisTask } from "./analysis-task.js";
import {
  formatKeyLevelsAnalysis,
  parseKeyLevels,
  validateKeyLevels,
} from "../parsers/key-levels.parser.js";

export interface KlineTechnicalAnalysisInput {
  symbol: string;
  watchlistItem: WatchlistItem | null;
  klines: TickFlowKlineRow[];
  indicators: IndicatorRow[];
  intradayKlines: TickFlowIntradayKlineRow[];
  intradayIndicators: IndicatorRow[];
  realtimeQuote: TickFlowQuote | null;
}

export interface KlineTechnicalAnalysisResult {
  analysisText: string;
  levels: KeyLevels | null;
}

export class KlineTechnicalAnalysisTask
  implements AnalysisTask<KlineTechnicalAnalysisInput, KlineTechnicalAnalysisResult>
{
  readonly taskName = "kline_technical";

  constructor(
    private readonly keyLevelsRepository: KeyLevelsRepository,
    private readonly analysisLogRepository: AnalysisLogRepository,
  ) {}

  prepare(input: KlineTechnicalAnalysisInput): { systemPrompt: string; userPrompt: string } {
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
        costPrice: input.watchlistItem?.costPrice ?? null,
        klines: input.klines,
        indicators: input.indicators,
        intradayKlines: input.intradayKlines,
        intradayIndicators: input.intradayIndicators,
        realtimeQuote: input.realtimeQuote,
      }),
    };
  }

  parseResult(analysisText: string, input: KlineTechnicalAnalysisInput): KlineTechnicalAnalysisResult {
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

  async persistResult(result: KlineTechnicalAnalysisResult, input: KlineTechnicalAnalysisInput): Promise<void> {
    const logEntry: AnalysisLogEntry = {
      symbol: input.symbol,
      analysis_date: formatChinaDateTime().slice(0, 10),
      analysis_text: result.analysisText,
      structured_ok: result.levels != null,
    };

    if (result.levels) {
      await this.keyLevelsRepository.save(input.symbol, result.levels);
    }
    await this.analysisLogRepository.append(logEntry);
  }

  formatForUser(result: KlineTechnicalAnalysisResult): string {
    return formatKeyLevelsAnalysis(result.analysisText, result.levels);
  }
}
