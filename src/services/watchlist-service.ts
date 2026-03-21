import type { WatchlistItem } from "../types/domain.js";
import { formatChinaDateTime } from "../utils/china-time.js";
import { normalizeSymbol } from "../utils/symbol.js";
import { InstrumentService } from "./instrument-service.js";
import { WatchlistRepository } from "../storage/repositories/watchlist-repo.js";
import { WatchlistProfileService } from "./watchlist-profile-service.js";

const CONCEPT_BOARD_REFRESH_DAYS = 5;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface GetWatchlistItemOptions {
  refreshConceptBoards?: boolean;
}

export interface RefreshWatchlistProfilesOptions {
  symbol?: string;
  force?: boolean;
}

export interface WatchlistProfileRefreshFailure {
  symbol: string;
  name: string;
  error: string;
}

export interface RefreshWatchlistProfilesResult {
  targetCount: number;
  updated: WatchlistItem[];
  rechecked: WatchlistItem[];
  failed: WatchlistProfileRefreshFailure[];
}

type RefreshConceptProfileStatus = "updated" | "rechecked" | "skipped";

interface RefreshConceptProfileResult {
  item: WatchlistItem;
  status: RefreshConceptProfileStatus;
}

export class WatchlistService {
  constructor(
    private readonly repository: WatchlistRepository,
    private readonly instrumentService: InstrumentService,
    private readonly watchlistProfileService: WatchlistProfileService | null = null,
  ) {}

  async add(symbolInput: string, costPrice: number): Promise<WatchlistItem> {
    const symbol = normalizeSymbol(symbolInput);
    const existing = await this.getBySymbol(symbol);
    const name = await this.instrumentService.resolveName(symbol);
    const addedAt = formatChinaDateTime();
    const profile = this.watchlistProfileService
      ? await this.watchlistProfileService.resolve(symbol, name, addedAt)
      : {
        sector: null,
        themes: [],
        themeQuery: null,
        themeUpdatedAt: null,
      };

    const item: WatchlistItem = {
      symbol,
      name,
      costPrice,
      addedAt,
      sector: profile.sector ?? existing?.sector ?? null,
      themes: profile.themes.length > 0 ? profile.themes : (existing?.themes ?? []),
      themeQuery: profile.themeQuery ?? existing?.themeQuery ?? null,
      themeUpdatedAt: profile.themeUpdatedAt ?? existing?.themeUpdatedAt ?? null,
    };
    await this.repository.upsert(item);
    return item;
  }

  async list(): Promise<WatchlistItem[]> {
    return this.repository.list();
  }

  async remove(symbolInput: string): Promise<boolean> {
    const symbol = normalizeSymbol(symbolInput);
    return this.repository.remove(symbol);
  }

  async getBySymbol(symbolInput: string, options: GetWatchlistItemOptions = {}): Promise<WatchlistItem | null> {
    const symbol = normalizeSymbol(symbolInput);
    const items = await this.repository.list();
    const item = items.find((entry) => entry.symbol === symbol) ?? null;
    if (!item || !options.refreshConceptBoards) {
      return item;
    }

    const result = await this.refreshConceptProfile(item, { force: false });
    return result.item;
  }

  async refreshProfiles(
    options: RefreshWatchlistProfilesOptions = {},
  ): Promise<RefreshWatchlistProfilesResult> {
    const items = await this.repository.list();
    const targetSymbol = options.symbol ? normalizeSymbol(options.symbol) : null;
    const targets = targetSymbol
      ? items.filter((item) => item.symbol === targetSymbol)
      : items;

    const result: RefreshWatchlistProfilesResult = {
      targetCount: targets.length,
      updated: [],
      rechecked: [],
      failed: [],
    };

    if (targets.length === 0) {
      return result;
    }

    if (!this.watchlistProfileService) {
      result.failed = targets.map((item) => ({
        symbol: item.symbol,
        name: item.name,
        error: "watchlist profile service unavailable",
      }));
      return result;
    }

    const force = options.force ?? true;
    for (const item of targets) {
      try {
        const refreshed = await this.refreshConceptProfile(item, { force });
        if (refreshed.status === "updated") {
          result.updated.push(refreshed.item);
          continue;
        }
        if (refreshed.status === "rechecked") {
          result.rechecked.push(refreshed.item);
        }
      } catch (error) {
        result.failed.push({
          symbol: item.symbol,
          name: item.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  async refreshNames(): Promise<{
    updated: WatchlistItem[];
    unchanged: WatchlistItem[];
  }> {
    const items = await this.repository.list();
    const updated: WatchlistItem[] = [];
    const unchanged: WatchlistItem[] = [];

    for (const item of items) {
      const nextName = await this.instrumentService.resolveName(item.symbol);
      const normalizedCurrent = sanitizeName(item.name, item.symbol);
      if (normalizedCurrent === nextName) {
        unchanged.push({ ...item, name: normalizedCurrent });
        continue;
      }

      const nextItem = { ...item, name: nextName };
      await this.repository.upsert(nextItem);
      updated.push(nextItem);
    }

    return { updated, unchanged };
  }

  private async refreshConceptProfile(
    item: WatchlistItem,
    options: { force: boolean },
  ): Promise<RefreshConceptProfileResult> {
    if (!this.watchlistProfileService) {
      return { item, status: "skipped" };
    }
    if (!options.force && !shouldRefreshConceptBoards(item)) {
      return { item, status: "skipped" };
    }

    const refreshedAt = formatChinaDateTime();
    const profile = await this.watchlistProfileService.resolve(item.symbol, item.name, refreshedAt);
    const nextItem: WatchlistItem = {
      ...item,
      sector: profile.sector ?? item.sector ?? null,
      themes: profile.themes.length > 0 ? profile.themes : item.themes,
      themeQuery: profile.themeQuery ?? item.themeQuery ?? null,
      themeUpdatedAt: profile.themeUpdatedAt ?? item.themeUpdatedAt ?? null,
    };

    const profileChanged = !hasSameConceptProfileContent(item, nextItem);
    const timestampChanged = item.themeUpdatedAt !== nextItem.themeUpdatedAt;
    if (profileChanged || timestampChanged) {
      await this.repository.upsert(nextItem);
    }

    return {
      item: profileChanged || timestampChanged ? nextItem : item,
      status: profileChanged ? "updated" : "rechecked",
    };
  }
}

function shouldRefreshConceptBoards(item: WatchlistItem): boolean {
  if (!item.sector || item.themes.length === 0 || !item.themeUpdatedAt) {
    return true;
  }

  const updatedAt = parseChinaTimestamp(item.themeUpdatedAt);
  if (updatedAt == null) {
    return true;
  }

  return Date.now() - updatedAt >= CONCEPT_BOARD_REFRESH_DAYS * ONE_DAY_MS;
}

function parseChinaTimestamp(value: string): number | null {
  const text = value.trim();
  if (!text) {
    return null;
  }
  const isoLike = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(" ", "T")}+08:00`
    : text;
  const timestamp = Date.parse(isoLike);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hasSameConceptProfileContent(left: WatchlistItem, right: WatchlistItem): boolean {
  return left.sector === right.sector
    && left.themeQuery === right.themeQuery
    && left.themes.length === right.themes.length
    && left.themes.every((value, index) => value === right.themes[index]);
}

function sanitizeName(name: string, symbol: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) {
    return symbol;
  }
  if (trimmed === symbol) {
    return symbol;
  }
  if (trimmed.includes("http://") || trimmed.includes("https://")) {
    return symbol;
  }
  return trimmed;
}
