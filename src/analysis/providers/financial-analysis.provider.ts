import type { TickflowApiKeyLevel } from "../../config/tickflow-access.js";
import { FinancialService } from "../../services/financial-service.js";
import { FinancialLiteService } from "../../services/financial-lite-service.js";
import type { FinancialAnalysisContext } from "../types/composite-analysis.js";

export class FinancialAnalysisProvider {
  constructor(
    private readonly tickflowApiKeyLevel: TickflowApiKeyLevel,
    private readonly financialService: FinancialService,
    private readonly financialLiteService: FinancialLiteService,
  ) {}

  async load(symbol: string, companyName: string): Promise<FinancialAnalysisContext> {
    if (this.tickflowApiKeyLevel === "expert") {
      try {
        const snapshot = await this.financialService.fetchSnapshot(symbol, { latest: true });
        const available =
          snapshot.income.length > 0 ||
          snapshot.metrics.length > 0 ||
          snapshot.cashFlow.length > 0 ||
          snapshot.balanceSheet.length > 0;

        if (available) {
          return {
            symbol,
            companyName,
            mode: "full",
            source: "tickflow",
            snapshot,
            liteSnapshot: null,
            available: true,
            note: null,
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[analyze] financial full fetch skipped for ${symbol}: ${message}`);
        const liteContext = await this.loadLite(symbol, companyName, `tickflow_full_failed: ${message}`);
        if (liteContext) {
          return liteContext;
        }
        return buildUnavailableFinancialContext(symbol, companyName, `tickflow_full_failed: ${message}`);
      }
    }

    const liteReason =
      this.tickflowApiKeyLevel === "expert"
        ? "tickflow_full_empty"
        : `tickflow_level_${this.tickflowApiKeyLevel}_uses_lite`;
    const liteContext = await this.loadLite(symbol, companyName, liteReason);
    if (liteContext) {
      return liteContext;
    }

    return buildUnavailableFinancialContext(symbol, companyName, liteReason);
  }

  private async loadLite(
    symbol: string,
    companyName: string,
    note: string,
  ): Promise<FinancialAnalysisContext | null> {
    try {
      const snapshot = await this.financialLiteService.fetchSnapshot(symbol, companyName);
      if (!snapshot || snapshot.metrics.length === 0) {
        return null;
      }
      return {
        symbol,
        companyName,
        mode: "lite",
        source: "mx_select_stock",
        snapshot: null,
        liteSnapshot: snapshot,
        available: true,
        note,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[analyze] financial lite fetch skipped for ${symbol}: ${message}`);
      return null;
    }
  }
}

function buildUnavailableFinancialContext(
  symbol: string,
  companyName: string,
  note: string,
): FinancialAnalysisContext {
  return {
    symbol,
    companyName,
    mode: "none",
    source: "none",
    snapshot: null,
    liteSnapshot: null,
    available: false,
    note,
  };
}
