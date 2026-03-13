export interface IndicatorInputRow {
  trade_date: string;
  trade_time?: string;
  period?: string;
  timestamp?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  prev_close?: number;
}

export interface IndicatorRow {
  symbol?: string;
  trade_date: string;
  trade_time?: string;
  period?: string;
  timestamp?: number;
  ma5?: number | null;
  ma10?: number | null;
  ma20?: number | null;
  ma60?: number | null;
  macd?: number | null;
  macd_signal?: number | null;
  macd_hist?: number | null;
  kdj_k?: number | null;
  kdj_d?: number | null;
  kdj_j?: number | null;
  rsi_6?: number | null;
  rsi_12?: number | null;
  rsi_24?: number | null;
  cci?: number | null;
  bias_6?: number | null;
  bias_12?: number | null;
  bias_24?: number | null;
  plus_di?: number | null;
  minus_di?: number | null;
  adx?: number | null;
  boll_upper?: number | null;
  boll_mid?: number | null;
  boll_lower?: number | null;
}
