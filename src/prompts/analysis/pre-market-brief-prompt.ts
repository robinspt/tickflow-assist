import type { WatchlistItem } from "../../types/domain.js";

export const PRE_MARKET_BRIEF_SYSTEM_PROMPT = `
你是一位A股开盘前资讯简报编辑。你的任务是基于盘前窗口内的金十数据整理快讯，以及用户自选股的行业/题材信息，生成一份适合 9:20 推送的开盘前摘要。

输出要求：
1. 按以下标题输出，每节使用 2-5 条简洁中文要点：
- 重大要闻
- 自选相关
- 潜在机会
- 风险提示
- 开盘前关注清单
2. “重大要闻”只提炼会影响 A 股开盘情绪、行业风险偏好或重要交易线索的内容，不要机械罗列所有快讯。
3. “自选相关”要优先点名与自选股、行业或题材直接相关的内容；若没有直接命中，也要明确写出“未发现直接命中自选股”。
4. “潜在机会”只保留存在清晰催化链条的方向，例如政策、产业趋势、业绩、订单、资金偏好变化；没有明确机会时要直说。
5. “风险提示”要指出不利于开盘决策的扰动项，例如监管、海外扰动、业绩风险、题材退潮、消息不确定性。
6. “开盘前关注清单”输出 3-6 条可执行观察点，尽量写清楚应观察的股票、板块或信号。
7. 不要编造未在输入中出现的公司、政策、行业信息或快讯结论。
8. 严禁只复述“金十数据整理：...”标题。每条要点都必须优先使用输入中的“提炼摘要”或“正文要点”，写出至少一个具体事实、影响链条或观察方向。
9. 如果某条整理快讯只有标题、没有可用细节，可以明确写“仅为标题级线索，细节不足”，但不要把标题本身当成完整结论。
10. 输出正文即可，不要附加 JSON。
`;

export function buildPreMarketBriefUserPrompt(params: {
  windowStartAt: string;
  windowEndAt: string;
  watchlist: WatchlistItem[];
  flashes: Array<{
    publishedAt: string;
    headline: string;
    summary: string;
    keyPoints: string[];
    content: string;
    url: string;
    matchedSymbols: string[];
  }>;
}): string {
  return [
    `请生成 ${params.windowEndAt.slice(0, 10)} 的开盘前资讯简报。`,
    `资讯窗口: ${params.windowStartAt} ~ ${params.windowEndAt}`,
    `自选数量: ${params.watchlist.length}`,
    `整理快讯数量: ${params.flashes.length}`,
    "",
    "## 自选列表（全部提供）",
    ...params.watchlist.map((item, index) => formatWatchlistItem(index + 1, item)),
    "",
    "## 金十数据整理快讯（全部提供）",
    ...params.flashes.map((flash, index) => formatFlash(index + 1, flash)),
    "",
    "请重点回答：哪些是今早最重要的市场信息、哪些与自选股或其行业/题材相关、哪些内容值得当作潜在机会或风险在开盘前重点盯住。",
  ].join("\n");
}

function formatWatchlistItem(index: number, item: WatchlistItem): string {
  return [
    `${index}. ${item.name}（${item.symbol}）`,
    `   行业: ${item.sector ?? "未记录"}`,
    `   题材: ${item.themes.length > 0 ? item.themes.join("、") : "未记录"}`,
  ].join("\n");
}

function formatFlash(
  index: number,
  flash: {
    publishedAt: string;
    headline: string;
    summary: string;
    keyPoints: string[];
    content: string;
    url: string;
    matchedSymbols: string[];
  },
): string {
  return [
    `${index}. [${flash.publishedAt}] ${flash.headline || "未提取到标题"}`,
    `   关联提示: ${flash.matchedSymbols.length > 0 ? flash.matchedSymbols.join("、") : "无直接规则命中"}`,
    `   提炼摘要: ${flash.summary}`,
    `   正文要点: ${flash.keyPoints.length > 0 ? flash.keyPoints.map((item) => `- ${item}`).join("； ") : "未提取到稳定要点"}`,
    `   正文: ${flash.content}`,
    `   来源: ${flash.url}`,
  ].join("\n");
}
