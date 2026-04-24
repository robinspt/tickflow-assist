export interface MxSelfSelectColumn {
  title: string;
  key: string;
}

export interface MxSelfSelectStock {
  symbol: string;
  rawSymbol: string | null;
  name: string;
  latestPrice: string | null;
  changePercent: string | null;
  changeAmount: string | null;
  turnoverRate: string | null;
  volumeRatio: string | null;
  raw: Record<string, unknown>;
}

export interface MxSelfSelectResult {
  status: number | null;
  code: string | null;
  message: string | null;
  columns: MxSelfSelectColumn[];
  stocks: MxSelfSelectStock[];
  raw: unknown;
}

export interface MxSelfSelectManageResult {
  status: number | null;
  code: string | null;
  message: string | null;
  query: string;
  raw: unknown;
}
