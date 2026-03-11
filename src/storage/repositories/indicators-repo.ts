import type { DbRow } from "../db.js";
import { Database } from "../db.js";
import { indicatorsSchema } from "../schemas.js";
import type { IndicatorRow } from "../../types/indicator.js";

const INDICATORS_TABLE = "indicators";

export class IndicatorsRepository {
  constructor(private readonly db: Database) {}

  async saveAll(symbol: string, rows: IndicatorRow[]): Promise<void> {
    const dbRows = rows.map((row) => toIndicatorRow(symbol, row));

    if (!(await this.db.hasTable(INDICATORS_TABLE))) {
      await this.db.createTable(INDICATORS_TABLE, dbRows, indicatorsSchema);
      return;
    }

    const table = await this.db.openTable(INDICATORS_TABLE);
    await table.delete(`symbol = '${escapeSqlString(symbol)}'`);
    if (dbRows.length > 0) {
      await table.add(dbRows);
    }
  }

  async listBySymbol(symbol: string): Promise<IndicatorRow[]> {
    if (!(await this.db.hasTable(INDICATORS_TABLE))) {
      return [];
    }

    const table = await this.db.openTable(INDICATORS_TABLE);
    const rows = (await table
      .query()
      .where(`symbol = '${escapeSqlString(symbol)}'`)
      .toArray()) as Array<Record<string, unknown>>;

    return rows
      .map((row) => ({
        symbol: String(row.symbol),
        trade_date: String(row.trade_date),
        ma5: toNullableNumber(row.ma5),
        ma10: toNullableNumber(row.ma10),
        ma20: toNullableNumber(row.ma20),
        ma60: toNullableNumber(row.ma60),
        macd: toNullableNumber(row.macd),
        macd_signal: toNullableNumber(row.macd_signal),
        macd_hist: toNullableNumber(row.macd_hist),
        kdj_k: toNullableNumber(row.kdj_k),
        kdj_d: toNullableNumber(row.kdj_d),
        kdj_j: toNullableNumber(row.kdj_j),
        rsi_6: toNullableNumber(row.rsi_6),
        rsi_12: toNullableNumber(row.rsi_12),
        rsi_24: toNullableNumber(row.rsi_24),
        cci: toNullableNumber(row.cci),
        bias_6: toNullableNumber(row.bias_6),
        bias_12: toNullableNumber(row.bias_12),
        bias_24: toNullableNumber(row.bias_24),
        plus_di: toNullableNumber(row.plus_di),
        minus_di: toNullableNumber(row.minus_di),
        adx: toNullableNumber(row.adx),
        boll_upper: toNullableNumber(row.boll_upper),
        boll_mid: toNullableNumber(row.boll_mid),
        boll_lower: toNullableNumber(row.boll_lower),
      }))
      .sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  }
}

function toIndicatorRow(symbol: string, row: IndicatorRow): DbRow {
  return {
    symbol,
    trade_date: row.trade_date,
    ma5: row.ma5 ?? null,
    ma10: row.ma10 ?? null,
    ma20: row.ma20 ?? null,
    ma60: row.ma60 ?? null,
    macd: row.macd ?? null,
    macd_signal: row.macd_signal ?? null,
    macd_hist: row.macd_hist ?? null,
    kdj_k: row.kdj_k ?? null,
    kdj_d: row.kdj_d ?? null,
    kdj_j: row.kdj_j ?? null,
    rsi_6: row.rsi_6 ?? null,
    rsi_12: row.rsi_12 ?? null,
    rsi_24: row.rsi_24 ?? null,
    cci: row.cci ?? null,
    bias_6: row.bias_6 ?? null,
    bias_12: row.bias_12 ?? null,
    bias_24: row.bias_24 ?? null,
    plus_di: row.plus_di ?? null,
    minus_di: row.minus_di ?? null,
    adx: row.adx ?? null,
    boll_upper: row.boll_upper ?? null,
    boll_mid: row.boll_mid ?? null,
    boll_lower: row.boll_lower ?? null,
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
