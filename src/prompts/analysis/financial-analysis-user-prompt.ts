import type { FinancialSnapshot } from "../../services/financial-service.js";

export const FINANCIAL_ANALYSIS_SYSTEM_PROMPT = `
你是一位专业的A股基本面分析师。你的任务是仅基于提供的财务数据，评估公司的盈利能力、成长性、现金质量与偿债压力。

输出要求：
1. 先给出 4-6 句中文结论，不要在正文中混入 JSON。
2. 结论必须覆盖：盈利质量、成长性、现金流、资产负债结构。
3. 最后输出 \`\`\`json 代码块，结构如下：
{
  "score": 5,
  "bias": "neutral",
  "strengths": ["..."],
  "risks": ["..."],
  "watch_items": ["..."]
}

规则：
- score 为 1-10 的整数。
- bias 只能是 positive / neutral / negative。
- strengths / risks / watch_items 各输出 1-3 条。
- 不要臆造没有提供的数据，不要引用市场价格与K线信息。
`;

export function buildFinancialAnalysisUserPrompt(params: {
  symbol: string;
  companyName: string;
  snapshot: FinancialSnapshot;
}): string {
  const income = params.snapshot.income.slice(0, 2);
  const metrics = params.snapshot.metrics.slice(0, 2);
  const cashFlow = params.snapshot.cashFlow.slice(0, 2);
  const balanceSheet = params.snapshot.balanceSheet.slice(0, 2);

  return [
    `请分析 ${params.companyName}（${params.symbol}）的最新财务质量。`,
    "",
    "## 利润表",
    ...renderRows(income, [
      "period_end",
      "announce_date",
      "revenue",
      "operating_profit",
      "net_income",
      "net_income_attributable",
      "basic_eps",
    ]),
    "",
    "## 核心财务指标",
    ...renderRows(metrics, [
      "period_end",
      "announce_date",
      "roe",
      "roa",
      "gross_margin",
      "net_margin",
      "revenue_yoy",
      "net_income_yoy",
      "debt_to_asset_ratio",
      "operating_cash_to_revenue",
      "ocfps",
    ]),
    "",
    "## 现金流量表",
    ...renderRows(cashFlow, [
      "period_end",
      "announce_date",
      "net_operating_cash_flow",
      "net_investing_cash_flow",
      "net_financing_cash_flow",
      "net_cash_change",
      "capex",
    ]),
    "",
    "## 资产负债表",
    ...renderRows(balanceSheet, [
      "period_end",
      "announce_date",
      "total_assets",
      "total_liabilities",
      "total_equity",
      "cash_and_equivalents",
      "total_current_assets",
      "total_current_liabilities",
      "short_term_borrowing",
      "long_term_borrowing",
    ]),
    "",
    "请重点判断：盈利能力是否稳健、同比趋势是否改善、经营现金流是否支撑利润、资产负债结构是否健康。",
  ].join("\n");
}

function renderRows<T extends object>(rows: T[], keys: string[]): string[] {
  if (rows.length === 0) {
    return ["- 暂无数据"];
  }

  return rows.map((row, index) => {
    const record = row as Record<string, unknown>;
    const parts = keys.map((key) => `${key}=${formatValue(record[key])}`);
    return `- 第 ${index + 1} 期: ${parts.join(" | ")}`;
  });
}

function formatValue(value: unknown): string {
  if (value == null || value === "") {
    return "-";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toFixed(4) : "-";
  }
  return String(value);
}
