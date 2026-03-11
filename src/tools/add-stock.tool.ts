import { WatchlistService } from "../services/watchlist-service.js";

interface AddStockInput {
  symbol: string;
  costPrice: number;
}

function parseInput(rawInput: unknown): AddStockInput {
  if (typeof rawInput === "object" && rawInput !== null) {
    const symbol = String((rawInput as Record<string, unknown>).symbol ?? "").trim();
    const costPrice = Number((rawInput as Record<string, unknown>).costPrice ?? NaN);
    if (!symbol || !Number.isFinite(costPrice) || costPrice <= 0) {
      throw new Error("add-stock requires { symbol, costPrice>0 }");
    }
    return { symbol, costPrice };
  }

  if (typeof rawInput === "string") {
    const parts = rawInput.trim().split(/\s+/);
    if (parts.length >= 2) {
      const symbol = parts[0];
      const costPrice = Number(parts[1]);
      if (symbol && Number.isFinite(costPrice) && costPrice > 0) {
        return { symbol, costPrice };
      }
    }
  }

  throw new Error("invalid add-stock input");
}

export function addStockTool(watchlistService: WatchlistService) {
  return {
    name: "add_stock",
    description: "Add a symbol to the watchlist and resolve its instrument name from TickFlow.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      const { symbol, costPrice } = parseInput(rawInput);
      const item = await watchlistService.add(symbol, costPrice);
      return `✅ 已添加: ${item.name}（${item.symbol}），成本价: ${item.costPrice.toFixed(2)}`;
    },
  };
}
