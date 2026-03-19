import {
  FINANCIAL_LITE_ANALYSIS_SYSTEM_PROMPT,
  buildFinancialLiteAnalysisUserPrompt,
} from "../../prompts/analysis/index.js";
import type { AnalysisStepTask } from "./analysis-step-task.js";
import {
  parseFinancialInsightResult,
} from "./financial-fundamental.task.js";
import type { FinancialAnalysisContext, FinancialInsightResult } from "../types/composite-analysis.js";

export class FinancialFundamentalLiteTask
  implements AnalysisStepTask<FinancialAnalysisContext, FinancialInsightResult>
{
  readonly taskName = "financial_fundamental_lite";

  prepare(input: FinancialAnalysisContext): { systemPrompt: string; userPrompt: string } {
    if (!input.liteSnapshot) {
      throw new Error(`没有找到 ${input.symbol} 的 lite 财务指标数据`);
    }

    return {
      systemPrompt: FINANCIAL_LITE_ANALYSIS_SYSTEM_PROMPT,
      userPrompt: buildFinancialLiteAnalysisUserPrompt({
        symbol: input.symbol,
        companyName: input.companyName,
        snapshot: input.liteSnapshot,
      }),
    };
  }

  parseResult(analysisText: string): FinancialInsightResult {
    return parseFinancialInsightResult(analysisText);
  }
}
