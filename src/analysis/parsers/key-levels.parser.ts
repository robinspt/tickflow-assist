import type { KeyLevels } from "../../types/domain.js";

type PriceFieldKey =
  | "current_price"
  | "stop_loss"
  | "breakthrough"
  | "support"
  | "cost_level"
  | "resistance"
  | "take_profit"
  | "gap"
  | "target"
  | "round_number";

const PRICE_FIELDS: Array<[string, PriceFieldKey]> = [
  ["当前价格", "current_price"],
  ["止损位", "stop_loss"],
  ["突破位", "breakthrough"],
  ["支撑位", "support"],
  ["成本位", "cost_level"],
  ["压力位", "resistance"],
  ["止盈位", "take_profit"],
  ["缺口位", "gap"],
  ["目标位", "target"],
  ["整数关", "round_number"],
];

export function parseKeyLevels(responseText: string): KeyLevels | null {
  const fenced = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  const candidate = fenced?.[1] ?? responseText.match(/\{[\s\S]*"current_price"[\s\S]*\}/)?.[0];
  if (!candidate) {
    return null;
  }

  try {
    return JSON.parse(candidate) as KeyLevels;
  } catch {
    return null;
  }
}

export function extractAnalysisConclusion(analysisText: string): string {
  return analysisText.replace(/```json\s*[\s\S]*?\s*```/g, "").trim();
}

export function validateKeyLevels(levels: KeyLevels): void {
  if (!(levels.current_price > 0)) {
    throw new Error(`current_price must be > 0, got ${levels.current_price}`);
  }
  if (!Number.isInteger(levels.score) || levels.score < 1 || levels.score > 10) {
    throw new Error(`score must be integer 1-10, got ${levels.score}`);
  }
  for (const [, key] of PRICE_FIELDS.slice(1)) {
    if (key === "gap") {
      continue;
    }
    const value = levels[key];
    if (value != null && value < 0) {
      throw new Error(`${String(key)} must be >= 0, got ${value}`);
    }
  }
  if (levels.gap != null && !Number.isFinite(levels.gap)) {
    throw new Error(`gap must be a finite number, got ${levels.gap}`);
  }
}

export function formatKeyLevelsAnalysis(analysisText: string, levels: KeyLevels | null): string {
  const conclusion = extractAnalysisConclusion(analysisText);
  const lines = [conclusion];

  if (levels) {
    lines.push("", "📊 关键价位汇总:");
    for (const [label, key] of PRICE_FIELDS) {
      const value = levels[key];
      lines.push(`  ${label}: ${value != null ? value.toFixed(2) : "暂无"}`);
    }
    lines.push("", `  技术面评分: ${levels.score}/10`);
  }

  return lines.join("\n");
}
