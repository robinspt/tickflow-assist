export interface TickFlowInstrument {
  symbol: string;
  name?: string | null;
  exchange: string;
  code: string;
  region: string;
  type?: string | null;
}

export interface TickFlowQuote {
  symbol: string;
  last_price: number;
  prev_close: number;
  timestamp: number;
  volume?: number;
  ext?: {
    name?: string;
    change_pct?: number;
  };
}

export interface TickFlowCompactKline {
  timestamp: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  amount: number[];
  prev_close?: number[];
  open_interest?: number[];
  settlement_price?: number[];
}

export interface TickFlowKlineRow {
  symbol: string;
  trade_date: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  prev_close: number;
}

export interface TickFlowIntradayKlineRow {
  symbol: string;
  period: string;
  trade_date: string;
  trade_time: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  prev_close: number;
  open_interest: number | null;
  settlement_price: number | null;
}
