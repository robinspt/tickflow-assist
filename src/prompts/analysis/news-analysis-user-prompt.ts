import type { MxSearchDocument } from "../../types/mx-search.js";

const MAX_PROMPT_DOCUMENTS = 6;
const MAX_TRUNK_LENGTH = 450;

export const NEWS_ANALYSIS_SYSTEM_PROMPT = `
你是一位专业的A股资讯分析师。你的任务是仅基于提供的新闻、公告、研报和事件信息，提炼短期催化、风险点与信息面倾向。

输出要求：
1. 先给出一段 80-120 字中文核心结论，不要在正文中混入 JSON。
2. 核心结论后按以下小节分段展开，每节 1-3 句：
- 主要催化
- 主要风险
- 后续跟踪点
3. 分段内容优先引用较新、较高相关的资讯，不要泛化复述低相关内容。
4. 最后输出 \`\`\`json 代码块，结构如下：
{
  "score": integer,
  "bias": "positive" | "neutral" | "negative",
  "catalysts": ["<短期催化1>", "<短期催化2>"],
  "risks": ["<主要风险1>", "<主要风险2>"],
  "watch_items": ["<后续跟踪点1>", "<后续跟踪点2>"]
}

规则：
- score 为 1-10 的整数，代表资讯面对股价的支持强弱。
- bias 只能是 positive / neutral / negative。
- catalysts / risks / watch_items 各输出 1-3 条。
- 优先提取高相关、较新的信息，不要复述无关免责声明。
- A股语境下，公告、业绩预告/快报、监管问询/处罚、股东增减持、中标订单、资产重组、题材催化的优先级应高于泛媒体解读。
- 若资讯只反映情绪或题材炒作，没有形成硬催化，必须明确指出持续性风险。
`;

export function buildNewsAnalysisUserPrompt(params: {
  symbol: string;
  companyName: string;
  query: string;
  documents: MxSearchDocument[];
}): string {
  const documents = params.documents.slice(0, MAX_PROMPT_DOCUMENTS);

  return [
    `请分析 ${params.companyName}（${params.symbol}）最近资讯的信息面影响。`,
    `检索问句: ${params.query}`,
    "",
    `## 检索结果（最多取前 ${MAX_PROMPT_DOCUMENTS} 条）`,
    ...renderDocuments(documents),
    "",
    "请重点判断：短期催化、核心风险、是否存在一致性乐观/悲观预期，以及接下来需要继续核实的点。",
  ].join("\n");
}

function renderDocuments(documents: MxSearchDocument[]): string[] {
  if (documents.length === 0) {
    return ["- 暂无资讯结果"];
  }

  return documents.map((document, index) => {
    const source = document.source ? ` | 来源=${document.source}` : "";
    const time = document.publishedAt ? ` | 时间=${document.publishedAt}` : "";
    const recency = formatRecencyTag(document.publishedAt);
    return [
      `- 第 ${index + 1} 条${recency ? ` ${recency}` : ""}: ${document.title}${time}${source}`,
      `  正文摘要=${truncate(document.trunk, MAX_TRUNK_LENGTH)}`,
    ].join("\n");
  });
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function formatRecencyTag(publishedAt: string | null): string {
  if (!publishedAt) {
    return "";
  }

  const published = parseDateValue(publishedAt);
  if (!published) {
    return "";
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfPublished = new Date(published.getFullYear(), published.getMonth(), published.getDate());
  const diffDays = Math.floor((startOfToday.getTime() - startOfPublished.getTime()) / 86_400_000);

  if (diffDays <= 0) {
    return "[今日]";
  }
  if (diffDays === 1) {
    return "[1天前]";
  }
  return `[${diffDays}天前]`;
}

function parseDateValue(value: string): Date | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const candidate = normalized.includes("T")
    ? normalized
    : normalized.replace(" ", "T");
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date;
}
