import { FinancialService } from "../../services/financial-service.js";
import type { FinancialAnalysisContext } from "../types/composite-analysis.js";

export class FinancialAnalysisProvider {
  constructor(private readonly financialService: FinancialService) {}

  async load(symbol: string, companyName: string): Promise<FinancialAnalysisContext> {
    try {
      const snapshot = await this.financialService.fetchSnapshot(symbol, { latest: true });
      const available =
        snapshot.income.length > 0 ||
        snapshot.metrics.length > 0 ||
        snapshot.cashFlow.length > 0 ||
        snapshot.balanceSheet.length > 0;

      return {
        symbol,
        companyName,
        snapshot: available ? snapshot : null,
        available,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[analyze] financial fetch skipped for ${symbol}: ${message}`);
      return {
        symbol,
        companyName,
        snapshot: null,
        available: false,
      };
    }
  }
}
