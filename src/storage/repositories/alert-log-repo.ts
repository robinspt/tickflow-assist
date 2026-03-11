import { Database } from "../db.js";
import { alertLogSchema } from "../schemas.js";

const ALERT_LOG_TABLE = "alert_log";

export interface AlertLogEntry {
  symbol: string;
  alert_date: string;
  rule_name: string;
  message: string;
  triggered_at: string;
}

export class AlertLogRepository {
  constructor(private readonly db: Database) {}

  async append(entry: AlertLogEntry): Promise<void> {
    const row = {
      symbol: entry.symbol,
      alert_date: entry.alert_date,
      rule_name: entry.rule_name,
      message: entry.message,
      triggered_at: entry.triggered_at,
    };

    if (!(await this.db.hasTable(ALERT_LOG_TABLE))) {
      await this.db.createTable(ALERT_LOG_TABLE, [row], alertLogSchema);
      return;
    }

    const table = await this.db.openTable(ALERT_LOG_TABLE);
    await table.add([row]);
  }

  async listByNaturalDate(date: string): Promise<AlertLogEntry[]> {
    if (!(await this.db.hasTable(ALERT_LOG_TABLE))) {
      return [];
    }

    const table = await this.db.openTable(ALERT_LOG_TABLE);
    const rows = (await table
      .query()
      .where(`alert_date IN ('${date}_AM', '${date}_PM')`)
      .toArray()) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      symbol: String(row.symbol),
      alert_date: String(row.alert_date),
      rule_name: String(row.rule_name),
      message: String(row.message ?? ""),
      triggered_at: String(row.triggered_at ?? ""),
    }));
  }

  async isSentThisSession(symbol: string, ruleName: string, sessionKey: string): Promise<boolean> {
    if (!(await this.db.hasTable(ALERT_LOG_TABLE))) {
      return false;
    }

    const table = await this.db.openTable(ALERT_LOG_TABLE);
    const rows = (await table
      .query()
      .where(
        `symbol = '${escapeSqlString(symbol)}' AND rule_name = '${escapeSqlString(ruleName)}' AND alert_date = '${escapeSqlString(sessionKey)}'`,
      )
      .toArray()) as Array<Record<string, unknown>>;

    return rows.length > 0;
  }
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}
