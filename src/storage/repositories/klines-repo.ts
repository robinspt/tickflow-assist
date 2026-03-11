import type { DbRow } from "../db.js";
import { Database } from "../db.js";
import { klinesDailySchema } from "../schemas.js";
import type { TickFlowKlineRow } from "../../types/tickflow.js";

const KLINES_TABLE = "klines_daily";

export class KlinesRepository {
  constructor(private readonly db: Database) {}

  async saveAll(symbol: string, rows: TickFlowKlineRow[]): Promise<void> {
    if (!(await this.db.hasTable(KLINES_TABLE))) {
      await this.db.createTable(KLINES_TABLE, rows.map(toKlineRow), klinesDailySchema);
      return;
    }

    const table = await this.db.openTable(KLINES_TABLE);
    await table.delete(`symbol = '${escapeSqlString(symbol)}'`);
    if (rows.length > 0) {
      await table.add(rows.map(toKlineRow));
    }
  }

  async listBySymbol(symbol: string): Promise<TickFlowKlineRow[]> {
    if (!(await this.db.hasTable(KLINES_TABLE))) {
      return [];
    }

    const table = await this.db.openTable(KLINES_TABLE);
    const query = table
      .query()
      .where(`symbol = '${escapeSqlString(symbol)}'`);
    const rows = (await query.toArray()) as Array<Record<string, unknown>>;

    return rows
      .map((row) => ({
        symbol: String(row.symbol),
        trade_date: String(row.trade_date),
        timestamp: Number(row.timestamp),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
        amount: Number(row.amount),
        prev_close: Number(row.prev_close ?? 0),
      }))
      .sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  }
}

function toKlineRow(row: TickFlowKlineRow): DbRow {
  return {
    symbol: row.symbol,
    trade_date: row.trade_date,
    timestamp: row.timestamp,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    amount: row.amount,
    prev_close: row.prev_close,
  };
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}
