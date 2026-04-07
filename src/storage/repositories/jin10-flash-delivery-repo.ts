import type { Jin10FlashDeliveryEntry } from "../../types/jin10.js";
import type { DbRow } from "../db.js";
import { Database } from "../db.js";
import { jin10FlashDeliverySchema } from "../schemas.js";

const JIN10_FLASH_DELIVERY_TABLE = "jin10_flash_delivery";

export class Jin10FlashDeliveryRepository {
  constructor(private readonly db: Database) {}

  async append(entry: Jin10FlashDeliveryEntry): Promise<void> {
    const row = toDeliveryRow(entry);
    if (!(await this.db.hasTable(JIN10_FLASH_DELIVERY_TABLE))) {
      await this.db.createTable(JIN10_FLASH_DELIVERY_TABLE, [row], jin10FlashDeliverySchema);
      return;
    }

    const table = await this.db.openTable(JIN10_FLASH_DELIVERY_TABLE);
    await table.add([row]);
  }

  async hasDelivered(flashKey: string): Promise<boolean> {
    if (!flashKey || !(await this.db.hasTable(JIN10_FLASH_DELIVERY_TABLE))) {
      return false;
    }

    const table = await this.db.openTable(JIN10_FLASH_DELIVERY_TABLE);
    const rows = (await table
      .query()
      .where(`flash_key = '${escapeSqlString(flashKey)}'`)
      .toArray()) as Array<Record<string, unknown>>;
    return rows.length > 0;
  }

  async countSinceDeliveredAt(deliveredAt: string): Promise<number> {
    if (!(await this.db.hasTable(JIN10_FLASH_DELIVERY_TABLE))) {
      return 0;
    }

    const table = await this.db.openTable(JIN10_FLASH_DELIVERY_TABLE);
    return table.countRows(`delivered_at >= '${escapeSqlString(deliveredAt)}'`);
  }

  async pruneOlderThanDeliveredAt(deliveredAt: string): Promise<void> {
    if (!(await this.db.hasTable(JIN10_FLASH_DELIVERY_TABLE))) {
      return;
    }

    const table = await this.db.openTable(JIN10_FLASH_DELIVERY_TABLE);
    await table.delete(`delivered_at < '${escapeSqlString(deliveredAt)}'`);
  }
}

function toDeliveryRow(entry: Jin10FlashDeliveryEntry): DbRow {
  return {
    flash_key: entry.flash_key,
    published_at: entry.published_at,
    symbols_json: JSON.stringify(entry.symbols),
    headline: entry.headline,
    reason: entry.reason,
    importance: entry.importance,
    message: entry.message,
    delivered_at: entry.delivered_at,
  };
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}
