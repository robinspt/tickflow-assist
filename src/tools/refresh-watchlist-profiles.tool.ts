import { WatchlistService } from "../services/watchlist-service.js";
import { normalizeSymbol } from "../utils/symbol.js";

interface RefreshWatchlistProfilesInput {
  symbol?: string;
  force?: boolean;
}

function parseInput(rawInput: unknown): RefreshWatchlistProfilesInput {
  if (typeof rawInput === "object" && rawInput !== null) {
    const input = rawInput as Record<string, unknown>;
    const symbol = String(input.symbol ?? "").trim();
    const forceRaw = input.force;
    return {
      symbol: symbol || undefined,
      force: typeof forceRaw === "boolean" ? forceRaw : undefined,
    };
  }

  if (typeof rawInput === "string") {
    const symbol = rawInput.trim();
    return symbol ? { symbol } : {};
  }

  return {};
}

export function refreshWatchlistProfilesTool(watchlistService: WatchlistService) {
  return {
    name: "refresh_watchlist_profiles",
    description: "Refresh industry and concept metadata for the whole watchlist or one symbol.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      const input = parseInput(rawInput);
      const result = await watchlistService.refreshProfiles({
        symbol: input.symbol,
        force: input.force ?? true,
      });

      if (result.targetCount === 0) {
        return input.symbol
          ? `⚠️ 自选列表中未找到该股票: ${normalizeSymbol(input.symbol)}`
          : "⚠️ 当前自选列表为空";
      }

      const lines = [
        `🔄 行业分类/概念板块刷新完成: 目标 ${result.targetCount} 只 | 资料更新 ${result.updated.length} | 已复核 ${result.rechecked.length} | 失败 ${result.failed.length}`,
      ];

      if (result.updated.length > 0) {
        lines.push("", "已更新:");
        for (const item of result.updated) {
          lines.push(formatProfileLine(item));
        }
      }

      if (input.symbol && result.rechecked.length > 0) {
        lines.push("", "复核结果:");
        for (const item of result.rechecked) {
          lines.push(formatProfileLine(item));
        }
      }

      if (!input.symbol && result.rechecked.length > 0) {
        lines.push("", `• 已复核 ${result.rechecked.length} 只，资料未变化`);
      }

      if (result.failed.length > 0) {
        lines.push("", "失败:");
        for (const item of result.failed) {
          lines.push(`• ${item.name || item.symbol}（${item.symbol}）: ${item.error}`);
        }
      }

      return lines.join("\n");
    },
  };
}

function formatProfileLine(item: {
  symbol: string;
  name: string;
  sector: string | null;
  themes: string[];
  themeUpdatedAt: string | null;
}): string {
  const sector = item.sector ?? "未识别";
  const themes = item.themes.length > 0 ? item.themes.join("、") : "未识别";
  const updatedAt = item.themeUpdatedAt ?? "未记录";
  return `• ${item.name}（${item.symbol}） | 行业分类: ${sector} | 概念板块: ${themes} | 更新时间: ${updatedAt}`;
}
