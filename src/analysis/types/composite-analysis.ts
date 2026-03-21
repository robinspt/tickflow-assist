import type { WatchlistItem, KeyLevels, KeyLevelsHistoryEntry } from "../../types/domain.js";
import type { IndicatorRow } from "../../types/indicator.js";
import type { FinancialSnapshot } from "../../services/financial-service.js";
import type { MxSearchDocument } from "../../types/mx-search.js";
import type { TickFlowIntradayKlineRow, TickFlowKlineRow, TickFlowQuote } from "../../types/tickflow.js";
import type { FinancialLiteSnapshot } from "../../services/financial-lite-service.js";

export type FinancialAnalysisMode = "full" | "lite" | "none";
export type MarketBias = "tailwind" | "neutral" | "headwind";
export type NewsImpact = "supportive" | "neutral" | "disruptive";
export type ReviewDecision = "keep" | "adjust" | "recompute" | "invalidate";
export type ValidationVerdict = "validated" | "mixed" | "invalidated" | "unavailable";

export interface ReviewMemoryContext {
  available: boolean;
  summary: string;
  asOf: string | null;
}

export interface MarketIndexSnapshot {
  symbol: string;
  name: string;
  latestClose: number | null;
  prevClose: number | null;
  changePct: number | null;
  intradayClose: number | null;
  aboveMa5: boolean | null;
  aboveMa10: boolean | null;
  summary: string;
}

export interface MarketOverviewContext {
  available: boolean;
  bias: MarketBias;
  summary: string;
  indices: MarketIndexSnapshot[];
}

export interface MarketAnalysisContext {
  symbol: string;
  companyName: string;
  watchlistItem: WatchlistItem | null;
  klines: TickFlowKlineRow[];
  indicators: IndicatorRow[];
  intradayKlines: TickFlowIntradayKlineRow[];
  intradayIndicators: IndicatorRow[];
  realtimeQuote: TickFlowQuote | null;
  reviewMemory: ReviewMemoryContext;
  marketOverview: MarketOverviewContext;
}

export interface FinancialAnalysisContext {
  symbol: string;
  companyName: string;
  mode: FinancialAnalysisMode;
  source: "tickflow" | "mx_select_stock" | "none";
  snapshot: FinancialSnapshot | null;
  liteSnapshot: FinancialLiteSnapshot | null;
  available: boolean;
  note: string | null;
}

export interface NewsAnalysisContext {
  symbol: string;
  companyName: string;
  query: string;
  documents: MxSearchDocument[];
  available: boolean;
  boardQuery: string | null;
  boardDocuments: MxSearchDocument[];
  boardAvailable: boolean;
}

export interface TechnicalSignalResult {
  analysisText: string;
  levels: KeyLevels | null;
}

export interface FinancialInsightResult {
  analysisText: string;
  score: number | null;
  bias: "positive" | "neutral" | "negative";
  strengths: string[];
  risks: string[];
  watchItems: string[];
}

export interface NewsInsightResult {
  analysisText: string;
  score: number | null;
  bias: "positive" | "neutral" | "negative";
  catalysts: string[];
  risks: string[];
  watchItems: string[];
}

export interface CompositeAnalysisInput {
  market: MarketAnalysisContext;
  financial: FinancialAnalysisContext;
  news: NewsAnalysisContext;
  technicalResult: TechnicalSignalResult;
  financialResult: FinancialInsightResult;
  newsResult: NewsInsightResult;
}

export interface CompositeAnalysisResult {
  analysisText: string;
  levels: KeyLevels | null;
}

export interface PriorKeyLevelValidationContext {
  available: boolean;
  snapshotDate: string | null;
  evaluatedTradeDate: string | null;
  verdict: ValidationVerdict;
  snapshot: KeyLevelsHistoryEntry | null;
  summary: string;
  lines: string[];
}

export interface PostCloseReviewInput extends CompositeAnalysisInput {
  compositeResult: CompositeAnalysisResult;
  validation: PriorKeyLevelValidationContext;
}

export interface PostCloseReviewResult {
  analysisText: string;
  decision: ReviewDecision;
  decisionReason: string;
  sessionSummary: string;
  marketSectorSummary: string;
  newsSummary: string;
  actionAdvice: string;
  marketBias: MarketBias;
  sectorBias: MarketBias;
  newsImpact: NewsImpact;
  levels: KeyLevels | null;
}
