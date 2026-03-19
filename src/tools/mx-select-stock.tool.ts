import { MxApiService } from "../services/mx-search-service.js";
import type { MxSelectStockColumn, MxSelectStockResult } from "../types/mx-select-stock.js";

interface MxSelectStockInput {
  keyword: string;
  pageNo: number;
  pageSize: number;
}

const DEFAULT_PAGE_NO = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parseInput(rawInput: unknown): MxSelectStockInput {
  if (typeof rawInput === "string" && rawInput.trim()) {
    return {
      keyword: rawInput.trim(),
      pageNo: DEFAULT_PAGE_NO,
      pageSize: DEFAULT_PAGE_SIZE,
    };
  }

  if (typeof rawInput === "object" && rawInput !== null) {
    const obj = rawInput as Record<string, unknown>;
    const keyword = String(obj.keyword ?? obj.query ?? obj.q ?? "").trim();
    const pageNo = obj.pageNo == null ? DEFAULT_PAGE_NO : Number(obj.pageNo);
    const pageSize = obj.pageSize == null ? DEFAULT_PAGE_SIZE : Number(obj.pageSize);
    if (!keyword) {
      throw new Error("mx_select_stock requires keyword");
    }
    if (!Number.isFinite(pageNo) || pageNo <= 0) {
      throw new Error("mx_select_stock pageNo must be > 0");
    }
    if (!Number.isFinite(pageSize) || pageSize <= 0) {
      throw new Error("mx_select_stock pageSize must be > 0");
    }
    return {
      keyword,
      pageNo: Math.trunc(pageNo),
      pageSize: Math.min(Math.trunc(pageSize), MAX_PAGE_SIZE),
    };
  }

  throw new Error("invalid mx_select_stock input");
}

export function mxSelectStockTool(mxApiService: MxApiService) {
  return {
    name: "mx_select_stock",
    description: "Screen stocks by natural-language conditions using MX smart stock screening.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      const input = parseInput(rawInput);
      const result = await mxApiService.selectStocks(input);
      return renderMxSelectStockResult(input, result);
    },
  };
}

function renderMxSelectStockResult(input: MxSelectStockInput, result: MxSelectStockResult): string {
  const lines = [
    `🧠 妙想选股: ${input.keyword}`,
    `状态: ${result.status ?? "-"} | 业务码: ${result.code ?? "-"} | 消息: ${result.msg ?? result.message ?? "-"}`,
    `结果类型: ${result.resultType ?? "-"} | 总数: ${result.total} | 总记录: ${result.totalRecordCount}`,
    `页码: ${input.pageNo} | 页大小: ${input.pageSize} | 本页返回: ${result.dataList.length}`,
  ];

  if (result.parserText) {
    lines.push(`解析: ${result.parserText}`);
  }
  if (result.totalCondition) {
    lines.push(
      `组合条件: ${result.totalCondition.describe}（${result.totalCondition.stockCount ?? "-"} 只）`,
    );
  }
  if (result.responseConditionList.length > 0) {
    lines.push("", "条件拆解:");
    for (const condition of result.responseConditionList) {
      lines.push(`- ${condition.describe}（${condition.stockCount ?? "-"} 只）`);
    }
  }

  lines.push("");
  lines.push("字段说明:");
  if (result.columns.length === 0) {
    lines.push("- 无字段定义");
  } else {
    for (const column of result.columns) {
      lines.push(`- ${column.title} <- ${column.key}${formatColumnMeta(column)}`);
    }
  }

  lines.push("");
  lines.push("CSV:");
  lines.push(renderCsv(result.columns, result.dataList));
  return lines.join("\n");
}

function formatColumnMeta(column: MxSelectStockColumn): string {
  const parts: string[] = [];
  if (column.unit) {
    parts.push(`单位=${column.unit}`);
  }
  if (column.dataType) {
    parts.push(`类型=${column.dataType}`);
  }
  if (column.dateMsg) {
    parts.push(`日期=${column.dateMsg}`);
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function renderCsv(columns: MxSelectStockColumn[], rows: Array<Record<string, unknown>>): string {
  if (columns.length === 0) {
    return "";
  }

  const headerLabels = columns.map((column) => escapeCsv(column.title));
  const csvLines = [headerLabels.join(",")];
  for (const row of rows) {
    const values = columns.map((column) => escapeCsv(formatCell(row[column.key])));
    csvLines.push(values.join(","));
  }
  return csvLines.join("\n");
}

function formatCell(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}
