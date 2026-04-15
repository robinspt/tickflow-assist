import type { TickFlowUniverseSummary } from "../../types/tickflow.js";
import { Database, type DbRow } from "../db.js";
import { universeSchema } from "../schemas.js";

const UNIVERSE_TABLE = "universes";

export interface StoredUniverseSummary {
  id: string;
  name: string;
  description: string | null;
  region: string;
  category: string;
  symbolCount: number;
  syncedAt: string;
}

export class UniverseRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<StoredUniverseSummary[]> {
    if (!(await this.db.hasTable(UNIVERSE_TABLE))) {
      return [];
    }

    const rows = await this.db.tableToArray<Record<string, unknown>>(UNIVERSE_TABLE);
    return rows
      .map((row) => ({
        id: String(row.id ?? "").trim(),
        name: String(row.name ?? "").trim(),
        description: normalizeNullableString(row.description),
        region: String(row.region ?? "").trim(),
        category: String(row.category ?? "").trim(),
        symbolCount: normalizeNonNegativeInteger(row.symbolCount ?? row.symbol_count),
        syncedAt: String(row.syncedAt ?? row.synced_at ?? "").trim(),
      }))
      .filter((row) => row.id && row.name);
  }

  async replaceAll(universes: TickFlowUniverseSummary[], syncedAt: string): Promise<void> {
    const rows = universes.map((item) => toUniverseRow(item, syncedAt));
    if (rows.length === 0) {
      return;
    }

    if (!(await this.db.hasTable(UNIVERSE_TABLE))) {
      await this.db.createTable(UNIVERSE_TABLE, rows, universeSchema);
      return;
    }

    const table = await this.db.openTable(UNIVERSE_TABLE);
    await table.add(rows, { mode: "overwrite" });
  }
}

function toUniverseRow(item: TickFlowUniverseSummary, syncedAt: string): DbRow {
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? "",
    region: item.region,
    category: item.category,
    symbolCount: Math.max(0, Math.trunc(Number(item.symbol_count ?? 0))),
    syncedAt,
  };
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text || null;
}

function normalizeNonNegativeInteger(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return Math.trunc(numeric);
}
