import type { MxSearchDocument } from "../../types/mx-search.js";

const MAX_PROMPT_DOCUMENTS = 8;
const MAX_TRUNK_LENGTH = 600;

export const WATCHLIST_PROFILE_EXTRACTION_SYSTEM_PROMPT = [
  "你是A股证券资料结构化抽取助手。",
  "",
  "你的唯一任务：根据给定的妙想搜索结果，提取该股票的行业分类与概念板块，并严格输出 JSON。",
  "",
  "硬性要求：",
  "1. 只能依据提供的资料，不得编造。",
  "2. 只输出 JSON 对象或 ```json 代码块，不要输出解释文字。",
  "3. JSON 结构固定为：",
  "{",
  '  "sector": string | null,',
  '  "themes": string[],',
  '  "confidence": "low" | "medium" | "high"',
  "}",
  "4. sector 优先提取申万行业/行业分类，保留完整层级；没有可靠信息时填 null。",
  "5. themes 尽量完整列出概念板块，去重后输出数组；优先保留明确的概念/题材/板块名称。",
  "6. themes 中不要输出泛词，例如公司新闻、最新公告、市场快讯；也不要输出等。",
  "7. 若资料中是组合表达，拆成独立概念更优，例如华为昇腾 / 华为昇思应拆成两个数组项。",
  "8. 若资料仅出现业务描述而没有足够证据支持概念标签，不要强行扩写。",
  "9. confidence 仅反映你对提取结果的把握，不要附加解释。",
].join("\n");

export function buildWatchlistProfileExtractionUserPrompt(input: {
  symbol: string;
  companyName: string;
  documents: MxSearchDocument[];
}): string {
  const documents = input.documents.slice(0, MAX_PROMPT_DOCUMENTS);

  return [
    `股票名称: ${input.companyName}`,
    `股票代码: ${input.symbol}`,
    "",
    "请根据下面的妙想搜索结果，提取该股票的行业分类与概念板块，并严格按要求输出 JSON。",
    "",
    "## 妙想搜索结果",
    documents.length > 0 ? formatDocuments(documents) : "未获取到任何搜索结果。",
    "",
    "再次提醒：不要输出解释，只输出 JSON。",
  ].join("\n");
}

function formatDocuments(documents: MxSearchDocument[]): string {
  return documents.map((document, index) => formatDocument(document, index + 1)).join("\n\n");
}

function formatDocument(document: MxSearchDocument, index: number): string {
  const trunk = document.trunk.trim();
  const safeTrunk = trunk.length > MAX_TRUNK_LENGTH
    ? `${trunk.slice(0, MAX_TRUNK_LENGTH)}...`
    : trunk;

  return [
    `${index}. 标题: ${document.title}`,
    `来源: ${document.source ?? "未知"}`,
    `时间: ${document.publishedAt ?? "未知"}`,
    `正文: ${safeTrunk || "无"}`,
  ].join("\n");
}
