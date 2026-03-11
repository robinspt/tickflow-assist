import { WatchlistService } from "../services/watchlist-service.js";

function parseSymbol(rawInput: unknown): string {
  if (typeof rawInput === "string" && rawInput.trim()) {
    return rawInput.trim();
  }

  if (typeof rawInput === "object" && rawInput !== null) {
    const symbol = String((rawInput as Record<string, unknown>).symbol ?? "").trim();
    if (symbol) {
      return symbol;
    }
  }

  throw new Error("remove-stock requires a symbol");
}

export function removeStockTool(watchlistService: WatchlistService) {
  return {
    name: "remove_stock",
    description: "Remove a symbol from the watchlist.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      const symbol = parseSymbol(rawInput);
      const removed = await watchlistService.remove(symbol);
      if (!removed) {
        return `⚠️ 未找到该股票: ${symbol}`;
      }
      return `✅ 已从关注列表移除: ${symbol}`;
    },
  };
}
