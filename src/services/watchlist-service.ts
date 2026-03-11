import type { WatchlistItem } from "../types/domain.js";
import { formatChinaDateTime } from "../utils/china-time.js";
import { normalizeSymbol } from "../utils/symbol.js";
import { InstrumentService } from "./instrument-service.js";
import { WatchlistRepository } from "../storage/repositories/watchlist-repo.js";

export class WatchlistService {
  constructor(
    private readonly repository: WatchlistRepository,
    private readonly instrumentService: InstrumentService,
  ) {}

  async add(symbolInput: string, costPrice: number): Promise<WatchlistItem> {
    const symbol = normalizeSymbol(symbolInput);
    const name = await this.instrumentService.resolveName(symbol);
    const item: WatchlistItem = {
      symbol,
      name,
      costPrice,
      addedAt: formatChinaDateTime(),
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

  async getBySymbol(symbolInput: string): Promise<WatchlistItem | null> {
    const symbol = normalizeSymbol(symbolInput);
    const items = await this.repository.list();
    return items.find((item) => item.symbol === symbol) ?? null;
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
