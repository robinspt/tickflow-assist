import type { WatchlistItem } from "../../types/domain.js";
import type { Jin10FlashRecord } from "../../types/jin10.js";

export const FLASH_MONITOR_ALERT_SYSTEM_PROMPT = `
你是一位A股盘中/盘后快讯告警筛选器。你的任务是判断一条金十快讯，是否值得对当前关注列表发送一次告警。

判断规则：
1. 只有在快讯与关注股票本身，或与其行业/题材存在明确、可执行、短期可能影响风险偏好的关联时，才返回 alert=true。
2. 直接点名公司/股票代码的公告、订单、中标、减持、增持、业绩预告、重组、监管、停复牌、重大产品/项目、重要行业政策，优先级最高。
3. 纯海外宏观、地缘、商品报价、直播推广、图示播报、与A股候选标的缺乏清晰传导路径的内容，不要触发告警。
4. 行业/题材级快讯只有在确实会影响候选板块风险偏好时，才可触发；泛泛而谈的行业新闻不要触发。
5. 输出必须只有一个 \`\`\`json 代码块，结构如下：
{
  "alert": boolean,
  "importance": "high" | "medium" | "low",
  "relevant_symbols": ["000001", "600519"],
  "headline": "简短告警标题",
  "reason": "20-50字中文理由"
}
`;

export function buildFlashMonitorAlertUserPrompt(params: {
  flash: Jin10FlashRecord;
  candidates: Array<{
    item: WatchlistItem;
    directKeywords: string[];
    boardKeywords: string[];
  }>;
}): string {
  return [
    "请判断以下金十快讯是否值得触发一次A股自选告警。",
    "",
    "## 快讯",
    `时间: ${params.flash.published_at}`,
    `链接: ${params.flash.url}`,
    `正文: ${params.flash.content}`,
    "",
    "## 一阶段候选命中",
    ...params.candidates.map((candidate, index) => formatCandidate(index + 1, candidate.item, candidate.directKeywords, candidate.boardKeywords)),
    "",
    "请特别警惕误报：如果只是宽泛宏观信息、海外事件或商品行情，且没有明确传导到候选股票/行业，就不要发告警。",
  ].join("\n");
}

function formatCandidate(
  index: number,
  item: WatchlistItem,
  directKeywords: string[],
  boardKeywords: string[],
): string {
  return [
    `${index}. ${item.name}（${item.symbol}）`,
    `   直接命中: ${formatKeywords(directKeywords)}`,
    `   行业/题材命中: ${formatKeywords(boardKeywords)}`,
    `   行业: ${item.sector ?? "未知"}`,
    `   题材: ${item.themes.length > 0 ? item.themes.join("、") : "无"}`,
  ].join("\n");
}

function formatKeywords(items: string[]): string {
  return items.length > 0 ? items.join("、") : "无";
}
