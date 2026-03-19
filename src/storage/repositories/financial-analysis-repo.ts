import type { FinancialAnalysisEntry } from "../../types/domain.js";
import type { DbRow } from "../db.js";
import { Database } from "../db.js";
import { financialAnalysisSchema } from "../schemas.js";

const FINANCIAL_ANALYSIS_TABLE = "financial_analysis";

export class FinancialAnalysisRepository {
  constructor(private readonly db: Database) {}

  async append(entry: FinancialAnalysisEntry): Promise<void> {
    const row = toFinancialAnalysisRow(entry);
    if (!(await this.db.hasTable(FINANCIAL_ANALYSIS_TABLE))) {
      await this.db.createTable(FINANCIAL_ANALYSIS_TABLE, [row], financialAnalysisSchema);
      return;
    }

    const table = await this.db.openTable(FINANCIAL_ANALYSIS_TABLE);
    await table.add([row]);
  }

  async getLatest(symbol: string): Promise<FinancialAnalysisEntry | null> {
    const rows = await this.listLatest(symbol, 1);
    return rows[0] ?? null;
  }

  async listLatest(symbol: string, limit: number): Promise<FinancialAnalysisEntry[]> {
    if (!(await this.db.hasTable(FINANCIAL_ANALYSIS_TABLE))) {
      return [];
    }

    const table = await this.db.openTable(FINANCIAL_ANALYSIS_TABLE);
    const rows = (await table
      .query()
      .where(`symbol = '${escapeSqlString(symbol)}'`)
      .toArray()) as Array<Record<string, unknown>>;
    return rows.slice(-Math.max(1, limit)).reverse().map((row) => fromFinancialAnalysisRow(row));
  }
}

function toFinancialAnalysisRow(entry: FinancialAnalysisEntry): DbRow {
  return {
    symbol: entry.symbol,
    analysis_date: entry.analysis_date,
    analysis_text: entry.analysis_text,
    score: entry.score == null ? null : Math.trunc(entry.score),
    bias: entry.bias,
    strengths_json: JSON.stringify(entry.strengths),
    risks_json: JSON.stringify(entry.risks),
    watch_items_json: JSON.stringify(entry.watch_items),
    evidence_json: JSON.stringify(entry.evidence),
  };
}

function fromFinancialAnalysisRow(row: Record<string, unknown>): FinancialAnalysisEntry {
  return {
    symbol: String(row.symbol),
    analysis_date: String(row.analysis_date),
    analysis_text: String(row.analysis_text ?? ""),
    score: toNullableNumber(row.score),
    bias: normalizeBias(row.bias),
    strengths: parseJsonArray(row.strengths_json),
    risks: parseJsonArray(row.risks_json),
    watch_items: parseJsonArray(row.watch_items_json),
    evidence: parseJsonObject<FinancialAnalysisEntry["evidence"]>(row.evidence_json, {
      available: false,
      latest_period_end: null,
      latest_announce_date: null,
      income_count: 0,
      metrics_count: 0,
      cash_flow_count: 0,
      balance_sheet_count: 0,
    }),
  };
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function parseJsonObject<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeBias(value: unknown): FinancialAnalysisEntry["bias"] {
  if (value === "positive" || value === "negative") {
    return value;
  }
  return "neutral";
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}
