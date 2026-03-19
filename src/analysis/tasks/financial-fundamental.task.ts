import {
  FINANCIAL_ANALYSIS_SYSTEM_PROMPT,
  buildFinancialAnalysisUserPrompt,
} from "../../prompts/analysis/index.js";
import { parseJsonBlock } from "../parsers/json-block.parser.js";
import type { AnalysisStepTask } from "./analysis-step-task.js";
import type { FinancialAnalysisContext, FinancialInsightResult } from "../types/composite-analysis.js";

interface FinancialInsightJson {
  score?: number;
  bias?: string;
  strengths?: unknown[];
  risks?: unknown[];
  watch_items?: unknown[];
}

export class FinancialFundamentalTask
  implements AnalysisStepTask<FinancialAnalysisContext, FinancialInsightResult>
{
  readonly taskName = "financial_fundamental";

  prepare(input: FinancialAnalysisContext): { systemPrompt: string; userPrompt: string } {
    if (input.mode !== "full" || !input.snapshot) {
      throw new Error(`没有找到 ${input.symbol} 的财务数据`);
    }

    return {
      systemPrompt: FINANCIAL_ANALYSIS_SYSTEM_PROMPT,
      userPrompt: buildFinancialAnalysisUserPrompt({
        symbol: input.symbol,
        companyName: input.companyName,
        snapshot: input.snapshot,
      }),
    };
  }

  parseResult(analysisText: string): FinancialInsightResult {
    return parseFinancialInsightResult(analysisText);
  }
}

export function buildFinancialFallbackResult(): FinancialInsightResult {
  return {
    analysisText: "未获取到有效财务数据，本轮未执行基本面子分析。",
    score: null,
    bias: "neutral",
    strengths: [],
    risks: [],
    watchItems: [],
  };
}

export function parseFinancialInsightResult(analysisText: string): FinancialInsightResult {
  const parsed = parseJsonBlock<FinancialInsightJson>(analysisText);
  return {
    analysisText: analysisText.trim(),
    score: normalizeScore(parsed?.score),
    bias: normalizeBias(parsed?.bias),
    strengths: normalizeStringList(parsed?.strengths),
    risks: normalizeStringList(parsed?.risks),
    watchItems: normalizeStringList(parsed?.watch_items),
  };
}

function normalizeScore(value: unknown): number | null {
  if (!Number.isFinite(Number(value))) {
    return null;
  }
  const score = Math.trunc(Number(value));
  return score >= 1 && score <= 10 ? score : null;
}

function normalizeBias(value: unknown): "positive" | "neutral" | "negative" {
  if (value === "positive" || value === "negative") {
    return value;
  }
  return "neutral";
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 3);
}
