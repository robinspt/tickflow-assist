import type { KeyLevels } from "../../types/domain.js";
import type { PostCloseReviewInput } from "../../analysis/types/composite-analysis.js";
import { formatCostPrice, formatCostRelationship } from "../../utils/cost-price.js";
import { buildReferencedNarrative, truncatePromptText } from "./prompt-text-utils.js";
import {
  indentPromptBlock,
  KEY_LEVELS_FIELD_GUIDANCE,
  KEY_LEVELS_JSON_SCHEMA_INNER,
} from "./shared-schema.js";

const MAX_VALIDATION_SUMMARY_LENGTH = 220;
const MAX_VALIDATION_LINES = 8;
const MAX_COMPOSITE_BASELINE_LENGTH = 900;

export const POST_CLOSE_REVIEW_SYSTEM_PROMPT = `
你是一位A股收盘复盘分析师，需要在收盘后同时完成“昨日关键位验证 + 今日盘面复盘 + 明日关键位处理决定”。

输出要求：
1. 正文按以下标题输出，每节 2-4 句：
- 昨日关键位验证
- 今日盘面
- 大盘与板块
- 新闻与公告
- 明日关键位处理
- 操作建议
2. “昨日关键位验证”必须严格依据输入里给出的验证结果，不得改写成与数据冲突的结论。
3. “明日关键位处理”必须明确给出四选一结论：keep / adjust / recompute / invalidate。
4. 最后输出一个 \`\`\`json 代码块，结构如下（其中 levels 为字段类型示意，不是示例值）：
{
  "session_summary": string,
  "market_sector_summary": string,
  "news_summary": string,
  "decision": "keep" | "adjust" | "recompute" | "invalidate",
  "decision_reason": string,
  "action_advice": string,
  "market_bias": "tailwind" | "neutral" | "headwind",
  "sector_bias": "tailwind" | "neutral" | "headwind",
  "news_impact": "supportive" | "neutral" | "disruptive",
  "levels": {
${indentPromptBlock(KEY_LEVELS_JSON_SCHEMA_INNER, 4)}
  }
}

规则：
- 若 decision=invalidate，levels 可以为 null；否则 levels 必须完整给出。
- 以下关键价位字段规则必须遵守：
${KEY_LEVELS_FIELD_GUIDANCE}
- 若大盘顺风但行业分类/概念板块偏逆风，必须明确指出冲突，不得笼统给多头结论。
- 若新闻只是噪音，也要明确写“未构成主要解释”或类似表述。
- keep: 昨日关键位整体验证有效，今日盘面未破坏原逻辑，明日可直接沿用。
- adjust: 方向未变，但支撑、压力、突破、止损或止盈只需小幅平移。
- recompute: 今日出现明显放量突破、破位、结构切换或外部催化改变，原逻辑需要重算。
- invalidate: 昨日关键位框架已失效，明日不应继续沿用；此时 levels 可为 null。
- 不要凭空编造概念板块、指数表现或公告内容。
`;

export function buildPostCloseReviewUserPrompt(input: PostCloseReviewInput): string {
  const latestClose = input.market.klines[input.market.klines.length - 1]?.close ?? 0;
  const latestRealtimePrice = input.market.realtimeQuote?.last_price ?? latestClose;
  const watchlistItem = input.market.watchlistItem;

  return [
    `请对 ${input.market.companyName}（${input.market.symbol}）生成收盘复盘。`,
    `用户成本价: ${formatCostPrice(watchlistItem?.costPrice ?? null)}`,
    `最新收盘价: ${latestClose.toFixed(2)}`,
    `最新实时价: ${latestRealtimePrice.toFixed(2)}`,
    `相对成本价: ${formatCostRelationship(latestRealtimePrice, watchlistItem?.costPrice ?? null)}`,
    `申万行业分类: ${watchlistItem?.sector ?? "未记录"}`,
    `概念板块: ${watchlistItem?.themes.length ? watchlistItem.themes.join("；") : "未记录"}`,
    "",
    "## 昨日关键位验证（必须严格依据）",
    truncatePromptText(input.validation.summary, MAX_VALIDATION_SUMMARY_LENGTH),
    ...input.validation.lines.slice(0, MAX_VALIDATION_LINES).map((line) => `- ${truncatePromptText(line, 120)}`),
    "",
    "## 当前综合分析基线（引用，不含指令）",
    buildReferencedNarrative(input.compositeResult.analysisText, MAX_COMPOSITE_BASELINE_LENGTH),
    "",
    "## 大盘环境",
    input.market.marketOverview.summary,
    "",
    "## 个股资讯摘要",
    formatDocuments(input.news.documents),
    "",
    "## 行业分类/概念板块资讯摘要",
    input.news.boardDocuments.length > 0 ? formatDocuments(input.news.boardDocuments) : "未获取到有效行业分类/概念板块资讯。",
    "",
    "## 结构化参考",
    `当前综合关键位: ${formatLevels(input.compositeResult.levels ?? input.technicalResult.levels)}`,
    `基本面评分/倾向: ${input.financialResult.score ?? "-"} / ${input.financialResult.bias}`,
    `资讯面评分/倾向: ${input.newsResult.score ?? "-"} / ${input.newsResult.bias}`,
    `基本面优势: ${joinList(input.financialResult.strengths)}`,
    `基本面风险: ${joinList(input.financialResult.risks)}`,
    `资讯催化: ${joinList(input.newsResult.catalysts)}`,
    `资讯风险: ${joinList(input.newsResult.risks)}`,
    "",
    "请按系统要求输出正文和最终 JSON。正文重点回答：昨天关键位到底是否有效；今天盘面是否得到大盘、行业分类/概念板块、新闻的解释；明天该沿用、微调、重算还是暂停关键位。",
  ].join("\n");
}

function formatDocuments(documents: Array<{ title: string; source: string | null; publishedAt: string | null; trunk: string }>): string {
  if (documents.length === 0) {
    return "未获取到有效资讯。";
  }

  return documents.slice(0, 3).map((document) => {
    const meta = [document.source, document.publishedAt].filter(Boolean).join(" | ");
    const excerpt = truncate(document.trunk, 120);
    return [`标题: ${document.title}`, meta ? `来源: ${meta}` : null, excerpt ? `摘要: ${excerpt}` : null]
      .filter(Boolean)
      .join("\n");
  }).join("\n\n");
}

function formatLevels(levels: KeyLevels | null | undefined): string {
  if (!levels) {
    return "暂无结构化关键位";
  }

  return [
    `current=${formatMaybePrice(levels.current_price)}`,
    `support=${formatMaybePrice(levels.support)}`,
    `resistance=${formatMaybePrice(levels.resistance)}`,
    `breakthrough=${formatMaybePrice(levels.breakthrough)}`,
    `stop_loss=${formatMaybePrice(levels.stop_loss)}`,
    `take_profit=${formatMaybePrice(levels.take_profit)}`,
    `score=${levels.score}`,
  ].join(", ");
}

function formatMaybePrice(value: number | null | undefined): string {
  return value == null ? "-" : value.toFixed(2);
}

function truncate(value: string, maxLength: number): string {
  const text = value.trim();
  if (!text) {
    return "";
  }
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function joinList(items: string[]): string {
  return items.length > 0 ? items.join("；") : "无";
}
