import type { KeyLevelsHistoryEntry } from "../../types/domain.js";
import type { DbRow } from "../db.js";
import { Database } from "../db.js";
import { keyLevelsHistorySchema } from "../schemas.js";

const KEY_LEVELS_HISTORY_TABLE = "key_levels_history";

export class KeyLevelsHistoryRepository {
  constructor(private readonly db: Database) {}

  async saveDailySnapshot(entry: KeyLevelsHistoryEntry): Promise<void> {
    const row = toKeyLevelsHistoryRow(entry);
    if (!(await this.db.hasTable(KEY_LEVELS_HISTORY_TABLE))) {
      await this.db.createTable(KEY_LEVELS_HISTORY_TABLE, [row], keyLevelsHistorySchema);
      return;
    }

    const table = await this.db.openTable(KEY_LEVELS_HISTORY_TABLE);
    await table.delete(
      `symbol = '${escapeSqlString(entry.symbol)}' and analysis_date = '${escapeSqlString(entry.analysis_date)}'`,
    );
    await table.add([row]);
  }

  async listBySymbol(symbol: string, limit?: number): Promise<KeyLevelsHistoryEntry[]> {
    if (!(await this.db.hasTable(KEY_LEVELS_HISTORY_TABLE))) {
      return [];
    }

    const table = await this.db.openTable(KEY_LEVELS_HISTORY_TABLE);
    const rows = (await table
      .query()
      .where(`symbol = '${escapeSqlString(symbol)}'`)
      .toArray()) as Array<Record<string, unknown>>;
    return limitRows(rows, limit).map(fromKeyLevelsHistoryRow);
  }

  async listLatest(limit?: number): Promise<KeyLevelsHistoryEntry[]> {
    if (!(await this.db.hasTable(KEY_LEVELS_HISTORY_TABLE))) {
      return [];
    }

    const table = await this.db.openTable(KEY_LEVELS_HISTORY_TABLE);
    const rows = (await table.query().toArray()) as Array<Record<string, unknown>>;
    return limitRows(rows, limit).map(fromKeyLevelsHistoryRow);
  }
}

function limitRows(rows: Array<Record<string, unknown>>, limit?: number): Array<Record<string, unknown>> {
  const normalized = limit == null ? rows.length : Math.max(1, Math.trunc(limit));
  return rows.slice(-normalized).reverse();
}

function toKeyLevelsHistoryRow(entry: KeyLevelsHistoryEntry): DbRow {
  return {
    symbol: entry.symbol,
    analysis_date: entry.analysis_date,
    activated_at: entry.activated_at,
    profile: entry.profile,
    current_price: entry.current_price,
    stop_loss: entry.stop_loss,
    breakthrough: entry.breakthrough,
    support: entry.support,
    cost_level: entry.cost_level,
    resistance: entry.resistance,
    take_profit: entry.take_profit,
    gap: entry.gap,
    target: entry.target,
    round_number: entry.round_number,
    analysis_text: entry.analysis_text,
    score: entry.score == null ? null : Math.trunc(entry.score),
  };
}

function fromKeyLevelsHistoryRow(row: Record<string, unknown>): KeyLevelsHistoryEntry {
  return {
    symbol: String(row.symbol),
    analysis_date: String(row.analysis_date),
    activated_at: String(row.activated_at ?? ""),
    profile: "composite",
    current_price: toNullableNumber(row.current_price),
    stop_loss: toNullableNumber(row.stop_loss),
    breakthrough: toNullableNumber(row.breakthrough),
    support: toNullableNumber(row.support),
    cost_level: toNullableNumber(row.cost_level),
    resistance: toNullableNumber(row.resistance),
    take_profit: toNullableNumber(row.take_profit),
    gap: toNullableNumber(row.gap),
    target: toNullableNumber(row.target),
    round_number: toNullableNumber(row.round_number),
    analysis_text: String(row.analysis_text ?? ""),
    score: toNullableNumber(row.score),
  };
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}
