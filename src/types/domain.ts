export interface WatchlistItem {
  symbol: string;
  name: string;
  costPrice: number;
  addedAt: string;
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
