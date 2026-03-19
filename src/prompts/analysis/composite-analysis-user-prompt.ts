import type {
  FinancialInsightResult,
  NewsInsightResult,
  TechnicalSignalResult,
} from "../../analysis/types/composite-analysis.js";
import type { FinancialAnalysisContext, MarketAnalysisContext, NewsAnalysisContext } from "../../analysis/types/composite-analysis.js";

export const COMPOSITE_ANALYSIS_SYSTEM_PROMPT = `
你是一位A股综合分析师，需要基于技术面、基本面和资讯面三类输入形成统一结论。

输出要求：
1. 先输出 6-10 句中文结论，不要在正文中混入 JSON。
2. 结论必须覆盖：
- 技术面趋势与关键位
- 基本面质量结论
- 近期资讯/研报催化与风险
- 三者之间是否共振或冲突
- 对短线交易或持仓的综合判断
3. 最后输出 \`\`\`json 代码块，结构必须为：
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
- 若技术面与基本面/资讯面冲突，正文必须明确指出冲突来源。
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
    `用户成本价: ${(params.market.watchlistItem?.costPrice ?? 0).toFixed(2)}`,
    `最新收盘价: ${latestClose.toFixed(2)}`,
    `最新实时价: ${latestRealtimePrice.toFixed(2)}`,
    "",
    "## 技术面子结论",
    params.technicalResult.analysisText,
    "",
    "## 基本面子结论",
    params.financial.available
      ? params.financialResult.analysisText
      : "未获取到有效财务数据，本轮综合分析不纳入基本面打分。",
    "",
    "## 资讯面子结论",
    params.news.available
      ? params.newsResult.analysisText
      : "未获取到有效资讯数据，本轮综合分析不纳入资讯面打分。",
    "",
    "## 子结论结构化补充",
    `技术面关键位: ${formatLevels(params.technicalResult)}`,
    `基本面评分/倾向: ${params.financialResult.score ?? "-"} / ${params.financialResult.bias}`,
    `资讯面评分/倾向: ${params.newsResult.score ?? "-"} / ${params.newsResult.bias}`,
    `基本面优势: ${joinList(params.financialResult.strengths)}`,
    `基本面风险: ${joinList(params.financialResult.risks)}`,
    `资讯催化: ${joinList(params.newsResult.catalysts)}`,
    `资讯风险: ${joinList(params.newsResult.risks)}`,
    "",
    "请形成最终统一判断，并输出最终关键价位 JSON。",
  ].join("\n");
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
