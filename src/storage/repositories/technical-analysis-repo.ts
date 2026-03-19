import type { TechnicalAnalysisEntry } from "../../types/domain.js";
import type { DbRow } from "../db.js";
import { Database } from "../db.js";
import { technicalAnalysisSchema } from "../schemas.js";

const TECHNICAL_ANALYSIS_TABLE = "technical_analysis";

export class TechnicalAnalysisRepository {
  constructor(private readonly db: Database) {}

  async append(entry: TechnicalAnalysisEntry): Promise<void> {
    const row = toTechnicalAnalysisRow(entry);
    if (!(await this.db.hasTable(TECHNICAL_ANALYSIS_TABLE))) {
      await this.db.createTable(TECHNICAL_ANALYSIS_TABLE, [row], technicalAnalysisSchema);
      return;
    }

    const table = await this.db.openTable(TECHNICAL_ANALYSIS_TABLE);
    await table.add([row]);
  }

  async getLatest(symbol: string): Promise<TechnicalAnalysisEntry | null> {
    const rows = await this.listLatest(symbol, 1);
    return rows[0] ?? null;
  }

  async listLatest(symbol: string, limit: number): Promise<TechnicalAnalysisEntry[]> {
    if (!(await this.db.hasTable(TECHNICAL_ANALYSIS_TABLE))) {
      return [];
    }

    const table = await this.db.openTable(TECHNICAL_ANALYSIS_TABLE);
    const rows = (await table
      .query()
      .where(`symbol = '${escapeSqlString(symbol)}'`)
      .toArray()) as Array<Record<string, unknown>>;
    return rows.slice(-Math.max(1, limit)).reverse().map((row) => fromTechnicalAnalysisRow(row));
  }
}

function toTechnicalAnalysisRow(entry: TechnicalAnalysisEntry): DbRow {
  return {
    symbol: entry.symbol,
    analysis_date: entry.analysis_date,
    analysis_text: entry.analysis_text,
    structured_ok: entry.structured_ok ? 1 : 0,
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
    score: entry.score == null ? null : Math.trunc(entry.score),
  };
}

function fromTechnicalAnalysisRow(row: Record<string, unknown>): TechnicalAnalysisEntry {
  return {
    symbol: String(row.symbol),
    analysis_date: String(row.analysis_date),
    analysis_text: String(row.analysis_text ?? ""),
    structured_ok: Boolean(Number(row.structured_ok ?? 0)),
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
