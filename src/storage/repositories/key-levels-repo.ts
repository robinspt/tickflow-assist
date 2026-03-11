import type { DbRow } from "../db.js";
import { Database } from "../db.js";
import { keyLevelsSchema } from "../schemas.js";
import type { KeyLevels } from "../../types/domain.js";

const KEY_LEVELS_TABLE = "key_levels";

export class KeyLevelsRepository {
  constructor(private readonly db: Database) {}

  async save(symbol: string, levels: KeyLevels): Promise<void> {
    const row = toKeyLevelsRow(symbol, levels);
    if (!(await this.db.hasTable(KEY_LEVELS_TABLE))) {
      await this.db.createTable(KEY_LEVELS_TABLE, [row], keyLevelsSchema);
      return;
    }

    const table = await this.db.openTable(KEY_LEVELS_TABLE);
    await table.delete(`symbol = '${escapeSqlString(symbol)}'`);
    await table.add([row]);
  }

  async getBySymbol(symbol: string): Promise<KeyLevels | null> {
    if (!(await this.db.hasTable(KEY_LEVELS_TABLE))) {
      return null;
    }

    const table = await this.db.openTable(KEY_LEVELS_TABLE);
    const rows = (await table
      .query()
      .where(`symbol = '${escapeSqlString(symbol)}'`)
      .toArray()) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      return null;
    }

    const row = rows[rows.length - 1];
    return {
      symbol: String(row.symbol),
      analysis_date: String(row.analysis_date),
      current_price: Number(row.current_price),
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
      score: Number(row.score ?? 0),
    };
  }
}

function toKeyLevelsRow(symbol: string, levels: KeyLevels): DbRow {
  return {
    symbol,
    analysis_date: levels.analysis_date ?? "",
    current_price: levels.current_price,
    stop_loss: levels.stop_loss ?? null,
    breakthrough: levels.breakthrough ?? null,
    support: levels.support ?? null,
    cost_level: levels.cost_level ?? null,
    resistance: levels.resistance ?? null,
    take_profit: levels.take_profit ?? null,
    gap: levels.gap ?? null,
    target: levels.target ?? null,
    round_number: levels.round_number ?? null,
    analysis_text: levels.analysis_text,
    score: levels.score,
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
