import { Database, type DbRow } from "../db.js";
import { universeMembershipSchema } from "../schemas.js";

const UNIVERSE_MEMBERSHIP_TABLE = "universe_memberships";

export interface UniverseMembershipEntry {
  universeId: string;
  symbol: string;
}

export class UniverseMembershipRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<UniverseMembershipEntry[]> {
    if (!(await this.db.hasTable(UNIVERSE_MEMBERSHIP_TABLE))) {
      return [];
    }

    const rows = await this.db.tableToArray<Record<string, unknown>>(UNIVERSE_MEMBERSHIP_TABLE);
    return rows
      .map((row) => ({
        universeId: String(row.universeId ?? row.universe_id ?? "").trim(),
        symbol: String(row.symbol ?? "").trim(),
      }))
      .filter((row) => row.universeId && row.symbol);
  }

  async replaceAll(entries: UniverseMembershipEntry[]): Promise<void> {
    const rows = entries.map(toUniverseMembershipRow);
    if (rows.length === 0) {
      return;
    }

    if (!(await this.db.hasTable(UNIVERSE_MEMBERSHIP_TABLE))) {
      await this.db.createTable(UNIVERSE_MEMBERSHIP_TABLE, rows, universeMembershipSchema);
      return;
    }

    const table = await this.db.openTable(UNIVERSE_MEMBERSHIP_TABLE);
    await table.add(rows, { mode: "overwrite" });
  }
}

function toUniverseMembershipRow(entry: UniverseMembershipEntry): DbRow {
  return {
    universeId: entry.universeId,
    symbol: entry.symbol,
  };
}
