import type { AnalysisLogEntry, KeyLevels } from "../../types/domain.js";
import {
  COMPOSITE_ANALYSIS_SYSTEM_PROMPT,
  buildCompositeAnalysisUserPrompt,
} from "../../prompts/analysis/index.js";
import { formatChinaDateTime } from "../../utils/china-time.js";
import { KeyLevelsRepository } from "../../storage/repositories/key-levels-repo.js";
import { AnalysisLogRepository } from "../../storage/repositories/analysis-log-repo.js";
import type { AnalysisTask } from "./analysis-task.js";
import {
  formatKeyLevelsAnalysis,
  parseKeyLevels,
  validateKeyLevels,
} from "../parsers/key-levels.parser.js";
import type { CompositeAnalysisInput, CompositeAnalysisResult } from "../types/composite-analysis.js";

export class CompositeStockAnalysisTask
  implements AnalysisTask<CompositeAnalysisInput, CompositeAnalysisResult>
{
  readonly taskName = "composite_stock";

  constructor(
    private readonly keyLevelsRepository: KeyLevelsRepository,
    private readonly analysisLogRepository: AnalysisLogRepository,
  ) {}

  prepare(input: CompositeAnalysisInput): { systemPrompt: string; userPrompt: string } {
    return {
      systemPrompt: COMPOSITE_ANALYSIS_SYSTEM_PROMPT,
      userPrompt: buildCompositeAnalysisUserPrompt(input),
    };
  }

  parseResult(analysisText: string, input: CompositeAnalysisInput): CompositeAnalysisResult {
    const parsed = parseKeyLevels(analysisText);
    if (!parsed) {
      return { analysisText, levels: null };
    }

    const levels: KeyLevels = {
      ...parsed,
      symbol: input.market.symbol,
      analysis_date: formatChinaDateTime().slice(0, 10),
      analysis_text: analysisText,
    };
    validateKeyLevels(levels);
    return { analysisText, levels };
  }

  async persistResult(result: CompositeAnalysisResult, input: CompositeAnalysisInput): Promise<void> {
    const logEntry: AnalysisLogEntry = {
      symbol: input.market.symbol,
      analysis_date: formatChinaDateTime().slice(0, 10),
      analysis_text: result.analysisText,
      structured_ok: result.levels != null,
    };

    if (result.levels) {
      await this.keyLevelsRepository.save(input.market.symbol, result.levels);
    }
    await this.analysisLogRepository.append(logEntry);
  }

  formatForUser(result: CompositeAnalysisResult): string {
    return formatKeyLevelsAnalysis(result.analysisText, result.levels);
  }
}
