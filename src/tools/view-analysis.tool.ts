import { AnalysisViewProfile, AnalysisViewService } from "../services/analysis-view-service.js";
import { normalizeSymbol } from "../utils/symbol.js";

interface ViewAnalysisInput {
  symbol: string;
  profile: AnalysisViewProfile;
  limit: number;
}

function parseInput(rawInput: unknown): ViewAnalysisInput {
  if (typeof rawInput === "string" && rawInput.trim()) {
    const [symbol, secondToken, thirdToken] = rawInput.trim().split(/\s+/, 3);
    const parsed = parseProfileAndLimit(secondToken, thirdToken);
    return {
      symbol,
      profile: parsed.profile,
      limit: parsed.limit,
    };
  }
  if (typeof rawInput === "object" && rawInput !== null) {
    const input = rawInput as Record<string, unknown>;
    const symbol = String(input.symbol ?? "").trim();
    if (symbol) {
      const explicitLimit = normalizeLimit(input.limit ?? input.count);
      const historyLimit =
        explicitLimit ??
        (Boolean(input.history) ? 5 : undefined);
      return {
        symbol,
        profile: normalizeProfile(input.profile ?? input.view ?? input.section),
        limit: historyLimit ?? 1,
      };
    }
  }
  throw new Error("view-analysis requires a symbol");
}

function parseProfileAndLimit(
  secondToken: string | undefined,
  thirdToken: string | undefined,
): { profile: AnalysisViewProfile; limit: number } {
  const secondLimit = normalizeLimit(secondToken);
  if (secondLimit != null) {
    return {
      profile: "composite",
      limit: secondLimit,
    };
  }

  return {
    profile: normalizeProfile(secondToken),
    limit: normalizeLimit(thirdToken) ?? 1,
  };
}

function normalizeProfile(rawValue: unknown): AnalysisViewProfile {
  const value = String(rawValue ?? "").trim().toLowerCase();
  switch (value) {
    case "technical":
    case "tech":
    case "技术":
    case "技术面":
      return "technical";
    case "financial":
    case "fundamental":
    case "fundamentals":
    case "财务":
    case "基本面":
      return "financial";
    case "news":
    case "info":
    case "资讯":
    case "消息":
    case "研报":
      return "news";
    case "all":
    case "全部":
    case "所有":
      return "all";
    case "composite":
    case "full":
    case "综合":
    case "综合分析":
    case "":
      return "composite";
    default:
      return "composite";
  }
}

function normalizeLimit(rawValue: unknown): number | undefined {
  if (rawValue == null || rawValue === "") {
    return undefined;
  }
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("view-analysis limit must be > 0");
  }
  return Math.min(Math.trunc(value), 20);
}

export function viewAnalysisTool(analysisViewService: AnalysisViewService) {
  return {
    name: "view_analysis",
    description:
      "View latest or recent saved analyses for a symbol. Supports composite, technical, financial, news, or all.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      const input = parseInput(rawInput);
      const symbol = normalizeSymbol(input.symbol);
      return analysisViewService.render(symbol, input.profile, input.limit);
    },
  };
}
