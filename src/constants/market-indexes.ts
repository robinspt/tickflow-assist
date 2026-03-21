export interface MarketIndexSpec {
  symbol: string;
  name: string;
}

export const DEFAULT_MARKET_INDEXES: MarketIndexSpec[] = [
  { symbol: "000001.SH", name: "上证指数" },
  { symbol: "399001.SZ", name: "深证成指" },
];
