import { WatchlistService } from "../services/watchlist-service.js";
import { formatCostPrice } from "../utils/cost-price.js";

export function listWatchlistTool(watchlistService: WatchlistService) {
  return {
    name: "list_watchlist",
    description: "List current watchlist symbols with names, optional cost price, and industry/concept metadata.",
    async run(): Promise<string> {
      const items = await watchlistService.list();
      if (items.length === 0) {
        return "📋 关注列表为空";
      }

      const lines = [`📋 当前关注列表 (${items.length} 只):`];
      for (const item of items) {
        const tags = [
          item.sector ? `行业分类 ${item.sector}` : null,
          item.themes.length > 0 ? `概念板块 ${item.themes.join("、")}` : null,
        ].filter(Boolean);
        lines.push(
          `• ${item.name}（${item.symbol}） 成本: ${formatCostPrice(item.costPrice)}${tags.length > 0 ? ` | ${tags.join(" | ")}` : ""}`,
        );
      }
      return lines.join("\n");
    },
  };
}
