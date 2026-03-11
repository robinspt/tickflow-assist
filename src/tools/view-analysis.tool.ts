import { AnalysisService } from "../services/analysis-service.js";
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
  throw new Error("view-analysis requires a symbol");
}

export function viewAnalysisTool(analysisService: AnalysisService) {
  return {
    name: "view_analysis",
    description: "View the latest saved analysis text for a symbol.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      const symbol = normalizeSymbol(parseSymbol(rawInput));
      const latest = await analysisService.getLatestAnalysis(symbol);
      if (!latest) {
        return `⚠️ 暂无 ${symbol} 的分析记录`;
      }
      return [
        `📝 最近一次分析: ${symbol}`,
        `日期: ${latest.analysis_date}`,
        `结构化解析: ${latest.structured_ok ? "成功" : "失败"}`,
        "",
        latest.analysis_text,
      ].join("\n");
    },
  };
}
