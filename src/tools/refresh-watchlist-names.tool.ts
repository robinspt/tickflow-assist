import { WatchlistService } from "../services/watchlist-service.js";

export function refreshWatchlistNamesTool(watchlistService: WatchlistService) {
  return {
    name: "refresh_watchlist_names",
    description: "Refresh instrument names in watchlist from TickFlow metadata.",
    async run(): Promise<string> {
      const result = await watchlistService.refreshNames();
      const lines = [
        `🔄 名称刷新完成: 更新 ${result.updated.length} 只, 保持不变 ${result.unchanged.length} 只`,
      ];

      for (const item of result.updated) {
        lines.push(`• ${item.symbol} -> ${item.name}`);
      }

      return lines.join("\n");
    },
  };
}
