import { MxApiService } from "./mx-search-service.js";
import type { MxSelectStockColumn, MxSelectStockResult } from "../types/mx-select-stock.js";

export interface FinancialLiteMetric {
  id: string;
  label: string;
  value: number | string | null;
  unit: string | null;
  asOf: string | null;
}

export interface FinancialLiteSnapshot {
  symbol: string;
  companyName: string;
  query: string;
  asOf: string | null;
  parserText: string | null;
  rowName: string | null;
  metrics: FinancialLiteMetric[];
}

const MAX_METRICS = 12;

const METRIC_MATCHERS: Array<{
  id: string;
  label: string;
  patterns: RegExp[];
}> = [
  { id: "roe", label: "ROE", patterns: [/(\b|_)roe(\b|_)/i, /净资产收益率/] },
  { id: "roa", label: "ROA", patterns: [/(\b|_)roa(\b|_)/i, /总资产收益率/] },
  { id: "gross_margin", label: "毛利率", patterns: [/gross[\s_-]*margin/i, /毛利率/] },
  { id: "net_margin", label: "净利率", patterns: [/net[\s_-]*margin/i, /净利率/] },
  {
    id: "revenue_yoy",
    label: "营收同比",
    patterns: [/revenue[\s_-]*yoy/i, /营收同比/, /营业收入同比/],
  },
  {
    id: "net_income_yoy",
    label: "净利润同比",
    patterns: [/net[\s_-]*income[\s_-]*yoy/i, /净利润同比/, /归母净利润同比/],
  },
  {
    id: "debt_to_asset_ratio",
    label: "资产负债率",
    patterns: [/debt[\s_-]*to[\s_-]*asset/i, /资产负债率/],
  },
  {
    id: "ocfps",
    label: "每股经营现金流",
    patterns: [/ocfps/i, /每股经营现金流/, /每股经营现金流量/],
  },
  {
    id: "operating_cash_to_revenue",
    label: "销售现金比率",
    patterns: [/operating[\s_-]*cash[\s_-]*to[\s_-]*revenue/i, /销售现金比率/],
  },
  { id: "eps", label: "每股收益", patterns: [/(\b|_)(eps|basic_eps|eps_basic)(\b|_)/i, /每股收益/] },
  { id: "bps", label: "每股净资产", patterns: [/(\b|_)bps(\b|_)/i, /每股净资产/] },
];

const CODE_PATTERNS = [/security[\s_-]*code/i, /secu[\s_-]*code/i, /股票代码/, /证券代码/, /^代码$/];
const NAME_PATTERNS = [
  /security[\s_-]*short[\s_-]*name/i,
  /security[\s_-]*name/i,
  /secu[\s_-]*name/i,
  /股票简称/,
  /证券简称/,
  /^名称$/,
];

export class FinancialLiteService {
  constructor(private readonly mxApiService: MxApiService) {}

  isConfigured(): boolean {
    return this.mxApiService.isConfigured();
  }

  async fetchSnapshot(symbol: string, companyName: string): Promise<FinancialLiteSnapshot | null> {
    if (!this.isConfigured()) {
      return null;
    }

    const query = buildFinancialLiteQuery(symbol, companyName);
    const result = await this.mxApiService.selectStocks({
      keyword: query,
      pageNo: 1,
      pageSize: 20,
    });

    const row = selectTargetRow(result, symbol, companyName);
    if (!row) {
      return null;
    }

    const metrics = selectFinancialMetrics(result.columns, row);
    if (metrics.length === 0) {
      return null;
    }

    return {
      symbol,
      companyName,
      query,
      asOf: resolveSnapshotAsOf(metrics),
      parserText: result.parserText,
      rowName: resolveRowName(result.columns, row),
      metrics,
    };
  }
}

function buildFinancialLiteQuery(symbol: string, companyName: string): string {
  const securityName = companyName && companyName !== symbol ? `${companyName} ${symbol}` : symbol;
  return `${securityName} 财务指标 ROE ROA 毛利率 净利率 营收同比 净利润同比 资产负债率 每股经营现金流 每股收益 每股净资产`;
}

function selectTargetRow(
  result: MxSelectStockResult,
  symbol: string,
  companyName: string,
): Record<string, unknown> | null {
  if (result.dataList.length === 0) {
    return null;
  }

  const codeColumn = findIdentityColumn(result.columns, CODE_PATTERNS);
  const nameColumn = findIdentityColumn(result.columns, NAME_PATTERNS);
  const normalizedSymbol = normalizePlainText(symbol).replace(/\.(sz|sh|hk|us)$/i, "");
  const normalizedName = normalizePlainText(companyName);

  let bestRow: Record<string, unknown> | null = null;
  let bestScore = -1;
  for (const row of result.dataList) {
    const codeValue = codeColumn ? normalizePlainText(row[codeColumn.key]).replace(/\.(sz|sh|hk|us)$/i, "") : "";
    const nameValue = nameColumn ? normalizePlainText(row[nameColumn.key]) : "";
    let score = 0;
    if (codeValue && (codeValue === normalizedSymbol || normalizedSymbol.endsWith(codeValue))) {
      score += 3;
    }
    if (normalizedName && nameValue && normalizedName.includes(nameValue)) {
      score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRow = row;
    }
  }

  return bestRow ?? result.dataList[0] ?? null;
}

function findIdentityColumn(
  columns: MxSelectStockColumn[],
  patterns: RegExp[],
): MxSelectStockColumn | null {
  return (
    columns.find((column) => {
      const normalized = normalizeColumnToken(column.title, column.key);
      return patterns.some((pattern) => pattern.test(normalized));
    }) ?? null
  );
}

function selectFinancialMetrics(
  columns: MxSelectStockColumn[],
  row: Record<string, unknown>,
): FinancialLiteMetric[] {
  const metrics: FinancialLiteMetric[] = [];
  const usedIds = new Set<string>();

  for (const column of columns) {
    const matcher = matchMetricColumn(column);
    if (!matcher || usedIds.has(matcher.id)) {
      continue;
    }

    const value = normalizeMetricValue(row[column.key]);
    if (value == null || value === "") {
      continue;
    }

    usedIds.add(matcher.id);
    metrics.push({
      id: matcher.id,
      label: matcher.label,
      value,
      unit: column.unit,
      asOf: column.dateMsg,
    });

    if (metrics.length >= MAX_METRICS) {
      break;
    }
  }

  return metrics;
}

function matchMetricColumn(
  column: MxSelectStockColumn,
): { id: string; label: string } | null {
  const normalized = normalizeColumnToken(column.title, column.key);
  for (const matcher of METRIC_MATCHERS) {
    if (matcher.patterns.some((pattern) => pattern.test(normalized))) {
      return {
        id: matcher.id,
        label: matcher.label,
      };
    }
  }
  return null;
}

function resolveSnapshotAsOf(metrics: FinancialLiteMetric[]): string | null {
  const values = metrics
    .map((metric) => metric.asOf?.trim() ?? "")
    .filter(Boolean);
  if (values.length === 0) {
    return null;
  }
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? values[0];
}

function resolveRowName(
  columns: MxSelectStockColumn[],
  row: Record<string, unknown>,
): string | null {
  const nameColumn = findIdentityColumn(columns, NAME_PATTERNS);
  if (!nameColumn) {
    return null;
  }
  const value = row[nameColumn.key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeMetricValue(value: unknown): number | string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const text = String(value).trim();
  if (!text || text === "--" || text === "-") {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : text;
  }
  return text;
}

function normalizeColumnToken(title: string, key: string): string {
  return `${title} ${key}`.replace(/\s+/g, " ").trim();
}

function normalizePlainText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}
