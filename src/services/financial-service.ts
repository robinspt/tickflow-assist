import type {
  TickFlowBalanceSheetRecord,
  TickFlowCashFlowRecord,
  TickFlowFinancialMetricsRecord,
  TickFlowFinancialQueryOptions,
  TickFlowIncomeRecord,
} from "../types/tickflow.js";
import { TickFlowClient } from "./tickflow-client.js";

export type FinancialSection = "income" | "metrics" | "cash_flow" | "balance_sheet";

export const ALL_FINANCIAL_SECTIONS: FinancialSection[] = [
  "income",
  "metrics",
  "cash_flow",
  "balance_sheet",
];

export interface FinancialSnapshot {
  symbol: string;
  income: TickFlowIncomeRecord[];
  metrics: TickFlowFinancialMetricsRecord[];
  cashFlow: TickFlowCashFlowRecord[];
  balanceSheet: TickFlowBalanceSheetRecord[];
}

export class FinancialService {
  constructor(private readonly client: TickFlowClient) {}

  async fetchIncome(
    symbol: string,
    options: TickFlowFinancialQueryOptions = {},
  ): Promise<TickFlowIncomeRecord[]> {
    const response = await this.client.fetchIncome([symbol], options);
    return sortFinancialRecords(response.data?.[symbol] ?? []);
  }

  async fetchMetrics(
    symbol: string,
    options: TickFlowFinancialQueryOptions = {},
  ): Promise<TickFlowFinancialMetricsRecord[]> {
    const response = await this.client.fetchFinancialMetrics([symbol], options);
    return sortFinancialRecords(response.data?.[symbol] ?? []);
  }

  async fetchCashFlow(
    symbol: string,
    options: TickFlowFinancialQueryOptions = {},
  ): Promise<TickFlowCashFlowRecord[]> {
    const response = await this.client.fetchCashFlow([symbol], options);
    return sortFinancialRecords(response.data?.[symbol] ?? []);
  }

  async fetchBalanceSheet(
    symbol: string,
    options: TickFlowFinancialQueryOptions = {},
  ): Promise<TickFlowBalanceSheetRecord[]> {
    const response = await this.client.fetchBalanceSheet([symbol], options);
    return sortFinancialRecords(response.data?.[symbol] ?? []);
  }

  async fetchSnapshot(
    symbol: string,
    options: TickFlowFinancialQueryOptions = {},
    sections: FinancialSection[] = ALL_FINANCIAL_SECTIONS,
  ): Promise<FinancialSnapshot> {
    const requested = new Set(sections);
    const [income, metrics, cashFlow, balanceSheet] = await Promise.all([
      requested.has("income") ? this.fetchIncome(symbol, options) : Promise.resolve([]),
      requested.has("metrics") ? this.fetchMetrics(symbol, options) : Promise.resolve([]),
      requested.has("cash_flow") ? this.fetchCashFlow(symbol, options) : Promise.resolve([]),
      requested.has("balance_sheet") ? this.fetchBalanceSheet(symbol, options) : Promise.resolve([]),
    ]);

    return {
      symbol,
      income,
      metrics,
      cashFlow,
      balanceSheet,
    };
  }
}

function sortFinancialRecords<T extends { period_end: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => right.period_end.localeCompare(left.period_end));
}
