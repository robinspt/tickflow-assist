export interface IndicatorRow {
  symbol?: string;
  trade_date: string;
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
