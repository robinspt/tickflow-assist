import type { NewsAnalysisEntry } from "../../types/domain.js";
import type { DbRow } from "../db.js";
import { Database } from "../db.js";
import { newsAnalysisSchema } from "../schemas.js";

const NEWS_ANALYSIS_TABLE = "news_analysis";

export class NewsAnalysisRepository {
  constructor(private readonly db: Database) {}

  async append(entry: NewsAnalysisEntry): Promise<void> {
    const row = toNewsAnalysisRow(entry);
    if (!(await this.db.hasTable(NEWS_ANALYSIS_TABLE))) {
      await this.db.createTable(NEWS_ANALYSIS_TABLE, [row], newsAnalysisSchema);
      return;
    }

    const table = await this.db.openTable(NEWS_ANALYSIS_TABLE);
    await table.add([row]);
  }

  async getLatest(symbol: string): Promise<NewsAnalysisEntry | null> {
    const rows = await this.listLatest(symbol, 1);
    return rows[0] ?? null;
  }

  async listLatest(symbol: string, limit: number): Promise<NewsAnalysisEntry[]> {
    if (!(await this.db.hasTable(NEWS_ANALYSIS_TABLE))) {
      return [];
    }

    const table = await this.db.openTable(NEWS_ANALYSIS_TABLE);
    const rows = (await table
      .query()
      .where(`symbol = '${escapeSqlString(symbol)}'`)
      .toArray()) as Array<Record<string, unknown>>;
    return rows.slice(-Math.max(1, limit)).reverse().map((row) => fromNewsAnalysisRow(row));
  }
}

function toNewsAnalysisRow(entry: NewsAnalysisEntry): DbRow {
  return {
    symbol: entry.symbol,
    analysis_date: entry.analysis_date,
    query: entry.query,
    analysis_text: entry.analysis_text,
    score: entry.score == null ? null : Math.trunc(entry.score),
    bias: entry.bias,
    catalysts_json: JSON.stringify(entry.catalysts),
    risks_json: JSON.stringify(entry.risks),
    watch_items_json: JSON.stringify(entry.watch_items),
    source_count: entry.source_count,
    evidence_json: JSON.stringify(entry.evidence),
  };
}

function fromNewsAnalysisRow(row: Record<string, unknown>): NewsAnalysisEntry {
  return {
    symbol: String(row.symbol),
    analysis_date: String(row.analysis_date),
    query: String(row.query ?? ""),
    analysis_text: String(row.analysis_text ?? ""),
    score: toNullableNumber(row.score),
    bias: normalizeBias(row.bias),
    catalysts: parseJsonArray(row.catalysts_json),
    risks: parseJsonArray(row.risks_json),
    watch_items: parseJsonArray(row.watch_items_json),
    source_count: Number(row.source_count ?? 0),
    evidence: parseJsonObject<NewsAnalysisEntry["evidence"]>(row.evidence_json, {
      available: false,
      source_count: 0,
      documents: [],
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

function normalizeBias(value: unknown): NewsAnalysisEntry["bias"] {
  if (value === "positive" || value === "negative") {
    return value;
  }
  return "neutral";
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}
