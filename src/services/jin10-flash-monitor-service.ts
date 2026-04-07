import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseFlashAlertDecision } from "../analysis/parsers/flash-alert-decision.parser.js";
import {
  FLASH_MONITOR_ALERT_SYSTEM_PROMPT,
  buildFlashMonitorAlertUserPrompt,
} from "../prompts/analysis/index.js";
import type { WatchlistItem } from "../types/domain.js";
import type { FlashMonitorState } from "../types/flash-monitor.js";
import type { Jin10FlashDeliveryEntry, Jin10FlashRecord } from "../types/jin10.js";
import { chinaToday, formatChinaDateTime } from "../utils/china-time.js";
import { AnalysisService } from "./analysis-service.js";
import { AlertService } from "./alert-service.js";
import { Jin10McpService } from "./jin10-mcp-service.js";
import { WatchlistService } from "./watchlist-service.js";
import { Jin10FlashDeliveryRepository } from "../storage/repositories/jin10-flash-delivery-repo.js";
import { Jin10FlashRepository } from "../storage/repositories/jin10-flash-repo.js";

const DEFAULT_STATE: FlashMonitorState = {
  initialized: false,
  lastSeenKey: null,
  lastSeenPublishedAt: null,
  lastSeenUrl: null,
  backfillCursor: null,
  runtimeHost: null,
  runtimeObservedAt: null,
  lastHeartbeatAt: null,
  lastPollAt: null,
  lastPollStored: 0,
  lastPollCandidates: 0,
  lastPollAlerts: 0,
  lastPrunedAt: null,
  lastLoopError: null,
  lastLoopErrorAt: null,
};

const MAX_FLASH_PAGES_PER_POLL = 5;
const INITIAL_SEED_PAGES = 3;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const NOISE_PATTERNS = [
  /^金十图示[:：]/,
  /交易学院正在直播中/,
];
const HIGH_IMPORTANCE_KEYWORDS = [
  "重组",
  "减持",
  "增持",
  "业绩预告",
  "业绩快报",
  "中标",
  "签署",
  "订单",
  "停牌",
  "复牌",
  "监管",
  "问询",
  "处罚",
  "回购",
];

interface StageOneMatch {
  item: WatchlistItem;
  directKeywords: string[];
  boardKeywords: string[];
}

interface StageOneCandidate {
  flash: Jin10FlashRecord;
  matches: StageOneMatch[];
}

interface FlashFetchResult {
  items: Jin10FlashRecord[];
  latest: Jin10FlashRecord | null;
  nextCursor: string | null;
}

interface FlashAlertDecision {
  alert: boolean;
  importance: "high" | "medium" | "low";
  relevantSymbols: string[];
  headline: string;
  reason: string;
}

export class Jin10FlashMonitorService {
  constructor(
    private readonly baseDir: string,
    private readonly pollIntervalSeconds: number,
    private readonly retentionDays: number,
    private readonly watchlistService: WatchlistService,
    private readonly jin10McpService: Jin10McpService,
    private readonly analysisService: AnalysisService,
    private readonly alertService: AlertService,
    private readonly flashRepository: Jin10FlashRepository,
    private readonly flashDeliveryRepository: Jin10FlashDeliveryRepository,
  ) {}

  async runMonitorOnce(): Promise<number> {
    const now = formatChinaDateTime();
    const state = await this.readState();
    const latestStored = state.lastSeenKey ? null : await this.flashRepository.getLatest();
    const anchorKey = state.lastSeenKey ?? latestStored?.flash_key ?? null;
    const anchorPublishedAt = state.lastSeenPublishedAt ?? latestStored?.published_at ?? null;
    const anchorUrl = state.lastSeenUrl ?? latestStored?.url ?? null;

    if (!this.jin10McpService.isConfigured()) {
      await this.writeState({
        ...state,
        initialized: state.initialized || Boolean(anchorKey),
        lastSeenKey: anchorKey,
        lastSeenPublishedAt: anchorPublishedAt,
        lastSeenUrl: anchorUrl,
        backfillCursor: state.backfillCursor,
        lastPollAt: now,
        lastPollStored: 0,
        lastPollCandidates: 0,
        lastPollAlerts: 0,
        lastLoopError: null,
        lastLoopErrorAt: null,
      });
      return 0;
    }

    if (!anchorKey && !state.initialized) {
      const seed = await this.fetchLatestFlashes(INITIAL_SEED_PAGES, null);
      const saveResult = await this.flashRepository.saveAll(seed.items);
      const nextState: FlashMonitorState = {
        ...state,
        initialized: true,
        lastSeenKey: seed.latest?.flash_key ?? null,
        lastSeenPublishedAt: seed.latest?.published_at ?? null,
        lastSeenUrl: seed.latest?.url ?? null,
        backfillCursor: null,
        lastPollAt: now,
        lastPollStored: saveResult.added,
        lastPollCandidates: 0,
        lastPollAlerts: 0,
        lastLoopError: null,
        lastLoopErrorAt: null,
      };
      await this.writeState(nextState);
      await this.maybePruneExpired(nextState);
      return 0;
    }

    const fetchResult = await this.fetchLatestFlashes(MAX_FLASH_PAGES_PER_POLL, anchorKey);
    const backfillCursor = state.backfillCursor ?? fetchResult.nextCursor;
    const backfillResult = backfillCursor
      ? await this.fetchFlashesByCursor(MAX_FLASH_PAGES_PER_POLL, backfillCursor)
      : null;

    const allFetchedItems = mergeFlashRecords(fetchResult.items, backfillResult?.items ?? []);
    const saveResult = await this.flashRepository.saveAll(allFetchedItems);
    const newItemKeys = new Set(saveResult.addedKeys);
    const newItems = allFetchedItems.filter((item) => newItemKeys.has(item.flash_key));
    const watchlist = await this.watchlistService.list();
    const candidates = watchlist.length > 0
      ? buildStageOneCandidates(newItems, watchlist)
      : [];

    let alertCount = 0;
    for (const candidate of candidates) {
      alertCount += await this.handleCandidate(candidate);
    }

    const nextState: FlashMonitorState = {
      ...state,
      initialized: true,
      lastSeenKey: fetchResult.latest?.flash_key ?? anchorKey,
      lastSeenPublishedAt: fetchResult.latest?.published_at ?? anchorPublishedAt,
      lastSeenUrl: fetchResult.latest?.url ?? anchorUrl,
      backfillCursor: backfillResult?.nextCursor ?? backfillCursor ?? null,
      lastPollAt: now,
      lastPollStored: saveResult.added,
      lastPollCandidates: candidates.length,
      lastPollAlerts: alertCount,
      lastLoopError: null,
      lastLoopErrorAt: null,
    };
    await this.writeState(nextState);
    await this.maybePruneExpired(nextState);
    return alertCount;
  }

  async getStatusReport(): Promise<string> {
    const [state, latest] = await Promise.all([
      this.readState(),
      this.flashRepository.getLatest(),
    ]);
    const configError = this.jin10McpService.getConfigurationError();
    const dayStart = `${chinaToday()} 00:00:00`;
    const dayStartTs = toChinaTimeTimestamp(dayStart);
    const [storedToday, alertsToday, watchlist] = await Promise.all([
      this.flashRepository.countSincePublishedTs(dayStartTs),
      this.flashDeliveryRepository.countSinceDeliveredAt(dayStart),
      this.watchlistService.list(),
    ]);

    const lines = [
      "📰 Jin10 快讯监控状态",
      `状态: ${configError ? `未配置（${configError}）` : "后台轮询中"}`,
      `轮询间隔: ${this.pollIntervalSeconds} 秒`,
      `保留天数: ${this.retentionDays} 天`,
      `关注列表: ${watchlist.length}只`,
      `最近心跳: ${state.lastHeartbeatAt ?? "暂无"}`,
      `最近轮询: ${state.lastPollAt ?? "暂无"}`,
      `最近一轮: 入库 ${state.lastPollStored} 条 | 候选 ${state.lastPollCandidates} 条 | 告警 ${state.lastPollAlerts} 条`,
      `今日统计: 入库 ${storedToday} 条 | 告警 ${alertsToday} 条`,
      `续页补齐: ${state.backfillCursor ? "进行中" : "空闲"}`,
      `最近清理: ${state.lastPrunedAt ?? "暂无"}`,
    ];

    if (state.lastLoopError) {
      lines.push(`最近异常: ${state.lastLoopErrorAt ?? "未知时间"} | ${state.lastLoopError}`);
    }

    if (latest) {
      lines.push(
        "",
        "最新快讯:",
        `• 时间: ${latest.published_at}`,
        `• 链接: ${latest.url}`,
        `• 正文: ${truncate(latest.content, 140)}`,
      );
    }

    return lines.join("\n");
  }

  async getState(): Promise<FlashMonitorState> {
    return this.readState();
  }

  async recordHeartbeat(
    runtimeHost?: "plugin_service" | "fallback_process",
  ): Promise<void> {
    const state = await this.readState();
    const now = formatChinaDateTime();
    await this.writeState({
      ...state,
      lastHeartbeatAt: now,
      runtimeHost: runtimeHost ?? state.runtimeHost,
      runtimeObservedAt: now,
    });
  }

  async recordLoopError(error: unknown): Promise<void> {
    const state = await this.readState();
    const message = error instanceof Error ? error.message : String(error);
    await this.writeState({
      ...state,
      lastLoopError: message,
      lastLoopErrorAt: formatChinaDateTime(),
    });
  }

  private async handleCandidate(candidate: StageOneCandidate): Promise<number> {
    if (await this.flashDeliveryRepository.hasDelivered(candidate.flash.flash_key)) {
      return 0;
    }

    const decision = await this.decideAlert(candidate);
    if (!decision.alert) {
      return 0;
    }

    const symbols = resolveRelevantSymbols(decision.relevantSymbols, candidate.matches);
    if (symbols.length === 0) {
      return 0;
    }

    const message = buildAlertMessage(candidate.flash, candidate.matches, decision, symbols, this.alertService);
    const result = await this.alertService.sendWithResult(message);
    if (!result.ok) {
      return 0;
    }

    const entry: Jin10FlashDeliveryEntry = {
      flash_key: candidate.flash.flash_key,
      published_at: candidate.flash.published_at,
      symbols,
      headline: decision.headline || "Jin10快讯命中自选",
      reason: decision.reason || "快讯与当前关注标的相关，建议尽快核实。",
      importance: decision.importance,
      message,
      delivered_at: formatChinaDateTime(),
    };
    await this.flashDeliveryRepository.append(entry);
    return 1;
  }

  private async decideAlert(candidate: StageOneCandidate): Promise<FlashAlertDecision> {
    if (!this.analysisService.isConfigured()) {
      return buildFallbackDecision(candidate);
    }

    try {
      const responseText = await this.analysisService.generateText(
        FLASH_MONITOR_ALERT_SYSTEM_PROMPT,
        buildFlashMonitorAlertUserPrompt({
          flash: candidate.flash,
          candidates: candidate.matches,
        }),
        {
          maxTokens: 600,
          temperature: 0.1,
        },
      );
      const parsed = parseFlashAlertDecision(responseText);
      return {
        alert: parsed.alert,
        importance: parsed.importance,
        relevantSymbols: parsed.relevantSymbols,
        headline: parsed.headline,
        reason: parsed.reason,
      };
    } catch {
      return buildFallbackDecision(candidate);
    }
  }

  private async fetchLatestFlashes(maxPages: number, anchorKey: string | null): Promise<FlashFetchResult> {
    const collected: Jin10FlashRecord[] = [];
    let latest: Jin10FlashRecord | null = null;
    let cursor: string | undefined;

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const page = await this.jin10McpService.listFlash(cursor);
      const pageEntries = page.items
        .map((item) => toFlashRecord(item))
        .filter((item): item is Jin10FlashRecord => item != null);

      if (pageEntries.length === 0) {
        break;
      }
      if (!latest) {
        latest = pageEntries[0];
      }

      if (anchorKey) {
        const anchorIndex = pageEntries.findIndex((entry) => entry.flash_key === anchorKey);
        if (anchorIndex >= 0) {
          collected.push(...pageEntries.slice(0, anchorIndex));
          return {
            items: sortFlashRecords(collected),
            latest,
            nextCursor: null,
          };
        }
      }

      collected.push(...pageEntries);
      if (!page.hasMore || !page.nextCursor) {
        return {
          items: sortFlashRecords(collected),
          latest,
          nextCursor: null,
        };
      }
      if (pageIndex === maxPages - 1) {
        return {
          items: sortFlashRecords(collected),
          latest,
          nextCursor: page.nextCursor,
        };
      }
      cursor = page.nextCursor;
    }

    return {
      items: sortFlashRecords(collected),
      latest,
      nextCursor: null,
    };
  }

  private async fetchFlashesByCursor(maxPages: number, initialCursor: string): Promise<FlashFetchResult> {
    const collected: Jin10FlashRecord[] = [];
    let cursor: string | undefined = initialCursor;

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      if (!cursor) {
        break;
      }

      const page = await this.jin10McpService.listFlash(cursor);
      const pageEntries = page.items
        .map((item) => toFlashRecord(item))
        .filter((item): item is Jin10FlashRecord => item != null);

      if (pageEntries.length > 0) {
        collected.push(...pageEntries);
      }

      if (!page.hasMore || !page.nextCursor) {
        return {
          items: sortFlashRecords(collected),
          latest: null,
          nextCursor: null,
        };
      }
      if (pageIndex === maxPages - 1) {
        return {
          items: sortFlashRecords(collected),
          latest: null,
          nextCursor: page.nextCursor,
        };
      }
      cursor = page.nextCursor;
    }

    return {
      items: sortFlashRecords(collected),
      latest: null,
      nextCursor: cursor ?? null,
    };
  }

  private async maybePruneExpired(state: FlashMonitorState): Promise<void> {
    const now = Date.now();
    const lastPrunedAt = parseChinaTime(state.lastPrunedAt)?.getTime() ?? 0;
    if (now - lastPrunedAt < PRUNE_INTERVAL_MS) {
      return;
    }

    const cutoffTs = now - this.retentionDays * 24 * 60 * 60 * 1000;
    const cutoffLabel = formatChinaDateTime(new Date(cutoffTs));
    await Promise.all([
      this.flashRepository.pruneOlderThanPublishedTs(cutoffTs),
      this.flashDeliveryRepository.pruneOlderThanDeliveredAt(cutoffLabel),
    ]);
    await this.writeState({
      ...state,
      lastPrunedAt: formatChinaDateTime(),
    });
  }

  private async readState(): Promise<FlashMonitorState> {
    const file = this.getStateFilePath();
    try {
      const raw = await readFile(file, "utf-8");
      return { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<FlashMonitorState>) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ...DEFAULT_STATE };
      }
      throw error;
    }
  }

  private async writeState(state: FlashMonitorState): Promise<void> {
    const file = this.getStateFilePath();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(state, null, 2), "utf-8");
  }

  private getStateFilePath(): string {
    return path.join(this.baseDir, "jin10-flash-monitor-state.json");
  }
}

function buildStageOneCandidates(flashes: Jin10FlashRecord[], watchlist: WatchlistItem[]): StageOneCandidate[] {
  return flashes
    .filter((flash) => !shouldIgnoreFlash(flash.content))
    .map((flash) => buildStageOneCandidate(flash, watchlist))
    .filter((candidate): candidate is StageOneCandidate => candidate != null);
}

function mergeFlashRecords(...groups: Jin10FlashRecord[][]): Jin10FlashRecord[] {
  const merged: Jin10FlashRecord[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const item of group) {
      if (!item.flash_key || seen.has(item.flash_key)) {
        continue;
      }
      seen.add(item.flash_key);
      merged.push(item);
    }
  }

  return sortFlashRecords(merged);
}

function sortFlashRecords(entries: Jin10FlashRecord[]): Jin10FlashRecord[] {
  return [...entries].sort((left, right) => left.published_ts - right.published_ts);
}

function buildStageOneCandidate(flash: Jin10FlashRecord, watchlist: WatchlistItem[]): StageOneCandidate | null {
  const normalizedContent = normalizeText(flash.content);
  const matches: StageOneMatch[] = [];

  for (const item of watchlist) {
    const directKeywords = buildDirectKeywords(item)
      .filter((keyword) => normalizedContent.includes(normalizeText(keyword)));
    const boardKeywords = buildBoardKeywords(item)
      .filter((keyword) => normalizedContent.includes(normalizeText(keyword)));

    if (directKeywords.length === 0 && boardKeywords.length === 0) {
      continue;
    }

    matches.push({
      item,
      directKeywords,
      boardKeywords,
    });
  }

  if (matches.length === 0) {
    return null;
  }
  return {
    flash,
    matches,
  };
}

function buildDirectKeywords(item: WatchlistItem): string[] {
  const keywords = [item.symbol, item.name];
  return uniqueStrings(keywords);
}

function buildBoardKeywords(item: WatchlistItem): string[] {
  return uniqueStrings([
    item.sector ?? "",
    ...item.themes,
  ]).filter((keyword) => isUsefulBoardKeyword(keyword));
}

function isUsefulBoardKeyword(value: string): boolean {
  const normalized = value.replace(/\s+/g, "").trim();
  if (normalized.length < 2) {
    return false;
  }
  return !/(行业|板块|题材|概念|个股|公司|市场|资讯|公告|快讯|新闻|政策)$/.test(normalized);
}

function shouldIgnoreFlash(content: string): boolean {
  const text = content.trim();
  return NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

function buildFallbackDecision(candidate: StageOneCandidate): FlashAlertDecision {
  const directSymbols = candidate.matches
    .filter((match) => match.directKeywords.length > 0)
    .map((match) => match.item.symbol);

  if (directSymbols.length === 0) {
    return {
      alert: false,
      importance: "low",
      relevantSymbols: [],
      headline: "",
      reason: "",
    };
  }

  return {
    alert: true,
    importance: inferImportance(candidate.flash.content),
    relevantSymbols: uniqueStrings(directSymbols),
    headline: "Jin10快讯直接命中自选股",
    reason: "快讯直接提及关注股票/公司，建议尽快核实公告、消息来源与盘面反馈。",
  };
}

function resolveRelevantSymbols(llmSymbols: string[], matches: StageOneMatch[]): string[] {
  const available = new Set(matches.map((match) => match.item.symbol));
  const directSymbols = matches
    .filter((match) => match.directKeywords.length > 0)
    .map((match) => match.item.symbol);
  const normalized = uniqueStrings(llmSymbols).filter((symbol) => available.has(symbol));
  if (normalized.length > 0) {
    return normalized;
  }
  if (directSymbols.length > 0) {
    return uniqueStrings(directSymbols);
  }
  return uniqueStrings(matches.map((match) => match.item.symbol));
}

function buildAlertMessage(
  flash: Jin10FlashRecord,
  matches: StageOneMatch[],
  decision: FlashAlertDecision,
  symbols: string[],
  alertService: AlertService,
): string {
  const symbolLabels = symbols.map((symbol) => {
    const matched = matches.find((entry) => entry.item.symbol === symbol);
    return matched ? `${matched.item.name}（${matched.item.symbol}）` : symbol;
  });
  return alertService.formatSystemNotification(
    `📰 ${decision.headline || "Jin10快讯命中自选"}`,
    [
      `时间: ${flash.published_at}`,
      `级别: ${formatImportance(decision.importance)}`,
      `关联: ${symbolLabels.join("、")}`,
      `判断: ${decision.reason || "快讯与当前关注标的相关，建议尽快核实。"}`,
      `快讯: ${truncate(flash.content, 260)}`,
      `来源: ${flash.url}`,
    ],
  );
}

function toFlashRecord(item: { content: string; time: string; url: string; raw: Record<string, unknown> }): Jin10FlashRecord | null {
  const published = new Date(item.time);
  if (Number.isNaN(published.getTime())) {
    return null;
  }

  const publishedAt = formatChinaDateTime(published);
  return {
    flash_key: buildFlashKey(item.url, item.time, item.content),
    published_at: publishedAt,
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

function inferImportance(content: string): "high" | "medium" | "low" {
  return HIGH_IMPORTANCE_KEYWORDS.some((keyword) => content.includes(keyword))
    ? "high"
    : "medium";
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.replace(/\s+/g, "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function formatImportance(value: "high" | "medium" | "low"): string {
  switch (value) {
    case "high":
      return "高";
    case "low":
      return "低";
    default:
      return "中";
  }
}

function parseChinaTime(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const candidate = /([+-]\d{2}:\d{2}|Z)$/.test(normalized)
    ? normalized.replace(" ", "T")
    : `${normalized.replace(" ", "T")}+08:00`;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toChinaTimeTimestamp(value: string): number {
  return parseChinaTime(value)?.getTime() ?? Date.now();
}
