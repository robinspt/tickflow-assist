import type { WatchlistItem } from "../../types/domain.js";
import { Database, type DbRow } from "../db.js";
import { watchlistSchema } from "../schemas.js";

const WATCHLIST_TABLE = "watchlist";

export class WatchlistRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<WatchlistItem[]> {
    const items = await this.db.tableToArray<WatchlistItem>(WATCHLIST_TABLE);
    return items
      .map((item) => ({
        symbol: String(item.symbol),
        name: String(item.name ?? ""),
        costPrice: Number(item.costPrice),
        addedAt: String(item.addedAt ?? ""),
      }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  async upsert(item: WatchlistItem): Promise<void> {
    const row = toWatchlistRow(item);

    if (!(await this.db.hasTable(WATCHLIST_TABLE))) {
      await this.db.createTable(WATCHLIST_TABLE, [row], watchlistSchema);
      return;
    }

    const table = await this.db.openTable(WATCHLIST_TABLE);
    await table.delete(`symbol = '${escapeSqlString(item.symbol)}'`);
    await table.add([row]);
  }

  async remove(symbol: string): Promise<boolean> {
    if (!(await this.db.hasTable(WATCHLIST_TABLE))) {
      return false;
    }

    const table = await this.db.openTable(WATCHLIST_TABLE);
    const countBefore = await table.countRows(`symbol = '${escapeSqlString(symbol)}'`);
    if (countBefore === 0) {
      return false;
    }

    await table.delete(`symbol = '${escapeSqlString(symbol)}'`);
    return true;
  }
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function toWatchlistRow(item: WatchlistItem): DbRow {
  return {
    symbol: item.symbol,
    name: item.name,
    costPrice: item.costPrice,
    addedAt: item.addedAt,
  };
}
