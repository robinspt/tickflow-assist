export interface WatchlistItem {
  symbol: string;
  name: string;
  costPrice: number | null;
  addedAt: string;
  sector: string | null;
  themes: string[];
  themeQuery: string | null;
  themeUpdatedAt: string | null;
}

export interface QuoteSnapshot {
  symbol: string;
  name: string;
  lastPrice: number;
  prevClose: number;
  timestamp: number;
}

export interface KeyLevels {
  symbol?: string;
  analysis_date?: string;
  current_price: number;
  stop_loss?: number | null;
  breakthrough?: number | null;
  support?: number | null;
  cost_level?: number | null;
  resistance?: number | null;
  take_profit?: number | null;
  gap?: number | null;
  target?: number | null;
  round_number?: number | null;
  analysis_text: string;
  score: number;
}

export interface AnalysisLogEntry {
  symbol: string;
  analysis_date: string;
  analysis_text: string;
  structured_ok: boolean;
}

export type AnalysisBias = "positive" | "neutral" | "negative";

export interface AnalysisLevelsSnapshot {
  current_price: number | null;
  stop_loss: number | null;
  breakthrough: number | null;
  support: number | null;
  cost_level: number | null;
  resistance: number | null;
  take_profit: number | null;
  gap: number | null;
  target: number | null;
  round_number: number | null;
  score: number | null;
}

export interface KeyLevelsHistoryEntry extends AnalysisLevelsSnapshot {
  symbol: string;
  analysis_date: string;
  activated_at: string;
  profile: "composite";
  analysis_text: string;
}

export interface TechnicalAnalysisEntry extends AnalysisLevelsSnapshot {
  symbol: string;
  analysis_date: string;
  analysis_text: string;
  structured_ok: boolean;
}

export interface FinancialAnalysisEvidence {
  available: boolean;
  mode?: "full" | "lite" | "none";
  source?: "tickflow" | "mx_select_stock" | "none";
  note?: string | null;
  latest_period_end: string | null;
  latest_announce_date: string | null;
  income_count: number;
  metrics_count: number;
  cash_flow_count: number;
  balance_sheet_count: number;
  lite_as_of?: string | null;
  lite_query?: string | null;
  lite_metric_count?: number;
  lite_metric_labels?: string[];
}

export interface FinancialAnalysisEntry {
  symbol: string;
  analysis_date: string;
  analysis_text: string;
  score: number | null;
  bias: AnalysisBias;
  strengths: string[];
  risks: string[];
  watch_items: string[];
  evidence: FinancialAnalysisEvidence;
}

export interface NewsAnalysisEvidenceItem {
  title: string;
  source: string | null;
  published_at: string | null;
  securities: string[];
}

export interface NewsAnalysisEvidence {
  available: boolean;
  source_count: number;
  documents: NewsAnalysisEvidenceItem[];
}

export interface NewsAnalysisEntry {
  symbol: string;
  analysis_date: string;
  query: string;
  analysis_text: string;
  score: number | null;
  bias: AnalysisBias;
  catalysts: string[];
  risks: string[];
  watch_items: string[];
  source_count: number;
  evidence: NewsAnalysisEvidence;
}

export interface CompositeAnalysisEvidence {
  technical_structured: boolean;
  financial_available: boolean;
  financial_mode?: "full" | "lite" | "none";
  financial_source?: "tickflow" | "mx_select_stock" | "none";
  financial_latest_period_end: string | null;
  financial_lite_as_of?: string | null;
  news_available: boolean;
  news_query: string;
  news_source_count: number;
}

export interface CompositeAnalysisEntry extends AnalysisLevelsSnapshot {
  symbol: string;
  analysis_date: string;
  analysis_text: string;
  structured_ok: boolean;
  technical_score: number | null;
  financial_score: number | null;
  news_score: number | null;
  financial_bias: AnalysisBias;
  news_bias: AnalysisBias;
  evidence: CompositeAnalysisEvidence;
}
