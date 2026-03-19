import { CompositeAnalysisOrchestrator } from "../analysis/orchestrators/composite-analysis.orchestrator.js";
import { normalizeSymbol } from "../utils/symbol.js";

function parseSymbol(rawInput: unknown): string {
  if (typeof rawInput === "string" && rawInput.trim()) {
    return rawInput.trim();
  }
  if (typeof rawInput === "object" && rawInput !== null) {
    const symbol = String((rawInput as Record<string, unknown>).symbol ?? "").trim();
    if (symbol) {
      return symbol;
    }
  }
  throw new Error("analyze requires a symbol");
}

export function analyzeTool(compositeAnalysisOrchestrator: CompositeAnalysisOrchestrator) {
  return {
    name: "analyze",
    description:
      "Run fixed-pipeline stock analysis using technical data, financial data, and timely market information.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      const symbol = normalizeSymbol(parseSymbol(rawInput));
      const result = await compositeAnalysisOrchestrator.analyze(symbol);
      return compositeAnalysisOrchestrator.formatForUser(result);
    },
  };
}
