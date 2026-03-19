import type { CompositeAnalysisEntry } from "../../types/domain.js";
import type { DbRow } from "../db.js";
import { Database } from "../db.js";
import { compositeAnalysisSchema } from "../schemas.js";

const COMPOSITE_ANALYSIS_TABLE = "composite_analysis";

export class CompositeAnalysisRepository {
  constructor(private readonly db: Database) {}

  async append(entry: CompositeAnalysisEntry): Promise<void> {
    const row = toCompositeAnalysisRow(entry);
    if (!(await this.db.hasTable(COMPOSITE_ANALYSIS_TABLE))) {
      await this.db.createTable(COMPOSITE_ANALYSIS_TABLE, [row], compositeAnalysisSchema);
      return;
    }

    const table = await this.db.openTable(COMPOSITE_ANALYSIS_TABLE);
    await table.add([row]);
  }

  async getLatest(symbol: string): Promise<CompositeAnalysisEntry | null> {
    const rows = await this.listLatest(symbol, 1);
    return rows[0] ?? null;
  }

  async listLatest(symbol: string, limit: number): Promise<CompositeAnalysisEntry[]> {
    if (!(await this.db.hasTable(COMPOSITE_ANALYSIS_TABLE))) {
      return [];
    }

    const table = await this.db.openTable(COMPOSITE_ANALYSIS_TABLE);
    const rows = (await table
      .query()
      .where(`symbol = '${escapeSqlString(symbol)}'`)
      .toArray()) as Array<Record<string, unknown>>;
    return rows.slice(-Math.max(1, limit)).reverse().map((row) => fromCompositeAnalysisRow(row));
  }
}

function toCompositeAnalysisRow(entry: CompositeAnalysisEntry): DbRow {
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
    technical_score: entry.technical_score == null ? null : Math.trunc(entry.technical_score),
    financial_score: entry.financial_score == null ? null : Math.trunc(entry.financial_score),
    news_score: entry.news_score == null ? null : Math.trunc(entry.news_score),
    financial_bias: entry.financial_bias,
    news_bias: entry.news_bias,
    evidence_json: JSON.stringify(entry.evidence),
  };
}

function fromCompositeAnalysisRow(row: Record<string, unknown>): CompositeAnalysisEntry {
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
    technical_score: toNullableNumber(row.technical_score),
    financial_score: toNullableNumber(row.financial_score),
    news_score: toNullableNumber(row.news_score),
    financial_bias: normalizeBias(row.financial_bias),
    news_bias: normalizeBias(row.news_bias),
    evidence: parseJsonObject<CompositeAnalysisEntry["evidence"]>(row.evidence_json, {
      technical_structured: false,
      financial_available: false,
      financial_latest_period_end: null,
      news_available: false,
      news_query: "",
      news_source_count: 0,
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

function normalizeBias(value: unknown): CompositeAnalysisEntry["financial_bias"] {
  if (value === "positive" || value === "negative") {
    return value;
  }
  return "neutral";
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}
