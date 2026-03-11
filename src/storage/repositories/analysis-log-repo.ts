import type { DbRow } from "../db.js";
import { Database } from "../db.js";
import { analysisLogSchema } from "../schemas.js";
import type { AnalysisLogEntry } from "../../types/domain.js";

const ANALYSIS_LOG_TABLE = "analysis_log";

export class AnalysisLogRepository {
  constructor(private readonly db: Database) {}

  async append(entry: AnalysisLogEntry): Promise<void> {
    const row = toAnalysisLogRow(entry);
    if (!(await this.db.hasTable(ANALYSIS_LOG_TABLE))) {
      await this.db.createTable(ANALYSIS_LOG_TABLE, [row], analysisLogSchema);
      return;
    }

    const table = await this.db.openTable(ANALYSIS_LOG_TABLE);
    await table.add([row]);
  }

  async getLatest(symbol: string): Promise<AnalysisLogEntry | null> {
    if (!(await this.db.hasTable(ANALYSIS_LOG_TABLE))) {
      return null;
    }

    const table = await this.db.openTable(ANALYSIS_LOG_TABLE);
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
      analysis_text: String(row.analysis_text),
      structured_ok: Boolean(Number(row.structured_ok ?? 0)),
    };
  }
}

function toAnalysisLogRow(entry: AnalysisLogEntry): DbRow {
  return {
    symbol: entry.symbol,
    analysis_date: entry.analysis_date,
    analysis_text: entry.analysis_text,
    structured_ok: entry.structured_ok ? 1 : 0,
  };
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}
