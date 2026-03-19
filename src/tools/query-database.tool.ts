import { Database } from "../storage/db.js";

type QueryAction = "tables" | "schema" | "query";
type SortOrder = "asc" | "desc";

interface QueryDatabaseInput {
  action?: QueryAction;
  table?: string;
  symbol?: string;
  limit?: number;
  fields?: string[];
  sortBy?: string;
  sortOrder?: SortOrder;
  filters?: Record<string, unknown>;
  contains?: string;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const TABLE_ALIASES: Record<string, string> = {
  watchlist: "watchlist",
  watchlists: "watchlist",
  自选: "watchlist",
  自选股: "watchlist",
  klines: "klines_daily",
  kline: "klines_daily",
  klines_daily: "klines_daily",
  日k: "klines_daily",
  日线: "klines_daily",
  intraday: "klines_intraday",
  minute: "klines_intraday",
  minutes: "klines_intraday",
  klines_intraday: "klines_intraday",
  分钟k: "klines_intraday",
  分钟线: "klines_intraday",
  分时: "klines_intraday",
  indicators: "indicators",
  indicator: "indicators",
  指标: "indicators",
  key_levels: "key_levels",
  keylevel: "key_levels",
  关键价位: "key_levels",
  analysis_log: "analysis_log",
  analysis: "analysis_log",
  分析日志: "analysis_log",
  technical_analysis: "technical_analysis",
  technical: "technical_analysis",
  technicals: "technical_analysis",
  技术分析: "technical_analysis",
  financial_analysis: "financial_analysis",
  financial: "financial_analysis",
  fundamentals: "financial_analysis",
  基本面分析: "financial_analysis",
  财务分析: "financial_analysis",
  news_analysis: "news_analysis",
  news: "news_analysis",
  research: "news_analysis",
  资讯分析: "news_analysis",
  composite_analysis: "composite_analysis",
  composite: "composite_analysis",
  综合分析: "composite_analysis",
  alert_log: "alert_log",
  alert: "alert_log",
  告警日志: "alert_log",
};

function parseInput(rawInput: unknown): QueryDatabaseInput {
  if (rawInput == null || rawInput === "") {
    return { action: "tables" };
  }

  if (typeof rawInput === "object" && rawInput !== null) {
    const input = rawInput as Record<string, unknown>;
    const action = input.action == null ? undefined : String(input.action).trim().toLowerCase();
    const table = input.table == null ? undefined : normalizeTableName(String(input.table));
    const symbol = input.symbol == null ? undefined : String(input.symbol).trim();
    const limit = input.limit == null ? undefined : Number(input.limit);
    const sortBy = input.sortBy == null ? undefined : String(input.sortBy).trim();
    const sortOrderRaw = input.sortOrder == null ? undefined : String(input.sortOrder).trim().toLowerCase();
    const fields = Array.isArray(input.fields)
      ? input.fields.map((value) => String(value).trim()).filter(Boolean)
      : undefined;
    const filters =
      typeof input.filters === "object" && input.filters !== null
        ? (input.filters as Record<string, unknown>)
        : undefined;
    const contains = input.contains == null ? undefined : String(input.contains).trim();

    return {
      action: normalizeAction(action),
      table,
      symbol,
      limit: normalizeLimit(limit),
      sortBy,
      sortOrder: normalizeSortOrder(sortOrderRaw),
      fields,
      filters,
      contains,
    };
  }

  if (typeof rawInput === "string") {
    const text = rawInput.trim();
    if (!text) {
      return { action: "tables" };
    }

    const parts = text.split(/\s+/);
    const command = parts[0]?.toLowerCase();
    if (command === "tables") {
      return { action: "tables" };
    }
    if (command === "schema") {
      return { action: "schema", table: normalizeTableName(parts[1] ?? "") };
    }
    return {
      action: "query",
      table: normalizeTableName(parts[0] ?? ""),
      symbol: parts[1],
      limit: normalizeLimit(parts[2] ? Number(parts[2]) : undefined),
    };
  }

  throw new Error("invalid query-database input");
}

function normalizeAction(value: string | undefined): QueryAction {
  if (value === "schema" || value === "query" || value === "tables") {
    return value;
  }
  return "query";
}

function normalizeTableName(value: string | undefined): string | undefined {
  const raw = (value ?? "").trim();
  if (!raw) {
    return undefined;
  }
  return TABLE_ALIASES[raw.toLowerCase()] ?? raw;
}

function normalizeLimit(value: number | undefined): number | undefined {
  if (value == null) {
    return undefined;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("query-database limit must be > 0");
  }
  return Math.min(Math.floor(value), MAX_LIMIT);
}

function normalizeSortOrder(value: string | undefined): SortOrder | undefined {
  if (value === "asc" || value === "desc") {
    return value;
  }
  return undefined;
}

export function queryDatabaseTool(database: Database) {
  return {
    name: "query_database",
    description: "Inspect LanceDB tables, schemas, and rows for the plugin data store.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      const input = parseInput(rawInput);
      if (input.action === "tables") {
        return renderTableList(await database.listTables());
      }
      if (input.action === "schema") {
        if (!input.table) {
          throw new Error("query_database schema requires table");
        }
        return renderTableSchema(input.table, await database.describeTable(input.table));
      }
      if (!input.table) {
        throw new Error("query_database query requires table");
      }

      const tables = await database.listTables();
      if (!tables.includes(input.table)) {
        return `⚠️ 数据表不存在: ${input.table}\n可用表: ${tables.join(", ") || "无"}`;
      }

      const rows = await database.tableToArray<Record<string, unknown>>(input.table);
      const filtered = filterRows(rows, input);
      const sorted = sortRows(filtered, input.sortBy, input.sortOrder);
      const limit = input.limit ?? DEFAULT_LIMIT;
      const selected = sorted.slice(0, limit);
      return renderQueryResult(input.table, rows.length, filtered.length, selected, input.fields);
    },
  };
}

function filterRows(rows: Record<string, unknown>[], input: QueryDatabaseInput): Record<string, unknown>[] {
  return rows.filter((row) => {
    if (input.symbol != null && String(row.symbol ?? "") !== input.symbol) {
      return false;
    }
    if (input.contains) {
      const haystack = JSON.stringify(normalizeForDisplay(row)).toLowerCase();
      if (!haystack.includes(input.contains.toLowerCase())) {
        return false;
      }
    }
    if (input.filters) {
      for (const [key, expected] of Object.entries(input.filters)) {
        if (!matchesFilter(row[key], expected)) {
          return false;
        }
      }
    }
    return true;
  });
}

function matchesFilter(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return expected.some((item) => matchesFilter(actual, item));
  }
  if (typeof expected === "string") {
    return String(actual ?? "") === expected;
  }
  if (typeof expected === "number") {
    return Number(actual) === expected;
  }
  if (typeof expected === "boolean") {
    return Boolean(actual) === expected;
  }
  return String(actual ?? "") === String(expected ?? "");
}

function sortRows(
  rows: Record<string, unknown>[],
  sortBy: string | undefined,
  sortOrder: SortOrder | undefined,
): Record<string, unknown>[] {
  if (!sortBy) {
    return rows;
  }

  const direction = sortOrder === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => compareValues(left[sortBy], right[sortBy]) * direction);
}

function compareValues(left: unknown, right: unknown): number {
  if (left == null && right == null) {
    return 0;
  }
  if (left == null) {
    return -1;
  }
  if (right == null) {
    return 1;
  }
  if (
    typeof left === "number" ||
    typeof right === "number" ||
    typeof left === "bigint" ||
    typeof right === "bigint"
  ) {
    return Number(left) - Number(right);
  }
  return String(left).localeCompare(String(right));
}

function renderTableList(tableNames: string[]): string {
  if (tableNames.length === 0) {
    return "📚 当前 LanceDB 没有任何数据表";
  }

  return ["📚 当前 LanceDB 数据表:", ...tableNames.map((name) => `- ${name}`)].join("\n");
}

function renderTableSchema(
  table: string,
  fields: Array<{ name: string; type: string; nullable: boolean }>,
): string {
  if (fields.length === 0) {
    return `⚠️ 数据表不存在或没有结构信息: ${table}`;
  }

  const lines = [`🧱 表结构: ${table}`, `字段数: ${fields.length}`];
  for (const field of fields) {
    lines.push(`- ${field.name}: ${field.type} | nullable=${field.nullable ? "yes" : "no"}`);
  }
  return lines.join("\n");
}

function renderQueryResult(
  table: string,
  totalRows: number,
  filteredRows: number,
  rows: Record<string, unknown>[],
  fields?: string[],
): string {
  const lines = [
    `📦 数据表: ${table}`,
    `总记录: ${totalRows}`,
    `匹配记录: ${filteredRows}`,
    `返回记录: ${rows.length}`,
  ];

  if (rows.length === 0) {
    lines.push("⚠️ 没有匹配到数据");
    return lines.join("\n");
  }

  rows.forEach((row, index) => {
    lines.push(`${index + 1}. ${JSON.stringify(normalizeForDisplay(selectFields(row, fields)), null, 0)}`);
  });
  return lines.join("\n");
}

function selectFields(row: Record<string, unknown>, fields?: string[]): Record<string, unknown> {
  if (!fields || fields.length === 0) {
    return row;
  }
  const selected: Record<string, unknown> = {};
  for (const field of fields) {
    selected[field] = row[field];
  }
  return selected;
}

function normalizeForDisplay(value: unknown): unknown {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForDisplay(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        normalizeForDisplay(item),
      ]),
    );
  }
  return value;
}
