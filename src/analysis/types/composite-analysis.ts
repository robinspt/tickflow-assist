import type { WatchlistItem, KeyLevels } from "../../types/domain.js";
import type { IndicatorRow } from "../../types/indicator.js";
import type { FinancialSnapshot } from "../../services/financial-service.js";
import type { MxSearchDocument } from "../../types/mx-search.js";
import type { TickFlowIntradayKlineRow, TickFlowKlineRow, TickFlowQuote } from "../../types/tickflow.js";
import type { FinancialLiteSnapshot } from "../../services/financial-lite-service.js";

export type FinancialAnalysisMode = "full" | "lite" | "none";

export interface ReviewMemoryContext {
  available: boolean;
  summary: string;
  asOf: string | null;
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
