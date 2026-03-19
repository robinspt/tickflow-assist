import type { WatchlistItem, KeyLevels } from "../../types/domain.js";
import type { IndicatorRow } from "../../types/indicator.js";
import type { FinancialSnapshot } from "../../services/financial-service.js";
import type { MxSearchDocument } from "../../types/mx-search.js";
import type { TickFlowIntradayKlineRow, TickFlowKlineRow, TickFlowQuote } from "../../types/tickflow.js";

export interface MarketAnalysisContext {
  symbol: string;
  companyName: string;
  watchlistItem: WatchlistItem | null;
  klines: TickFlowKlineRow[];
  indicators: IndicatorRow[];
  intradayKlines: TickFlowIntradayKlineRow[];
  intradayIndicators: IndicatorRow[];
  realtimeQuote: TickFlowQuote | null;
}

export interface FinancialAnalysisContext {
  symbol: string;
  companyName: string;
  snapshot: FinancialSnapshot | null;
  available: boolean;
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
