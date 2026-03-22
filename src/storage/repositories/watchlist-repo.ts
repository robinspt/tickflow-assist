import type { WatchlistItem } from "../../types/domain.js";
import { Database, type DbRow } from "../db.js";
import { watchlistSchema } from "../schemas.js";
import { normalizeCostPrice } from "../../utils/cost-price.js";

const WATCHLIST_TABLE = "watchlist";

export class WatchlistRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<WatchlistItem[]> {
    await this.ensureSchema();
    const items = await this.db.tableToArray<WatchlistItem>(WATCHLIST_TABLE);
    return items
      .map((item) => ({
        symbol: String(item.symbol),
        name: String(item.name ?? ""),
        costPrice: normalizeCostPrice(item.costPrice),
        addedAt: String(item.addedAt ?? ""),
        sector: normalizeNullableString(item.sector),
        themes: parseThemes(item.themes),
        themeQuery: normalizeNullableString(item.themeQuery),
        themeUpdatedAt: normalizeNullableString(item.themeUpdatedAt),
      }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  async upsert(item: WatchlistItem): Promise<void> {
    const row = toWatchlistRow(item);

    if (!(await this.db.hasTable(WATCHLIST_TABLE))) {
      await this.db.createTable(WATCHLIST_TABLE, [row], watchlistSchema);
      return;
    }

    await this.ensureSchema();
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

  private async ensureSchema(): Promise<void> {
    if (!(await this.db.hasTable(WATCHLIST_TABLE))) {
      return;
    }

    const fields = await this.db.describeTable(WATCHLIST_TABLE);
    const fieldNames = new Set(fields.map((field) => field.name));
    const missingColumns: Array<{ name: string; valueSql: string }> = [];

    if (!fieldNames.has("sector")) {
      missingColumns.push({ name: "sector", valueSql: "''" });
    }
    if (!fieldNames.has("themes")) {
      missingColumns.push({ name: "themes", valueSql: "'[]'" });
    }
    if (!fieldNames.has("themeQuery")) {
      missingColumns.push({ name: "themeQuery", valueSql: "''" });
    }
    if (!fieldNames.has("themeUpdatedAt")) {
      missingColumns.push({ name: "themeUpdatedAt", valueSql: "''" });
    }

    if (missingColumns.length === 0) {
      return;
    }

    const table = await this.db.openTable(WATCHLIST_TABLE);
    await table.addColumns(missingColumns);
  }
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function toWatchlistRow(item: WatchlistItem): DbRow {
  return {
    symbol: item.symbol,
    name: item.name,
    costPrice: item.costPrice ?? 0,
    addedAt: item.addedAt,
    sector: item.sector ?? "",
    themes: JSON.stringify(item.themes),
    themeQuery: item.themeQuery ?? "",
    themeUpdatedAt: item.themeUpdatedAt ?? "",
  };
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text || null;
}

function parseThemes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }
  if (typeof value !== "string") {
    return [];
  }

  const text = value.trim();
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item ?? "").trim())
        .filter(Boolean);
    }
  } catch {
    // Fall back to delimiter parsing for legacy rows.
  }

  return text
    .split(/[、,，;；|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
