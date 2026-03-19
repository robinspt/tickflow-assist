import { normalizeSymbol } from "../utils/symbol.js";
import {
  ALL_FINANCIAL_SECTIONS,
  FinancialService,
  type FinancialSection,
  type FinancialSnapshot,
} from "../services/financial-service.js";
import type {
  TickFlowBalanceSheetRecord,
  TickFlowCashFlowRecord,
  TickFlowFinancialMetricsRecord,
  TickFlowIncomeRecord,
} from "../types/tickflow.js";

interface FetchFinancialsInput {
  symbol: string;
  startDate?: string;
  endDate?: string;
  latest?: boolean;
  sections: FinancialSection[];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const SECTION_ALIASES: Record<string, FinancialSection> = {
  income: "income",
  利润表: "income",
  profit: "income",
  metrics: "metrics",
  metric: "metrics",
  indicators: "metrics",
  核心指标: "metrics",
  财务指标: "metrics",
  cash_flow: "cash_flow",
  cashflow: "cash_flow",
  cash: "cash_flow",
  现金流: "cash_flow",
  现金流量表: "cash_flow",
  balance_sheet: "balance_sheet",
  balancesheet: "balance_sheet",
  balance: "balance_sheet",
  资产负债表: "balance_sheet",
};

function parseInput(rawInput: unknown): FetchFinancialsInput {
  if (typeof rawInput === "object" && rawInput !== null) {
    const obj = rawInput as Record<string, unknown>;
    const symbol = String(obj.symbol ?? "").trim();
    if (!symbol) {
      throw new Error("fetch-financials requires symbol");
    }

    const startDate = readOptionalString(obj.startDate ?? obj.start_date);
    const endDate = readOptionalString(obj.endDate ?? obj.end_date);
    const latest = readOptionalBoolean(obj.latest);
    const sections = normalizeSections(obj.sections ?? obj.section ?? obj.type);

    validateDate(startDate, "startDate");
    validateDate(endDate, "endDate");

    return {
      symbol,
      startDate,
      endDate,
      latest: latest ?? true,
      sections,
    };
  }

  if (typeof rawInput === "string" && rawInput.trim()) {
    return {
      symbol: rawInput.trim(),
      latest: true,
      sections: ALL_FINANCIAL_SECTIONS,
    };
  }

  throw new Error("invalid fetch-financials input");
}

function readOptionalString(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  const text = String(value).trim();
  return text || undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  throw new Error(`invalid boolean value: ${String(value)}`);
}

function normalizeSections(value: unknown): FinancialSection[] {
  if (value == null) {
    return ALL_FINANCIAL_SECTIONS;
  }

  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [value];

  const resolved = rawItems
    .map((item) => SECTION_ALIASES[String(item).trim().toLowerCase()] ?? SECTION_ALIASES[String(item).trim()])
    .filter((item): item is FinancialSection => item != null);

  if (resolved.length === 0) {
    throw new Error("fetch-financials sections must include income, metrics, cash_flow, or balance_sheet");
  }

  return [...new Set(resolved)];
}

function validateDate(value: string | undefined, fieldName: string): void {
  if (value && !DATE_PATTERN.test(value)) {
    throw new Error(`${fieldName} must be YYYY-MM-DD`);
  }
}

export function fetchFinancialsTool(financialService: FinancialService) {
  return {
    name: "fetch_financials",
    description: "Fetch income statement, balance sheet, cash flow, and financial metrics from TickFlow.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      const input = parseInput(rawInput);
      const symbol = normalizeSymbol(input.symbol);
      const snapshot = await financialService.fetchSnapshot(
        symbol,
        {
          start_date: input.startDate,
          end_date: input.endDate,
          latest: input.latest,
        },
        input.sections,
      );

      return renderFinancialSnapshot(snapshot, input);
    },
  };
}

function renderFinancialSnapshot(snapshot: FinancialSnapshot, input: FetchFinancialsInput): string {
  const lines = [
    `📘 获取 ${snapshot.symbol} 财务数据完成`,
    `查询条件: ${renderScope(input)}`,
    `维度: ${input.sections.join(", ")}`,
    "",
  ];

  for (const section of input.sections) {
    if (section === "income") {
      lines.push(...renderIncomeSection(snapshot.income), "");
    } else if (section === "metrics") {
      lines.push(...renderMetricsSection(snapshot.metrics), "");
    } else if (section === "cash_flow") {
      lines.push(...renderCashFlowSection(snapshot.cashFlow), "");
    } else if (section === "balance_sheet") {
      lines.push(...renderBalanceSheetSection(snapshot.balanceSheet), "");
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.join("\n");
}

function renderScope(input: FetchFinancialsInput): string {
  const parts: string[] = [];
  if (input.latest === true) {
    parts.push("latest=true");
  } else if (input.latest === false) {
    parts.push("latest=false");
  }
  if (input.startDate) {
    parts.push(`start=${input.startDate}`);
  }
  if (input.endDate) {
    parts.push(`end=${input.endDate}`);
  }
  return parts.join(", ") || "默认参数";
}

function renderIncomeSection(rows: TickFlowIncomeRecord[]): string[] {
  if (rows.length === 0) {
    return ["## 利润表", "暂无数据"];
  }

  const latest = rows[0];
  return [
    "## 利润表",
    `期数: ${rows.length} | 最新报告期: ${latest.period_end} | 公告日: ${latest.announce_date ?? "未知"}`,
    `营收=${formatLargeNumber(latest.revenue)} | 营业利润=${formatLargeNumber(latest.operating_profit)} | 利润总额=${formatLargeNumber(latest.total_profit)}`,
    `净利润=${formatLargeNumber(latest.net_income)} | 归母净利润=${formatLargeNumber(latest.net_income_attributable)} | 基本EPS=${formatScalar(latest.basic_eps)}`,
  ];
}

function renderMetricsSection(rows: TickFlowFinancialMetricsRecord[]): string[] {
  if (rows.length === 0) {
    return ["## 核心财务指标", "暂无数据"];
  }

  const latest = rows[0];
  return [
    "## 核心财务指标",
    `期数: ${rows.length} | 最新报告期: ${latest.period_end} | 公告日: ${latest.announce_date ?? "未知"}`,
    `ROE=${formatScalar(latest.roe)} | ROA=${formatScalar(latest.roa)} | 毛利率=${formatScalar(latest.gross_margin)} | 净利率=${formatScalar(latest.net_margin)}`,
    `营收同比=${formatScalar(latest.revenue_yoy)} | 净利同比=${formatScalar(latest.net_income_yoy)} | 资产负债率=${formatScalar(latest.debt_to_asset_ratio)}`,
  ];
}

function renderCashFlowSection(rows: TickFlowCashFlowRecord[]): string[] {
  if (rows.length === 0) {
    return ["## 现金流量表", "暂无数据"];
  }

  const latest = rows[0];
  return [
    "## 现金流量表",
    `期数: ${rows.length} | 最新报告期: ${latest.period_end} | 公告日: ${latest.announce_date ?? "未知"}`,
    `经营现金流=${formatLargeNumber(latest.net_operating_cash_flow)} | 投资现金流=${formatLargeNumber(latest.net_investing_cash_flow)} | 筹资现金流=${formatLargeNumber(latest.net_financing_cash_flow)}`,
    `现金净变动=${formatLargeNumber(latest.net_cash_change)} | 资本开支=${formatLargeNumber(latest.capex)}`,
  ];
}

function renderBalanceSheetSection(rows: TickFlowBalanceSheetRecord[]): string[] {
  if (rows.length === 0) {
    return ["## 资产负债表", "暂无数据"];
  }

  const latest = rows[0];
  return [
    "## 资产负债表",
    `期数: ${rows.length} | 最新报告期: ${latest.period_end} | 公告日: ${latest.announce_date ?? "未知"}`,
    `总资产=${formatLargeNumber(latest.total_assets)} | 总负债=${formatLargeNumber(latest.total_liabilities)} | 所有者权益=${formatLargeNumber(latest.total_equity)}`,
    `货币资金=${formatLargeNumber(latest.cash_and_equivalents)} | 流动资产=${formatLargeNumber(latest.total_current_assets)} | 流动负债=${formatLargeNumber(latest.total_current_liabilities)}`,
  ];
}

function formatLargeNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  const abs = Math.abs(value);
  if (abs >= 1e8) {
    return `${(value / 1e8).toFixed(2)}亿`;
  }
  if (abs >= 1e4) {
    return `${(value / 1e4).toFixed(2)}万`;
  }
  return value.toFixed(2);
}

function formatScalar(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return value.toFixed(4);
}
