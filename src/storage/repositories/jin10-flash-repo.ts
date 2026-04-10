import type { Jin10FlashRecord } from "../../types/jin10.js";
import type { DbRow } from "../db.js";
import { Database } from "../db.js";
import { jin10FlashSchema } from "../schemas.js";

const JIN10_FLASH_TABLE = "jin10_flash";

export class Jin10FlashRepository {
  constructor(private readonly db: Database) {}

  async saveAll(entries: Jin10FlashRecord[]): Promise<{ added: number; skipped: number; addedKeys: string[] }> {
    const uniqueEntries = dedupeEntries(entries);
    if (uniqueEntries.length === 0) {
      return { added: 0, skipped: 0, addedKeys: [] };
    }

    const rows = uniqueEntries.map((entry) => toFlashRow(entry));
    if (!(await this.db.hasTable(JIN10_FLASH_TABLE))) {
      await this.db.createTable(JIN10_FLASH_TABLE, rows, jin10FlashSchema);
      return {
        added: rows.length,
        skipped: 0,
        addedKeys: uniqueEntries.map((entry) => entry.flash_key),
      };
    }

    const existingKeys = await this.listExistingKeys(uniqueEntries.map((entry) => entry.flash_key));
    const newEntries = uniqueEntries.filter((entry) => !existingKeys.has(entry.flash_key));
    const newRows = newEntries.map((entry) => toFlashRow(entry));
    if (newRows.length === 0) {
      return {
        added: 0,
        skipped: rows.length,
        addedKeys: [],
      };
    }

    const table = await this.db.openTable(JIN10_FLASH_TABLE);
    await table.add(newRows);
    return {
      added: newRows.length,
      skipped: rows.length - newRows.length,
      addedKeys: newEntries.map((entry) => entry.flash_key),
    };
  }

  async getLatest(): Promise<Jin10FlashRecord | null> {
    if (!(await this.db.hasTable(JIN10_FLASH_TABLE))) {
      return null;
    }

    const rows = await this.db.tableToArray<Record<string, unknown>>(JIN10_FLASH_TABLE);
    if (rows.length === 0) {
      return null;
    }

    let latestRow = rows[0];
    let latestTs = Number(rows[0]?.published_ts ?? 0);
    for (const row of rows.slice(1)) {
      const publishedTs = Number(row.published_ts ?? 0);
      if (publishedTs >= latestTs) {
        latestRow = row;
        latestTs = publishedTs;
      }
    }

    return latestRow ? fromFlashRow(latestRow) : null;
  }

  async countSincePublishedTs(publishedTs: number): Promise<number> {
    if (!(await this.db.hasTable(JIN10_FLASH_TABLE))) {
      return 0;
    }

    const table = await this.db.openTable(JIN10_FLASH_TABLE);
    return table.countRows(`published_ts >= ${Math.trunc(publishedTs)}`);
  }

  async listByPublishedRange(startPublishedTs: number, endPublishedTs: number): Promise<Jin10FlashRecord[]> {
    if (!(await this.db.hasTable(JIN10_FLASH_TABLE))) {
      return [];
    }

    const table = await this.db.openTable(JIN10_FLASH_TABLE);
    const rows = (await table
      .query()
      .where(
        `published_ts >= ${Math.trunc(startPublishedTs)} AND published_ts <= ${Math.trunc(endPublishedTs)}`,
      )
      .toArray()) as Array<Record<string, unknown>>;

    return rows
      .map((row) => fromFlashRow(row))
      .sort((left, right) => left.published_ts - right.published_ts);
  }

  async searchByContentKeywords(keywords: string[], datePrefix: string): Promise<Jin10FlashRecord[]> {
    if (keywords.length === 0 || !(await this.db.hasTable(JIN10_FLASH_TABLE))) {
      return [];
    }

    const dayStart = `${datePrefix} 00:00:00`;
    const dayStartTs = new Date(`${dayStart.replace(" ", "T")}+08:00`).getTime();
    if (Number.isNaN(dayStartTs)) {
      return [];
    }

    const table = await this.db.openTable(JIN10_FLASH_TABLE);
    const rows = (await table
      .query()
      .where(`published_ts >= ${Math.trunc(dayStartTs)}`)
      .toArray()) as Array<Record<string, unknown>>;

    return rows
      .map((row) => fromFlashRow(row))
      .filter((record) => keywords.some((kw) => record.content.includes(kw)));
  }

  async pruneOlderThanPublishedTs(publishedTs: number): Promise<void> {
    if (!(await this.db.hasTable(JIN10_FLASH_TABLE))) {
      return;
    }

    const table = await this.db.openTable(JIN10_FLASH_TABLE);
    await table.delete(`published_ts < ${Math.trunc(publishedTs)}`);
  }

  private async listExistingKeys(keys: string[]): Promise<Set<string>> {
    if (keys.length === 0 || !(await this.db.hasTable(JIN10_FLASH_TABLE))) {
      return new Set<string>();
    }

    const table = await this.db.openTable(JIN10_FLASH_TABLE);
    const rows = (await table
      .query()
      .where(`flash_key IN (${keys.map((key) => `'${escapeSqlString(key)}'`).join(", ")})`)
      .toArray()) as Array<Record<string, unknown>>;
    return new Set(rows.map((row) => String(row.flash_key ?? "")));
  }
}

function toFlashRow(entry: Jin10FlashRecord): DbRow {
  return {
    flash_key: entry.flash_key,
    published_at: entry.published_at,
    published_ts: Math.trunc(entry.published_ts),
    content: entry.content,
    url: entry.url,
    ingested_at: entry.ingested_at,
    raw_json: JSON.stringify(entry.raw),
  };
}

function fromFlashRow(row: Record<string, unknown>): Jin10FlashRecord {
  return {
    flash_key: String(row.flash_key ?? ""),
    published_at: String(row.published_at ?? ""),
    published_ts: Number(row.published_ts ?? 0),
    content: String(row.content ?? ""),
    url: String(row.url ?? ""),
    ingested_at: String(row.ingested_at ?? ""),
    raw: parseJsonObject(row.raw_json),
  };
}

function dedupeEntries(entries: Jin10FlashRecord[]): Jin10FlashRecord[] {
  const seen = new Set<string>();
  const result: Jin10FlashRecord[] = [];

  for (const entry of entries) {
    if (!entry.flash_key || seen.has(entry.flash_key)) {
      continue;
    }
    seen.add(entry.flash_key);
    result.push(entry);
  }

  return result;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}
