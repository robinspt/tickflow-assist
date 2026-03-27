import type { FinancialSnapshot } from "../../services/financial-service.js";

const FIELD_LABELS: Record<string, string> = {
  announce_date: "公告日",
  basic_eps: "基本每股收益",
  capex: "资本开支",
  cash_and_equivalents: "货币资金",
  debt_to_asset_ratio: "资产负债率",
  gross_margin: "毛利率",
  long_term_borrowing: "长期借款",
  net_cash_change: "现金净增加额",
  net_financing_cash_flow: "筹资现金流净额",
  net_income: "净利润",
  net_income_attributable: "归母净利润",
  net_income_yoy: "净利润同比",
  net_investing_cash_flow: "投资现金流净额",
  net_margin: "净利率",
  net_operating_cash_flow: "经营现金流净额",
  ocfps: "每股经营现金流",
  operating_cash_to_revenue: "销售现金比率",
  operating_profit: "营业利润",
  period_end: "报告期",
  revenue: "营业收入",
  revenue_yoy: "营收同比",
  roa: "ROA",
  roe: "ROE",
  short_term_borrowing: "短期借款",
  total_assets: "总资产",
  total_current_assets: "流动资产",
  total_current_liabilities: "流动负债",
  total_equity: "股东权益",
  total_liabilities: "总负债",
};

export const FINANCIAL_ANALYSIS_SYSTEM_PROMPT = `
你是一位专业的A股基本面分析师。你的任务是仅基于提供的财务数据，评估公司的盈利能力、成长性、现金质量与偿债压力。

输出要求：
1. 先给出一段 80-120 字中文核心结论，不要在正文中混入 JSON。
2. 核心结论后按以下小节分段展开，每节 1-3 句：
- 盈利质量与成长性
- 现金流质量
- 资产负债结构与偿债压力
3. 分段内容必须尽量引用已提供的财务指标、同比变化或报表项目，不要空泛表述。
4. 最后输出 \`\`\`json 代码块，结构如下：
{
  "score": integer,
  "bias": "positive" | "neutral" | "negative",
  "strengths": ["<基本面优势1>", "<基本面优势2>"],
  "risks": ["<基本面风险1>", "<基本面风险2>"],
  "watch_items": ["<后续关注点1>", "<后续关注点2>"]
}

规则：
- score 为 1-10 的整数。
- bias 只能是 positive / neutral / negative。
- strengths / risks / watch_items 各输出 1-3 条。
- 不要臆造没有提供的数据，不要引用市场价格与K线信息。
- 若某项财务字段为 null、缺失或未提供，只能表述为“数据不可用”或“当前未覆盖”，不能直接推断为负面事实。
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
    const parts = keys.map((key) => `${FIELD_LABELS[key] ?? key}=${formatValue(record[key])}`);
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
