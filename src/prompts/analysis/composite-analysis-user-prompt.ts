import type {
  FinancialInsightResult,
  NewsInsightResult,
  TechnicalSignalResult,
} from "../../analysis/types/composite-analysis.js";
import { formatCostPrice } from "../../utils/cost-price.js";
import type { FinancialAnalysisContext, MarketAnalysisContext, NewsAnalysisContext } from "../../analysis/types/composite-analysis.js";

export const COMPOSITE_ANALYSIS_SYSTEM_PROMPT = `
你是一位A股综合分析师，需要基于技术面、基本面和资讯面三类输入形成统一结论。

输出要求：
1. 先输出一段 100-150 字的核心摘要，不要在正文中混入 JSON。
2. 摘要后按以下小节分段展开，每节 2-4 句，使用清晰标题：
- 技术面与关键位
- 基本面结论
- 资讯催化与风险
- 共振/冲突与交易判断
3. 分段内容必须明确说明技术面、基本面、资讯面之间是相互印证还是互相冲突，并给出短线交易或持仓判断。
4. 最后输出 \`\`\`json 代码块，结构必须为：
{
  "current_price": 0.0,
  "stop_loss": 0.0,
  "breakthrough": 0.0,
  "support": 0.0,
  "cost_level": 0.0,
  "resistance": 0.0,
  "take_profit": 0.0,
  "gap": 0.0,
  "target": 0.0,
  "round_number": 0.0,
  "score": 5
}

规则：
- score 为最终综合评分（1-10整数）。
- current_price 必须使用提供的最新可用价格。
- 若技术面与基本面/资讯面冲突，正文必须明确指出冲突来源与影响方向。
- 综合结论必须使用A股交易语境，必要时说明涨跌停、T+1、公告催化、题材轮动、监管风险对短线判断的影响。
- 若提供了历史复盘经验，必须说明当前信号与历史经验是相互印证、需要修正，还是构成反例；但历史经验只能校准，不得覆盖当前证据。
- 不要凭空捏造未提供的数据。
`;

export function buildCompositeAnalysisUserPrompt(params: {
  market: MarketAnalysisContext;
  financial: FinancialAnalysisContext;
  news: NewsAnalysisContext;
  technicalResult: TechnicalSignalResult;
  financialResult: FinancialInsightResult;
  newsResult: NewsInsightResult;
}): string {
  const latestClose = params.market.klines[params.market.klines.length - 1]?.close ?? 0;
  const latestRealtimePrice = params.market.realtimeQuote?.last_price ?? latestClose;

  return [
    `请综合分析 ${params.market.companyName}（${params.market.symbol}）。`,
    `用户成本价: ${formatCostPrice(params.market.watchlistItem?.costPrice ?? null)}`,
    `最新收盘价: ${latestClose.toFixed(2)}`,
    `最新实时价: ${latestRealtimePrice.toFixed(2)}`,
    "",
    "## 技术面子结论正文",
    extractNarrative(params.technicalResult.analysisText),
    "",
    "## 基本面子结论正文",
    params.financial.available
      ? extractNarrative(params.financialResult.analysisText)
      : "未获取到有效财务数据，本轮综合分析不纳入基本面打分。",
    "",
    "## 资讯面子结论正文",
    params.news.available
      ? extractNarrative(params.newsResult.analysisText)
      : "未获取到有效资讯数据，本轮综合分析不纳入资讯面打分。",
    "",
    "## 子结论结构化摘要",
    `技术面关键位: ${formatLevels(params.technicalResult)}`,
    `基本面评分/倾向: ${params.financialResult.score ?? "-"} / ${params.financialResult.bias}`,
    `资讯面评分/倾向: ${params.newsResult.score ?? "-"} / ${params.newsResult.bias}`,
    `基本面优势: ${joinList(params.financialResult.strengths)}`,
    `基本面风险: ${joinList(params.financialResult.risks)}`,
    `资讯催化: ${joinList(params.newsResult.catalysts)}`,
    `资讯风险: ${joinList(params.newsResult.risks)}`,
    "",
    ...buildReviewMemoryLines(params.market.reviewMemory),
    "请先输出 100-150 字核心摘要，再按“技术面与关键位 / 基本面结论 / 资讯催化与风险 / 共振或冲突与交易判断”分段展开。若给出了历史复盘经验，需要明确写出当前判断与历史经验是一致、修正还是反例。最后输出最终关键价位 JSON。",
  ].join("\n");
}

function buildReviewMemoryLines(reviewMemory: MarketAnalysisContext["reviewMemory"]): string[] {
  if (!reviewMemory.available || !reviewMemory.summary.trim()) {
    return [];
  }

  return [
    "## 历史复盘经验（仅作校准）",
    reviewMemory.summary,
  ];
}

function formatLevels(result: TechnicalSignalResult): string {
  if (!result.levels) {
    return "暂无结构化关键位";
  }
  return [
    `current=${formatMaybePrice(result.levels.current_price)}`,
    `support=${formatMaybePrice(result.levels.support)}`,
    `resistance=${formatMaybePrice(result.levels.resistance)}`,
    `breakthrough=${formatMaybePrice(result.levels.breakthrough)}`,
    `stop_loss=${formatMaybePrice(result.levels.stop_loss)}`,
    `take_profit=${formatMaybePrice(result.levels.take_profit)}`,
    `score=${result.levels.score}`,
  ].join(", ");
}

function formatMaybePrice(value: number | null | undefined): string {
  return value == null ? "-" : value.toFixed(2);
}

function joinList(items: string[]): string {
  return items.length > 0 ? items.join("；") : "无";
}

function extractNarrative(text: string): string {
  return text.replace(/```json\s*[\s\S]*?\s*```/gi, "").trim();
}
