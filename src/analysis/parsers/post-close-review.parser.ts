import type { KeyLevels } from "../../types/domain.js";
import type {
  MarketBias,
  NewsImpact,
  PostCloseReviewResult,
  ReviewDecision,
} from "../types/composite-analysis.js";
import { parseJsonBlock } from "./json-block.parser.js";

interface PostCloseReviewJson {
  session_summary?: unknown;
  market_sector_summary?: unknown;
  news_summary?: unknown;
  decision?: unknown;
  decision_reason?: unknown;
  action_advice?: unknown;
  market_bias?: unknown;
  sector_bias?: unknown;
  news_impact?: unknown;
  levels?: Record<string, unknown> | null;
}

export function parsePostCloseReviewPayload(analysisText: string): Omit<PostCloseReviewResult, "analysisText"> {
  const parsed = parseJsonBlock<PostCloseReviewJson>(analysisText) ?? {};
  return {
    decision: normalizeDecision(parsed.decision),
    decisionReason: normalizeText(parsed.decision_reason),
    sessionSummary: normalizeText(parsed.session_summary),
    marketSectorSummary: normalizeText(parsed.market_sector_summary),
    newsSummary: normalizeText(parsed.news_summary),
    actionAdvice: normalizeText(parsed.action_advice),
    marketBias: normalizeMarketBias(parsed.market_bias),
    sectorBias: normalizeMarketBias(parsed.sector_bias),
    newsImpact: normalizeNewsImpact(parsed.news_impact),
    levels: normalizeLevels(parsed.levels),
  };
}

function normalizeDecision(value: unknown): ReviewDecision {
  switch (String(value ?? "").trim().toLowerCase()) {
    case "keep":
    case "adjust":
    case "recompute":
    case "invalidate":
      return String(value).trim().toLowerCase() as ReviewDecision;
    default:
      return "recompute";
  }
}

function normalizeMarketBias(value: unknown): MarketBias {
  switch (String(value ?? "").trim().toLowerCase()) {
    case "tailwind":
    case "headwind":
      return String(value).trim().toLowerCase() as MarketBias;
    default:
      return "neutral";
  }
}

function normalizeNewsImpact(value: unknown): NewsImpact {
  switch (String(value ?? "").trim().toLowerCase()) {
    case "supportive":
    case "disruptive":
      return String(value).trim().toLowerCase() as NewsImpact;
    default:
      return "neutral";
  }
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeLevels(value: Record<string, unknown> | null | undefined): KeyLevels | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const currentPrice = Number(value.current_price ?? NaN);
  const score = Number(value.score ?? NaN);
  if (!Number.isFinite(currentPrice) || !Number.isFinite(score)) {
    return null;
  }

  return {
    current_price: currentPrice,
    stop_loss: toNullableNumber(value.stop_loss),
    breakthrough: toNullableNumber(value.breakthrough),
    support: toNullableNumber(value.support),
    cost_level: toNullableNumber(value.cost_level),
    resistance: toNullableNumber(value.resistance),
    take_profit: toNullableNumber(value.take_profit),
    gap: toNullableNumber(value.gap),
    target: toNullableNumber(value.target),
    round_number: toNullableNumber(value.round_number),
    score: Math.max(1, Math.min(10, Math.trunc(score))),
    analysis_text: "",
  };
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
