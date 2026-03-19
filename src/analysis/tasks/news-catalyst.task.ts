import {
  NEWS_ANALYSIS_SYSTEM_PROMPT,
  buildNewsAnalysisUserPrompt,
} from "../../prompts/analysis/index.js";
import { parseJsonBlock } from "../parsers/json-block.parser.js";
import type { AnalysisStepTask } from "./analysis-step-task.js";
import type { NewsAnalysisContext, NewsInsightResult } from "../types/composite-analysis.js";

interface NewsInsightJson {
  score?: number;
  bias?: string;
  catalysts?: unknown[];
  risks?: unknown[];
  watch_items?: unknown[];
}

export class NewsCatalystTask
  implements AnalysisStepTask<NewsAnalysisContext, NewsInsightResult>
{
  readonly taskName = "news_catalyst";

  prepare(input: NewsAnalysisContext): { systemPrompt: string; userPrompt: string } {
    if (input.documents.length === 0) {
      throw new Error(`没有找到 ${input.symbol} 的资讯数据`);
    }

    return {
      systemPrompt: NEWS_ANALYSIS_SYSTEM_PROMPT,
      userPrompt: buildNewsAnalysisUserPrompt({
        symbol: input.symbol,
        companyName: input.companyName,
        query: input.query,
        documents: input.documents,
      }),
    };
  }

  parseResult(analysisText: string): NewsInsightResult {
    const parsed = parseJsonBlock<NewsInsightJson>(analysisText);
    return {
      analysisText: analysisText.trim(),
      score: normalizeScore(parsed?.score),
      bias: normalizeBias(parsed?.bias),
      catalysts: normalizeStringList(parsed?.catalysts),
      risks: normalizeStringList(parsed?.risks),
      watchItems: normalizeStringList(parsed?.watch_items),
    };
  }
}

export function buildNewsFallbackResult(): NewsInsightResult {
  return {
    analysisText: "未获取到有效资讯数据，本轮未执行资讯面子分析。",
    score: null,
    bias: "neutral",
    catalysts: [],
    risks: [],
    watchItems: [],
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
