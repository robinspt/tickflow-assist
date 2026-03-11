import type { AnalysisLogEntry, KeyLevels, WatchlistItem } from "../types/domain.js";
import type { TickFlowKlineRow } from "../types/tickflow.js";
import type { IndicatorRow } from "../types/indicator.js";
import { ANALYSIS_SYSTEM_PROMPT } from "../prompts/analysis-system-prompt.js";
import { buildAnalysisUserPrompt } from "../prompts/analysis-user-prompt.js";
import { KeyLevelsRepository } from "../storage/repositories/key-levels-repo.js";
import { AnalysisLogRepository } from "../storage/repositories/analysis-log-repo.js";
import { formatChinaDateTime } from "../utils/china-time.js";

type PriceFieldKey =
  | "current_price"
  | "stop_loss"
  | "breakthrough"
  | "support"
  | "cost_level"
  | "resistance"
  | "take_profit"
  | "gap"
  | "target"
  | "round_number";

export class AnalysisService {
  constructor(
    private readonly llmBaseUrl: string,
    private readonly llmApiKey: string,
    private readonly llmModel: string,
    private readonly keyLevelsRepository: KeyLevelsRepository,
    private readonly analysisLogRepository: AnalysisLogRepository,
  ) {}

  async analyze(params: {
    symbol: string;
    watchlistItem: WatchlistItem | null;
    klines: TickFlowKlineRow[];
    indicators: IndicatorRow[];
  }): Promise<{ analysisText: string; levels: KeyLevels | null }> {
    if (params.klines.length === 0) {
      throw new Error(`没有找到 ${params.symbol} 的K线数据，请先执行 fetch-klines`);
    }
    if (params.indicators.length === 0) {
      throw new Error(`没有找到 ${params.symbol} 的指标数据，请先执行 fetch-klines`);
    }

    const costPrice = params.watchlistItem?.costPrice ?? 0;
    const userPrompt = buildAnalysisUserPrompt({
      symbol: params.symbol,
      costPrice,
      klines: params.klines,
      indicators: params.indicators,
    });

    const analysisText = await this.callLlm(userPrompt);
    const parsed = parseKeyLevels(analysisText);
    const analysisDate = formatChinaDateTime().slice(0, 10);

    const logEntry: AnalysisLogEntry = {
      symbol: params.symbol,
      analysis_date: analysisDate,
      analysis_text: analysisText,
      structured_ok: parsed != null,
    };

    if (!parsed) {
      await this.analysisLogRepository.append(logEntry);
      return { analysisText, levels: null };
    }

    const levels: KeyLevels = {
      ...parsed,
      symbol: params.symbol,
      analysis_date: analysisDate,
      analysis_text: analysisText,
    };
    validateKeyLevels(levels);
    await this.keyLevelsRepository.save(params.symbol, levels);
    await this.analysisLogRepository.append(logEntry);
    return { analysisText, levels };
  }

  formatAnalysisForUser(analysisText: string, levels: KeyLevels | null): string {
    const conclusion = extractConclusion(analysisText);
    const lines = [conclusion];

    if (levels) {
      lines.push("", "📊 关键价位汇总:");
      for (const [label, key] of PRICE_FIELDS) {
        const value = levels[key];
        lines.push(`  ${label}: ${value && value > 0 ? value.toFixed(2) : "暂无"}`);
      }
      lines.push("", `  技术面评分: ${levels.score}/10`);
    }

    return lines.join("\n");
  }

  async getLatestAnalysis(symbol: string): Promise<AnalysisLogEntry | null> {
    return this.analysisLogRepository.getLatest(symbol);
  }

  private async callLlm(userPrompt: string): Promise<string> {
    const url = new URL("/chat/completions", this.llmBaseUrl).toString();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.llmApiKey}`,
      },
      body: JSON.stringify({
        model: this.llmModel,
        messages: [
          { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 4096,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM analyze request failed: ${response.status} ${response.statusText} ${text}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("LLM analyze response content is empty");
    }
    return content;
  }
}

const PRICE_FIELDS: Array<[string, PriceFieldKey]> = [
  ["当前价格", "current_price"],
  ["止损位", "stop_loss"],
  ["突破位", "breakthrough"],
  ["支撑位", "support"],
  ["成本位", "cost_level"],
  ["压力位", "resistance"],
  ["止盈位", "take_profit"],
  ["缺口位", "gap"],
  ["目标位", "target"],
  ["整数关", "round_number"],
];

function parseKeyLevels(responseText: string): KeyLevels | null {
  const fenced = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  const candidate = fenced?.[1] ?? responseText.match(/\{[\s\S]*"current_price"[\s\S]*\}/)?.[0];
  if (!candidate) {
    return null;
  }

  try {
    return JSON.parse(candidate) as KeyLevels;
  } catch {
    return null;
  }
}

function extractConclusion(analysisText: string): string {
  return analysisText.replace(/```json\s*[\s\S]*?\s*```/g, "").trim();
}

function validateKeyLevels(levels: KeyLevels): void {
  if (!(levels.current_price > 0)) {
    throw new Error(`current_price must be > 0, got ${levels.current_price}`);
  }
  if (!Number.isInteger(levels.score) || levels.score < 1 || levels.score > 10) {
    throw new Error(`score must be integer 1-10, got ${levels.score}`);
  }
  for (const [, key] of PRICE_FIELDS.slice(1)) {
    const value = levels[key];
    if (value != null && value < 0) {
      throw new Error(`${String(key)} must be >= 0, got ${value}`);
    }
  }
}
