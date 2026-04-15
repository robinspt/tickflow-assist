export interface TickFlowInstrument {
  symbol: string;
  name?: string | null;
  exchange: string;
  code: string;
  region: string;
  type?: string | null;
}

export interface TickFlowQuote {
  symbol: string;
  name?: string | null;
  last_price: number;
  prev_close: number;
  timestamp: number;
  volume?: number;
  ext?: {
    name?: string;
    change_pct?: number;
  };
}

export interface TickFlowUniverseSummary {
  id: string;
  name: string;
  description?: string | null;
  region: string;
  category: string;
  symbol_count: number;
}

export interface TickFlowUniverseDetail extends TickFlowUniverseSummary {
  symbols: string[];
}

export interface TickFlowCompactKline {
  timestamp: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  amount: number[];
  prev_close?: number[];
  open_interest?: number[];
  settlement_price?: number[];
}

export interface TickFlowKlineRow {
  symbol: string;
  trade_date: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  prev_close: number;
}

export interface TickFlowIntradayKlineRow {
  symbol: string;
  period: string;
  trade_date: string;
  trade_time: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  prev_close: number;
  open_interest: number | null;
  settlement_price: number | null;
}

export interface TickFlowFinancialQueryOptions {
  start_date?: string;
  end_date?: string;
  latest?: boolean;
}

export interface TickFlowBalanceSheetRecord {
  period_end: string;
  announce_date?: string | null;
  accounts_payable?: number | null;
  accounts_receivable?: number | null;
  cash_and_equivalents?: number | null;
  equity_attributable?: number | null;
  fixed_assets?: number | null;
  goodwill?: number | null;
  intangible_assets?: number | null;
  inventory?: number | null;
  long_term_borrowing?: number | null;
  minority_interest?: number | null;
  retained_earnings?: number | null;
  short_term_borrowing?: number | null;
  total_assets?: number | null;
  total_current_assets?: number | null;
  total_current_liabilities?: number | null;
  total_equity?: number | null;
  total_liabilities?: number | null;
  total_non_current_assets?: number | null;
  total_non_current_liabilities?: number | null;
}

export interface TickFlowCashFlowRecord {
  period_end: string;
  announce_date?: string | null;
  capex?: number | null;
  net_cash_change?: number | null;
  net_financing_cash_flow?: number | null;
  net_investing_cash_flow?: number | null;
  net_operating_cash_flow?: number | null;
}

export interface TickFlowIncomeRecord {
  period_end: string;
  announce_date?: string | null;
  admin_expense?: number | null;
  basic_eps?: number | null;
  diluted_eps?: number | null;
  financial_expense?: number | null;
  income_tax?: number | null;
  net_income?: number | null;
  net_income_attributable?: number | null;
  non_operating_expense?: number | null;
  non_operating_income?: number | null;
  operating_cost?: number | null;
  operating_profit?: number | null;
  rd_expense?: number | null;
  revenue?: number | null;
  selling_expense?: number | null;
  total_profit?: number | null;
}

export interface TickFlowFinancialMetricsRecord {
  period_end: string;
  announce_date?: string | null;
  bps?: number | null;
  debt_to_asset_ratio?: number | null;
  eps_basic?: number | null;
  eps_diluted?: number | null;
  gross_margin?: number | null;
  inventory_turnover?: number | null;
  net_income_yoy?: number | null;
  net_margin?: number | null;
  ocfps?: number | null;
  operating_cash_to_revenue?: number | null;
  revenue_yoy?: number | null;
  roa?: number | null;
  roe?: number | null;
  roe_diluted?: number | null;
}
