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
const FALLBACK_MAJOR_NEWS_LIMIT = 5;
const FALLBACK_TOPIC_KEY_POINT_LIMIT = 6;

interface TopicRule {
  category: string;
  keywords: string[];
  score: number;
  macroImplication: string;
  opportunityImplication?: string;
  riskImplication?: string;
}

const TOPIC_RULES: TopicRule[] = [
  {
    category: "地缘与能源",
    keywords: [
      "伊朗",
      "以色列",
      "中东",
      "海湾",
      "霍尔木兹",
      "俄乌",
      "俄罗斯",
      "乌克兰",
      "原油",
      "石油",
      "油轮",
      "EIA",
      "能源",
      "侵略",
      "制裁",
      "开战",
    ],
    score: 8,
    macroImplication: "地缘风险与能源价格预期可能影响开盘风险偏好",
    riskImplication: "海外扰动容易传导到原油、航运、防务及周期品情绪",
  },
  {
    category: "科技产业",
    keywords: [
      "AI",
      "人工智能",
      "大模型",
      "算力",
      "芯片",
      "半导体",
      "台积电",
      "量子",
      "机器人",
      "开源",
      "3D生成",
    ],
    score: 7,
    macroImplication: "科技成长方向的产业催化可能影响题材活跃度",
    opportunityImplication: "产业链、算力、应用和设备端是否出现扩散",
    riskImplication: "高热度题材若只停留在消息刺激，开盘后容易高开分化",
  },
  {
    category: "政策与支付互联",
    keywords: ["政策", "微信支付", "二维码", "跨境", "互联互通", "试点", "监管", "关税"],
    score: 6,
    macroImplication: "政策或跨境互联线索可能改变相关行业预期",
    opportunityImplication: "支付、出海、消费场景和平台生态是否获得资金确认",
    riskImplication: "监管或外部政策变化可能压制相关板块估值与情绪",
  },
  {
    category: "产业与订单",
    keywords: ["订单", "中标", "业绩", "回购", "增持", "涨价", "并购", "并购重组", "发布", "恢复"],
    score: 5,
    macroImplication: "产业事件或公司行为可能提供结构性交易线索",
    opportunityImplication: "订单、业绩、价格和资本运作线索是否带来板块联动",
  },
  {
    category: "资金与宏观",
    keywords: ["美联储", "利率", "美元", "人民币", "股市", "出口", "进口", "产量", "库存"],
    score: 5,
    macroImplication: "宏观和资金面变化可能影响开盘定价与风险偏好",
    riskImplication: "宏观数据变化若与市场预期背离，可能造成高开低走或避险交易",
  },
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

interface FlashTopic {
  context: FlashMatchContext;
  text: string;
  time: string;
  rule: TopicRule;
  score: number;
  matchedItems: WatchlistItem[];
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
    return buildWatchlistKeywordEntries(item)
      .some((entry) => normalizedContent.includes(entry.normalized));
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
  const topics = buildFlashTopics(matchContexts);
  const opportunityTopics = topics.filter(isOpportunityTopic);
  const riskTopics = topics.filter(isRiskTopic);

  return [
    formatSectionTitle("🧭", "重大要闻"),
    formatMajorNewsBullets(topics),
    "",
    formatSectionTitle("🎯", "自选相关"),
    formatMatchedBullets(matchContexts, topics, 5),
    "",
    formatSectionTitle("💡", "潜在机会"),
    opportunityTopics.length > 0
      ? formatOpportunityBullets(opportunityTopics, 4)
      : "• 未发现基于当前整理快讯可直接确认的新增机会方向。",
    "",
    formatSectionTitle("⚠️", "风险提示"),
    riskTopics.length > 0
      ? formatRiskBullets(riskTopics, 4)
      : "• 当前整理快讯中未发现特别突出的新增风险，但仍需留意开盘后的情绪变化。",
    "",
    formatSectionTitle("📌", "开盘前关注清单"),
    buildFocusBullets(topics, matchContexts),
  ].join("\n");
}

function buildFlashTopics(contexts: FlashMatchContext[]): FlashTopic[] {
  const seen = new Set<string>();
  const topics: FlashTopic[] = [];

  for (const context of contexts) {
    const texts = context.keyPoints.length > 0
      ? context.keyPoints
      : [formatContextSummary(context)];
    const limitedTexts = texts.slice(0, FALLBACK_TOPIC_KEY_POINT_LIMIT);

    for (const text of limitedTexts) {
      const normalizedText = normalizeDigestText(text);
      if (!normalizedText || seen.has(normalizedText)) {
        continue;
      }
      seen.add(normalizedText);

      const rule = inferTopicRule(`${context.headline} ${text}`);
      topics.push({
        context,
        text,
        time: context.flash.published_at.slice(11, 16),
        rule,
        score: scoreTopic(text, context, rule),
        matchedItems: context.matchedItems.filter((item) => topicMatchesWatchlistItem(text, item)),
      });
    }
  }

  if (topics.length > 0) {
    return topics;
  }

  return contexts.map((context) => {
    const text = formatContextSummary(context);
    const rule = inferTopicRule(`${context.headline} ${text}`);
    return {
      context,
      text,
      time: context.flash.published_at.slice(11, 16),
      rule,
      score: scoreTopic(text, context, rule),
      matchedItems: context.matchedItems,
    };
  });
}

function formatMajorNewsBullets(topics: FlashTopic[]): string {
  const selected = selectDiverseTopics(topics, FALLBACK_MAJOR_NEWS_LIMIT);
  if (selected.length === 0) {
    return "• 未提取到足够正文细节，今日重大要闻暂只能按标题级线索观察。";
  }

  return selected
    .map((topic) => `• [${topic.time}] ${topic.rule.category}: ${topic.text}；${topic.rule.macroImplication}。`)
    .join("\n");
}

function formatOpportunityBullets(topics: FlashTopic[], limit: number): string {
  return selectDiverseTopics(topics, limit)
    .map((topic) => {
      const implication = topic.rule.opportunityImplication ?? "相关方向是否获得资金确认";
      return `• [${topic.time}] ${topic.rule.category}: ${topic.text}；观察${implication}。`;
    })
    .join("\n");
}

function formatRiskBullets(topics: FlashTopic[], limit: number): string {
  return selectDiverseTopics(topics, limit)
    .map((topic) => {
      const implication = topic.rule.riskImplication ?? "消息不确定性对开盘情绪的扰动";
      return `• [${topic.time}] ${topic.rule.category}: ${topic.text}；风险点在于${implication}。`;
    })
    .join("\n");
}

function formatMatchedBullets(
  contexts: FlashMatchContext[],
  topics: FlashTopic[],
  limit: number,
): string {
  const matchedBySymbol = new Map<string, { item: WatchlistItem; cues: Array<{ text: string; reason: string }> }>();

  for (const topic of topics) {
    for (const item of topic.matchedItems) {
      addWatchlistCue(matchedBySymbol, item, {
        text: topic.text,
        reason: describeWatchlistMatch(item, topic.text),
      });
    }
  }

  for (const context of contexts) {
    for (const item of context.matchedItems) {
      if (matchedBySymbol.has(item.symbol)) {
        continue;
      }
      const cue = findBestWatchlistCue(context, item);
      addWatchlistCue(matchedBySymbol, item, {
        text: cue,
        reason: describeWatchlistMatch(item, cue),
      });
    }
  }

  const entries = [...matchedBySymbol.values()].slice(0, limit);
  if (entries.length === 0) {
    return "• 未发现直接命中自选股、行业或题材的盘前整理快讯。";
  }

  return entries.map(({ item, cues }) => {
    const text = cues
      .slice(0, 2)
      .map((cue) => `${cue.reason}: ${cue.text}`)
      .join("；");
    return `• ${item.name}（${item.symbol}）: ${text}`;
  }).join("\n");
}

function buildFocusBullets(topics: FlashTopic[], contexts: FlashMatchContext[]): string {
  const bullets: string[] = [];
  const matchedTopics = topics.filter((topic) => topic.matchedItems.length > 0);

  for (const topic of selectDiverseTopics(matchedTopics, 2)) {
    const labels = topic.matchedItems.map((item) => item.name).join("、");
    addUniqueBullet(
      bullets,
      `• 关注 ${labels} 与“${formatFocusCueText(topic.text)}”的联动强度，开盘看竞价、放量承接和回落后的资金回流。`,
    );
  }

  for (const topic of selectDiverseTopics(topics.filter(isRiskTopic), 2)) {
    addUniqueBullet(
      bullets,
      `• 观察 ${topic.rule.category} 是否压制风险偏好，重点看“${formatFocusCueText(topic.text)}”有无后续快讯确认。`,
    );
  }

  for (const topic of selectDiverseTopics(topics.filter(isOpportunityTopic), 2)) {
    addUniqueBullet(
      bullets,
      `• 观察 ${topic.rule.category} 主题是否扩散，重点看“${formatFocusCueText(topic.text)}”对应方向高开后的承接而非单点冲高。`,
    );
  }

  if (bullets.length < 3) {
    for (const context of contexts) {
      addUniqueBullet(
        bullets,
        `• 复核“${formatFocusCue(context)}”是否有后续消息或竞价强化，避免仅按标题级线索追高。`,
      );
      if (bullets.length >= 3) {
        break;
      }
    }
  }

  return bullets.slice(0, 5).join("\n");
}

function selectDiverseTopics(topics: FlashTopic[], limit: number): FlashTopic[] {
  const sorted = [...topics].sort(compareTopicsByImportance);
  const selected: FlashTopic[] = [];
  const selectedCategories = new Set<string>();
  const selectedTexts = new Set<string>();

  for (const topic of sorted) {
    if (selected.length >= limit) {
      break;
    }
    const normalizedText = normalizeDigestText(topic.text);
    if (selectedTexts.has(normalizedText) || selectedCategories.has(topic.rule.category)) {
      continue;
    }
    selected.push(topic);
    selectedTexts.add(normalizedText);
    selectedCategories.add(topic.rule.category);
  }

  for (const topic of sorted) {
    if (selected.length >= limit) {
      break;
    }
    const normalizedText = normalizeDigestText(topic.text);
    if (selectedTexts.has(normalizedText)) {
      continue;
    }
    selected.push(topic);
    selectedTexts.add(normalizedText);
  }

  return selected.sort((left, right) => left.context.flash.published_ts - right.context.flash.published_ts);
}

function compareTopicsByImportance(left: FlashTopic, right: FlashTopic): number {
  return right.score - left.score || left.context.flash.published_ts - right.context.flash.published_ts;
}

function inferTopicRule(text: string): TopicRule {
  return TOPIC_RULES
    .filter((rule) => containsAnyKeyword(text, rule.keywords))
    .sort((left, right) => right.score - left.score)[0]
    ?? {
      category: "市场情绪",
      keywords: [],
      score: 3,
      macroImplication: "该线索可能影响局部题材情绪，需结合竞价强弱确认",
    };
}

function scoreTopic(text: string, context: FlashMatchContext, rule: TopicRule): number {
  let score = rule.score;
  if (containsAnyKeyword(text, OPPORTUNITY_KEYWORDS)) {
    score += 2;
  }
  if (containsAnyKeyword(text, RISK_KEYWORDS)) {
    score += 2;
  }
  if (context.matchedItems.length > 0) {
    score += 1;
  }
  if (text.length >= 18) {
    score += 1;
  }
  return score;
}

function isOpportunityTopic(topic: FlashTopic): boolean {
  return Boolean(topic.rule.opportunityImplication) || containsAnyKeyword(topic.text, OPPORTUNITY_KEYWORDS);
}

function isRiskTopic(topic: FlashTopic): boolean {
  return Boolean(topic.rule.riskImplication) || containsAnyKeyword(topic.text, RISK_KEYWORDS);
}

function addWatchlistCue(
  matchedBySymbol: Map<string, { item: WatchlistItem; cues: Array<{ text: string; reason: string }> }>,
  item: WatchlistItem,
  cue: { text: string; reason: string },
): void {
  const entry = matchedBySymbol.get(item.symbol) ?? { item, cues: [] };
  const normalizedCue = normalizeDigestText(cue.text);
  if (!entry.cues.some((existing) => normalizeDigestText(existing.text) === normalizedCue)) {
    entry.cues.push(cue);
  }
  matchedBySymbol.set(item.symbol, entry);
}

function findBestWatchlistCue(context: FlashMatchContext, item: WatchlistItem): string {
  const exactCue = context.keyPoints.find((point) => topicMatchesWatchlistItem(point, item));
  return exactCue ?? formatContextSummary(context);
}

function topicMatchesWatchlistItem(text: string, item: WatchlistItem): boolean {
  const normalizedText = normalizeText(text);
  return buildWatchlistKeywordEntries(item)
    .some((entry) => normalizedText.includes(entry.normalized));
}

function describeWatchlistMatch(item: WatchlistItem, text: string): string {
  const normalizedText = normalizeText(text);
  const entries = buildWatchlistKeywordEntries(item);
  const directMatch = entries
    .find((entry) => entry.kind === "direct" && normalizedText.includes(entry.normalized));
  if (directMatch) {
    return "直接命中";
  }

  const themeMatch = entries
    .find((entry) => entry.kind === "theme" && normalizedText.includes(entry.normalized));
  if (themeMatch) {
    return `题材${themeMatch.keyword}`;
  }

  const sectorMatch = entries
    .find((entry) => entry.kind === "sector" && normalizedText.includes(entry.normalized));
  if (sectorMatch) {
    return `行业${sectorMatch.keyword}`;
  }

  return "规则命中";
}

function buildWatchlistKeywordEntries(item: WatchlistItem): Array<{ keyword: string; normalized: string; kind: "direct" | "sector" | "theme" }> {
  const entries = [
    ...[item.symbol, item.symbol.slice(0, 6), item.name].map((keyword) => ({ keyword, kind: "direct" as const })),
    ...extractSectorKeywords(item.sector).map((keyword) => ({ keyword, kind: "sector" as const })),
    ...item.themes.map((keyword) => ({ keyword, kind: "theme" as const })),
  ];

  const seen = new Set<string>();
  return entries
    .map((entry) => ({
      ...entry,
      keyword: entry.keyword.replace(/\s+/g, "").trim(),
      normalized: normalizeText(entry.keyword),
    }))
    .filter((entry) => entry.normalized.length >= 2)
    .filter((entry) => {
      if (seen.has(entry.normalized)) {
        return false;
      }
      seen.add(entry.normalized);
      return true;
    });
}

function addUniqueBullet(bullets: string[], bullet: string): void {
  const normalizedBullet = normalizeDigestText(bullet);
  if (!bullets.some((existing) => normalizeDigestText(existing) === normalizedBullet)) {
    bullets.push(bullet);
  }
}

function formatFocusCueText(text: string): string {
  return truncateText(text, 34);
}

function containsAnyKeyword(content: string, keywords: string[]): boolean {
  const normalizedContent = normalizeText(content);
  return keywords.some((keyword) => normalizedContent.includes(normalizeText(keyword)));
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
    if (keyPoints.length >= FALLBACK_TOPIC_KEY_POINT_LIMIT) {
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
  const isTruncatedHeadline = headline.endsWith("...");
  if (!isTruncatedHeadline && trimmed.startsWith(headline)) {
    return trimmed.slice(headline.length).replace(/^[：:。；，、\s-]+/, "").trim();
  }

  const withoutDigestPrefix = trimmed
    .replace(/^【?金十数据整理[:：]\s*/, "")
    .replace(/^】\s*/, "")
    .trim();
  if (withoutDigestPrefix !== trimmed) {
    return withoutDigestPrefix;
  }

  if (isTruncatedHeadline) {
    return trimmed;
  }

  return trimmed;
}

function cleanFlashSegment(segment: string): string {
  return segment
    .trim()
    .replace(/^【?金十数据整理[:：]\s*/, "")
    .replace(/^([^】]{2,40})】\s*/, "")
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
