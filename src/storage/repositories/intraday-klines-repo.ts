import type { TickFlowIntradayKlineRow } from "../../types/tickflow.js";
import type { DbRow } from "../db.js";
import { Database } from "../db.js";
import { klinesIntradaySchema } from "../schemas.js";

const KLINES_INTRADAY_TABLE = "klines_intraday";

export class IntradayKlinesRepository {
  constructor(private readonly db: Database) {}

  async saveAll(symbol: string, period: string, rows: TickFlowIntradayKlineRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    if (!(await this.db.hasTable(KLINES_INTRADAY_TABLE))) {
      await this.db.createTable(
        KLINES_INTRADAY_TABLE,
        rows.map(toIntradayKlineRow),
        klinesIntradaySchema,
      );
      return;
    }

    const table = await this.db.openTable(KLINES_INTRADAY_TABLE);
    const tradeDates = uniqueTradeDates(rows);
    await table.delete(buildDeleteByTradeDatesWhere(symbol, period, tradeDates));
    await table.add(rows.map(toIntradayKlineRow));
  }

  async pruneToTradeDates(symbol: string, period: string, keepTradeDates: string[]): Promise<void> {
    if (!(await this.db.hasTable(KLINES_INTRADAY_TABLE))) {
      return;
    }

    const table = await this.db.openTable(KLINES_INTRADAY_TABLE);
    const base = `symbol = '${escapeSqlString(symbol)}' and period = '${escapeSqlString(period)}'`;
    if (keepTradeDates.length === 0) {
      await table.delete(base);
      return;
    }

    await table.delete(`${base} and trade_date not in (${joinSqlStrings(keepTradeDates)})`);
  }

  async listBySymbol(symbol: string, period?: string): Promise<TickFlowIntradayKlineRow[]> {
    if (!(await this.db.hasTable(KLINES_INTRADAY_TABLE))) {
      return [];
    }

    const filters = [`symbol = '${escapeSqlString(symbol)}'`];
    if (period) {
      filters.push(`period = '${escapeSqlString(period)}'`);
    }

    const table = await this.db.openTable(KLINES_INTRADAY_TABLE);
    const rows = (await table
      .query()
      .where(filters.join(" and "))
      .toArray()) as Array<Record<string, unknown>>;

    return rows
      .map((row) => ({
        symbol: String(row.symbol),
        period: String(row.period),
        trade_date: String(row.trade_date),
        trade_time: String(row.trade_time),
        timestamp: Number(row.timestamp),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
        amount: Number(row.amount),
        prev_close: Number(row.prev_close ?? 0),
        open_interest: toNullableNumber(row.open_interest),
        settlement_price: toNullableNumber(row.settlement_price),
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}

function uniqueTradeDates(rows: TickFlowIntradayKlineRow[]): string[] {
  return [...new Set(rows.map((row) => row.trade_date))];
}

function buildDeleteByTradeDatesWhere(symbol: string, period: string, tradeDates: string[]): string {
  const base = `symbol = '${escapeSqlString(symbol)}' and period = '${escapeSqlString(period)}'`;
  if (tradeDates.length === 0) {
    return base;
  }
  return `${base} and trade_date in (${joinSqlStrings(tradeDates)})`;
}

function joinSqlStrings(values: string[]): string {
  return values.map((value) => `'${escapeSqlString(value)}'`).join(", ");
}

function toIntradayKlineRow(row: TickFlowIntradayKlineRow): DbRow {
  return {
    symbol: row.symbol,
    period: row.period,
    trade_date: row.trade_date,
    trade_time: row.trade_time,
    timestamp: row.timestamp,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    amount: row.amount,
    prev_close: row.prev_close,
    open_interest: row.open_interest,
    settlement_price: row.settlement_price,
  };
}

function toNullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}
