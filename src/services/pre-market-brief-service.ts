import { createHash } from "node:crypto";

import {
  PRE_MARKET_BRIEF_SYSTEM_PROMPT,
  buildPreMarketBriefUserPrompt,
} from "../prompts/analysis/index.js";
import { Jin10FlashRepository } from "../storage/repositories/jin10-flash-repo.js";
import type { WatchlistItem } from "../types/domain.js";
import type { DailyUpdateResultType } from "../types/daily-update.js";
import type { Jin10FlashRecord } from "../types/jin10.js";
import { formatChinaDateTime } from "../utils/china-time.js";
import { AnalysisService } from "./analysis-service.js";
import { Jin10McpService } from "./jin10-mcp-service.js";
import { WatchlistService } from "./watchlist-service.js";
import { extractSectorKeywords } from "./watchlist-profile-service.js";

const PRE_MARKET_BRIEF_KEYWORD = "金十数据整理";
const PRE_MARKET_READY_TIME = "09:20:00";
const PRE_MARKET_SYNC_MAX_PAGES = 12;
const OPPORTUNITY_KEYWORDS = [
  "政策",
  "订单",
  "中标",
  "业绩",
  "回购",
  "增持",
  "涨价",
  "算力",
  "并购",
  "并购重组",
  "AI",
  "人工智能",
  "机器人",
];
const RISK_KEYWORDS = [
  "减持",
  "监管",
  "问询",
  "处罚",
  "停牌",
  "复牌",
  "下调",
  "风险",
  "不确定",
  "制裁",
  "关税",
];

export interface PreMarketBriefRunResult {
  resultType: DailyUpdateResultType;
  message: string;
  sourceCount: number;
  matchedWatchlistCount: number;
}

interface PreMarketWindow {
  startAt: string;
  endAt: string;
  startTs: number;
  endTs: number;
}

interface FlashMatchContext {
  flash: Jin10FlashRecord;
  matchedItems: WatchlistItem[];
  headline: string;
  summary: string;
  keyPoints: string[];
}

export class PreMarketBriefService {
  constructor(
    private readonly watchlistService: WatchlistService,
    private readonly jin10McpService: Jin10McpService,
    private readonly flashRepository: Jin10FlashRepository,
    private readonly analysisService: AnalysisService,
  ) {}

  async run(now: Date = new Date()): Promise<PreMarketBriefRunResult> {
    const watchlist = await this.watchlistService.list();
    if (watchlist.length === 0) {
      return {
        resultType: "skipped",
        message: "🚫 开盘前资讯简报已跳过：关注列表为空。",
        sourceCount: 0,
        matchedWatchlistCount: 0,
      };
    }

    const configError = this.jin10McpService.getConfigurationError();
    if (configError) {
      return {
        resultType: "skipped",
        message: `🚫 开盘前资讯简报已跳过：${configError}`,
        sourceCount: 0,
        matchedWatchlistCount: 0,
      };
    }

    const window = buildPreMarketWindow(now);
    await this.syncWindow(window);
    const flashes = (await this.flashRepository.listByPublishedRange(window.startTs, window.endTs))
      .filter((record) => matchesPreMarketBrief(record));

    if (flashes.length === 0) {
      return {
        resultType: "success",
        message: [
          `**🌅 开盘前资讯简报｜${window.endAt.slice(0, 10)}**`,
          `信息窗口: ${window.startAt} ~ ${window.endAt}`,
          `整理快讯: 0 条 | 自选: ${watchlist.length} 只`,
          "",
          `本窗口未检索到标题含“${PRE_MARKET_BRIEF_KEYWORD}”的快讯，今日无新增盘前整理摘要。`,
        ].join("\n"),
        sourceCount: 0,
        matchedWatchlistCount: 0,
      };
    }

    const matchContexts = flashes.map((flash) => buildFlashMatchContext(flash, watchlist));
    const matchedWatchlistCount = new Set(
      matchContexts.flatMap((context) => context.matchedItems.map((item) => item.symbol)),
    ).size;

    const summary = await this.buildSummary(window, watchlist, matchContexts);

    return {
      resultType: "success",
      message: [
        `**🌅 开盘前资讯简报｜${window.endAt.slice(0, 10)}**`,
        `信息窗口: ${window.startAt} ~ ${window.endAt}`,
        `整理快讯: ${flashes.length} 条 | 自选: ${watchlist.length} 只 | 规则命中: ${matchedWatchlistCount} 只`,
        "",
        summary.trim(),
      ].join("\n"),
      sourceCount: flashes.length,
      matchedWatchlistCount,
    };
  }

  private async syncWindow(window: PreMarketWindow): Promise<void> {
    let cursor: string | undefined;
    const collected: Jin10FlashRecord[] = [];

    for (let pageIndex = 0; pageIndex < PRE_MARKET_SYNC_MAX_PAGES; pageIndex += 1) {
      const page = await this.jin10McpService.listFlash(cursor);
      const records = page.items
        .map((item) => toFlashRecord(item))
        .filter((item): item is Jin10FlashRecord => item != null);

      if (records.length === 0) {
        break;
      }

      collected.push(...records);
      const oldestPublishedTs = records[records.length - 1]?.published_ts ?? Number.MAX_SAFE_INTEGER;
      if (oldestPublishedTs < window.startTs || !page.hasMore || !page.nextCursor) {
        break;
      }

      cursor = page.nextCursor;
    }

    if (collected.length > 0) {
      await this.flashRepository.saveAll(collected);
    }
  }

  private async buildSummary(
    window: PreMarketWindow,
    watchlist: WatchlistItem[],
    matchContexts: FlashMatchContext[],
  ): Promise<string> {
    const promptInput = {
      windowStartAt: window.startAt,
      windowEndAt: window.endAt,
      watchlist,
      flashes: matchContexts.map((context) => ({
        publishedAt: context.flash.published_at,
        headline: context.headline,
        summary: context.summary,
        keyPoints: context.keyPoints,
        content: context.flash.content,
        url: context.flash.url,
        matchedSymbols: context.matchedItems.map((item) => item.symbol),
      })),
    };

    if (this.analysisService.isConfigured()) {
      try {
        const generated = await this.analysisService.generateText(
          PRE_MARKET_BRIEF_SYSTEM_PROMPT,
          buildPreMarketBriefUserPrompt(promptInput),
          {
            maxTokens: 1600,
            temperature: 0.2,
          },
        );
        if (!isLowSignalSummary(generated, matchContexts)) {
          return generated;
        }
      } catch {
        // Fall through to deterministic fallback so the scheduled push still lands.
      }
    }

    return buildFallbackSummary(matchContexts);
  }
}

function buildPreMarketWindow(now: Date): PreMarketWindow {
  const chinaToday = formatChinaDate(now);
  const previousDay = formatChinaDate(
    new Date(toChinaTimestamp(`${chinaToday} ${PRE_MARKET_READY_TIME}`) - 24 * 60 * 60 * 1000),
  );
  const startAt = `${previousDay} 17:00:00`;
  const endAt = `${chinaToday} ${PRE_MARKET_READY_TIME}`;
  return {
    startAt,
    endAt,
    startTs: toChinaTimestamp(startAt),
    endTs: toChinaTimestamp(endAt),
  };
}

function toChinaTimestamp(value: string): number {
  return new Date(`${value.replace(" ", "T")}+08:00`).getTime();
}

function formatChinaDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const map = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${map.year}-${map.month}-${map.day}`;
}

function matchesPreMarketBrief(record: Jin10FlashRecord): boolean {
  return extractHeadlineText(record.content).includes(PRE_MARKET_BRIEF_KEYWORD);
}

function findMatchedItems(flash: Jin10FlashRecord, watchlist: WatchlistItem[]): WatchlistItem[] {
  const normalizedContent = normalizeText(flash.content);
  return watchlist.filter((item) => {
    const directKeywords = [item.symbol, item.symbol.slice(0, 6), item.name];
    const boardKeywords = [...extractSectorKeywords(item.sector), ...item.themes]
      .map((keyword) => keyword.replace(/\s+/g, "").trim())
      .filter((keyword) => keyword.length >= 2);
    return [...directKeywords, ...boardKeywords]
      .map((keyword) => normalizeText(keyword))
      .some((keyword) => keyword && normalizedContent.includes(keyword));
  });
}

function buildFlashMatchContext(flash: Jin10FlashRecord, watchlist: WatchlistItem[]): FlashMatchContext {
  const insight = extractFlashInsight(flash.content);
  return {
    flash,
    matchedItems: findMatchedItems(flash, watchlist),
    headline: insight.headline,
    summary: insight.summary,
    keyPoints: insight.keyPoints,
  };
}

function buildFallbackSummary(matchContexts: FlashMatchContext[]): string {
  const opportunityContexts = matchContexts.filter((context) => containsAnyKeyword(context.flash.content, OPPORTUNITY_KEYWORDS));
  const riskContexts = matchContexts.filter((context) => containsAnyKeyword(context.flash.content, RISK_KEYWORDS));

  return [
    formatSectionTitle("🧭", "重大要闻"),
    formatFlashBullets(matchContexts, 5),
    "",
    formatSectionTitle("🎯", "自选相关"),
    formatMatchedBullets(matchContexts, 5),
    "",
    formatSectionTitle("💡", "潜在机会"),
    opportunityContexts.length > 0
      ? formatFlashBullets(opportunityContexts, 4)
      : "• 未发现基于当前整理快讯可直接确认的新增机会方向。",
    "",
    formatSectionTitle("⚠️", "风险提示"),
    riskContexts.length > 0
      ? formatFlashBullets(riskContexts, 4)
      : "• 当前整理快讯中未发现特别突出的新增风险，但仍需留意开盘后的情绪变化。",
    "",
    formatSectionTitle("📌", "开盘前关注清单"),
    buildFocusBullets(matchContexts),
  ].join("\n");
}

function formatFlashBullets(contexts: FlashMatchContext[], limit: number): string {
  return contexts
    .slice(0, limit)
    .map((context) => {
      const time = context.flash.published_at.slice(11, 16);
      return `• [${time}] ${formatContextSummary(context)}`;
    })
    .join("\n");
}

function formatMatchedBullets(contexts: FlashMatchContext[], limit: number): string {
  const matched = contexts.filter((context) => context.matchedItems.length > 0).slice(0, limit);
  if (matched.length === 0) {
    return "• 未发现直接命中自选股、行业或题材的盘前整理快讯。";
  }

  return matched.map((context) => {
    const labels = context.matchedItems.map((item) => `${item.name}（${item.symbol}）`).join("、");
    return `• ${labels}: ${formatContextSummary(context)}`;
  }).join("\n");
}

function buildFocusBullets(contexts: FlashMatchContext[]): string {
  const bullets: string[] = [];
  const matchedContexts = contexts.filter((context) => context.matchedItems.length > 0);

  for (const context of matchedContexts.slice(0, 3)) {
    const labels = context.matchedItems.map((item) => item.name).join("、");
    bullets.push(`• 关注 ${labels} 开盘后的量价反馈，重点核实“${formatFocusCue(context)}”是否继续发酵。`);
  }

  if (bullets.length < 3) {
    for (const context of contexts.slice(0, 3 - bullets.length)) {
      bullets.push(`• 关注“${formatFocusCue(context)}”对应板块是否出现竞价强化或高开分歧。`);
    }
  }

  return bullets.slice(0, 5).join("\n");
}

function containsAnyKeyword(content: string, keywords: string[]): boolean {
  return keywords.some((keyword) => content.includes(keyword));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function formatSectionTitle(icon: string, title: string): string {
  return `**【${icon} ${title}】**`;
}

function extractHeadlineFromContent(content: string): string {
  const firstLine = extractHeadlineText(content);
  return firstLine.length > 72 ? `${firstLine.slice(0, 72)}...` : firstLine;
}

function extractHeadlineText(content: string): string {
  return content.split(/[\n。！!]/)[0]?.trim() ?? "";
}

function extractFlashInsight(content: string): { headline: string; summary: string; keyPoints: string[] } {
  const headline = extractHeadlineFromContent(content);
  const keyPoints = extractFlashKeyPoints(content, headline);
  if (keyPoints.length === 0) {
    return {
      headline,
      summary: buildTitleOnlySummary(headline),
      keyPoints: [],
    };
  }

  return {
    headline,
    summary: keyPoints.slice(0, 2).join("；"),
    keyPoints,
  };
}

function extractFlashKeyPoints(content: string, headline: string): string[] {
  const body = stripHeadline(content, headline);
  if (!body) {
    return [];
  }

  const lineCandidates = body
    .replace(/\r/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/([。；！？!?])\s*(?=\d+\s*[、.．)）])/g, "$1\n")
    .split(/\n+/)
    .map((segment) => cleanFlashSegment(segment))
    .filter(Boolean);

  const candidates = lineCandidates.length > 1
    ? lineCandidates
    : body
      .split(/[。；！？!?]/)
      .map((segment) => cleanFlashSegment(segment))
      .filter(Boolean);

  const normalizedHeadline = normalizeText(headline);
  const deduped = new Set<string>();
  const keyPoints: string[] = [];

  for (const segment of candidates) {
    const normalizedSegment = normalizeText(segment);
    if (!normalizedSegment || normalizedSegment === normalizedHeadline) {
      continue;
    }
    if (normalizedHeadline && normalizedHeadline.includes(normalizedSegment) && segment.length < Math.max(12, headline.length)) {
      continue;
    }
    if (segment.length < 8) {
      continue;
    }
    if (deduped.has(normalizedSegment)) {
      continue;
    }
    deduped.add(normalizedSegment);
    keyPoints.push(truncateText(segment, 88));
    if (keyPoints.length >= 3) {
      break;
    }
  }

  return keyPoints;
}

function stripHeadline(content: string, headline: string): string {
  const trimmed = content.trim();
  if (!headline) {
    return trimmed;
  }
  if (!trimmed.startsWith(headline)) {
    return trimmed;
  }
  return trimmed.slice(headline.length).replace(/^[：:。；，、\s-]+/, "").trim();
}

function cleanFlashSegment(segment: string): string {
  return segment
    .trim()
    .replace(/^[-•●▪◦]\s*/, "")
    .replace(/^\d+\s*[、.．)）]\s*/, "")
    .replace(/^[（(]?\d+[)）]\s*/, "")
    .replace(/^[：:；，。、\s]+/, "")
    .replace(/[：:；，。、\s]+$/, "")
    .replace(/\s+/g, " ");
}

function buildTitleOnlySummary(headline: string): string {
  const coreHeadline = headline.replace(/^【?金十数据整理[:：]\s*/, "").replace(/】$/, "").trim();
  if (!coreHeadline) {
    return "该整理快讯未提取到可用细节，暂只能作为标题级线索参考。";
  }
  return `${coreHeadline}，但正文未提取到更具体细节，暂只能作为标题级线索参考。`;
}

function formatContextSummary(context: FlashMatchContext): string {
  return context.summary || buildTitleOnlySummary(context.headline);
}

function formatFocusCue(context: FlashMatchContext): string {
  return context.keyPoints[0] ?? context.summary ?? context.headline;
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function isLowSignalSummary(summary: string, contexts: FlashMatchContext[]): boolean {
  const bulletLines = summary
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /^(?:•|-|\d+\.)/.test(line));
  if (bulletLines.length === 0) {
    return true;
  }

  const titleOnlyCount = bulletLines.filter((line) => isTitleOnlyBullet(line, contexts)).length;
  return titleOnlyCount >= Math.max(2, Math.ceil(bulletLines.length / 3));
}

function isTitleOnlyBullet(line: string, contexts: FlashMatchContext[]): boolean {
  const candidates = normalizeBulletForComparison(line);
  if (candidates.length === 0) {
    return false;
  }
  return contexts.some((context) => {
    const headlineForms = [
      normalizeDigestText(context.headline),
      normalizeDigestText(stripDigestPrefix(context.headline)),
    ].filter(Boolean);
    return headlineForms.some((headline) => candidates.some((candidate) => candidate.includes(headline) && candidate.length <= headline.length + 6));
  });
}

function normalizeBulletForComparison(line: string): string[] {
  const cleaned = line
    .replace(/^(?:•|-|\d+\.)\s*/, "")
    .replace(/^\[[0-9:]+\]\s*/, "");
  const normalizedVariants = [
    cleaned,
    cleaned.split(/[：:]/).at(-1) ?? cleaned,
  ]
    .map((item) => normalizeDigestText(item))
    .filter(Boolean);
  return [...new Set(normalizedVariants)];
}

function stripDigestPrefix(value: string): string {
  return value.replace(/^【?金十数据整理[:：]\s*/, "").replace(/】$/, "").trim();
}

function normalizeDigestText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[【】[\]()（）"'“”‘’]/g, "")
    .replace(/[：:]/g, "")
    .replace(/\s+/g, "");
}

function toFlashRecord(item: { content: string; time: string; url: string; raw: Record<string, unknown> }): Jin10FlashRecord | null {
  const published = new Date(item.time);
  if (Number.isNaN(published.getTime())) {
    return null;
  }

  return {
    flash_key: buildFlashKey(item.url, item.time, item.content),
    published_at: formatChinaDateTime(published),
    published_ts: published.getTime(),
    content: item.content.trim(),
    url: item.url.trim(),
    ingested_at: formatChinaDateTime(),
    raw: item.raw,
  };
}

function buildFlashKey(url: string, time: string, content: string): string {
  if (url.trim()) {
    return url.trim();
  }
  return createHash("sha1")
    .update(`${time}\n${content}`)
    .digest("hex");
}
