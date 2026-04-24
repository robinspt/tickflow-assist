import { MxApiService } from "../services/mx-search-service.js";
import type { MxDataTable } from "../types/mx-data.js";

interface MxDataInput {
  query: string;
  limit: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_TABLES = 5;

function parseInput(rawInput: unknown): MxDataInput {
  if (typeof rawInput === "string" && rawInput.trim()) {
    return {
      query: rawInput.trim(),
      limit: DEFAULT_LIMIT,
    };
  }

  if (typeof rawInput === "object" && rawInput !== null) {
    const obj = rawInput as Record<string, unknown>;
    const query = String(obj.query ?? obj.toolQuery ?? obj.keyword ?? obj.q ?? "").trim();
    const limit = obj.limit == null ? DEFAULT_LIMIT : Number(obj.limit);
    if (!query) {
      throw new Error("mx_data requires query");
    }
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new Error("mx_data limit must be > 0");
    }
    return {
      query,
      limit: Math.min(Math.trunc(limit), MAX_LIMIT),
    };
  }

  throw new Error("invalid mx_data input");
}

export function mxDataTool(mxApiService: MxApiService) {
  return {
    name: "mx_data",
    description: "Query official Eastmoney MX financial data by natural language, including quotes, financial metrics, capital flow, company profile, shareholders, and relationships.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      const input = parseInput(rawInput);
      const result = await mxApiService.queryData(input.query);

      const lines = [
        `📊 妙想数据: ${input.query}`,
        `状态: ${result.status ?? "-"} | 消息: ${result.message ?? "-"}`,
        `结果: ${result.tables.length} 个表 | 总行数: ${result.totalRows}`,
      ];

      if (result.questionId) {
        lines.push(`查询ID: ${result.questionId}`);
      }
      if (result.entityTags.length > 0) {
        lines.push("", "查询证券:");
        for (const entity of result.entityTags) {
          const main = [entity.fullName, entity.secuCode].filter(Boolean).join(" ");
          const extra = [entity.marketChar, entity.entityTypeName, entity.className].filter(Boolean).join(" / ");
          lines.push(`- ${extra ? `${main} (${extra})` : main}`);
        }
      }
      if (result.conditionParts.length > 0) {
        lines.push("", "查询条件:");
        lines.push(...result.conditionParts.slice(0, 3));
      }
      if (result.tables.length === 0) {
        lines.push("", "⚠️ 未解析到有效数据表");
        return lines.join("\n");
      }

      const tables = result.tables.slice(0, MAX_TABLES);
      lines.push("", `表格预览: 展示 ${tables.length}/${result.tables.length} 个表，每表最多 ${input.limit} 行`);
      for (const table of tables) {
        lines.push("", formatTableHeader(table));
        lines.push(renderCsv(table, input.limit));
        if (table.rows.length > input.limit) {
          lines.push(`... 仅展示前 ${input.limit} 行，共 ${table.rows.length} 行`);
        }
      }
      if (result.tables.length > MAX_TABLES) {
        lines.push(`\n... 另有 ${result.tables.length - MAX_TABLES} 个表未展示`);
      }

      return lines.join("\n");
    },
  };
}

function formatTableHeader(table: MxDataTable): string {
  const identity = [table.entityName, table.code].filter(Boolean).join(" ");
  return `### ${table.title}${identity ? ` (${identity})` : ""}`;
}

function renderCsv(table: MxDataTable, limit: number): string {
  if (table.fieldnames.length === 0) {
    return "";
  }

  const csvLines = [table.fieldnames.map(escapeCsv).join(",")];
  for (const row of table.rows.slice(0, limit)) {
    csvLines.push(table.fieldnames.map((fieldname) => escapeCsv(row[fieldname] ?? "")).join(","));
  }
  return csvLines.join("\n");
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}
