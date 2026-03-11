import { WatchlistService } from "../services/watchlist-service.js";
import { KlineService } from "../services/kline-service.js";
import { KlinesRepository } from "../storage/repositories/klines-repo.js";
import { IndicatorService } from "../services/indicator-service.js";
import { IndicatorsRepository } from "../storage/repositories/indicators-repo.js";

interface AddStockInput {
  symbol: string;
  costPrice: number;
  count?: number;
}

const DEFAULT_ADD_STOCK_KLINE_COUNT = 90;

function parseInput(rawInput: unknown): AddStockInput {
  if (typeof rawInput === "object" && rawInput !== null) {
    const input = rawInput as Record<string, unknown>;
    const symbol = String(input.symbol ?? "").trim();
    const costPrice = Number(input.costPrice ?? NaN);
    const countRaw = input.klineCount ?? input.count;
    const count = countRaw == null ? undefined : Number(countRaw);
    if (!symbol || !Number.isFinite(costPrice) || costPrice <= 0) {
      throw new Error("add-stock requires { symbol, costPrice>0 }");
    }
    if (count != null && (!Number.isFinite(count) || count <= 0)) {
      throw new Error("add-stock count must be > 0");
    }
    return { symbol, costPrice, count };
  }

  if (typeof rawInput === "string") {
    const parts = rawInput.trim().split(/\s+/);
    if (parts.length >= 2) {
      const symbol = parts[0];
      const costPrice = Number(parts[1]);
      const count = parts[2] ? Number(parts[2]) : undefined;
      if (
        symbol &&
        Number.isFinite(costPrice) &&
        costPrice > 0 &&
        (count == null || (Number.isFinite(count) && count > 0))
      ) {
        return { symbol, costPrice, count };
      }
    }
  }

  throw new Error("invalid add-stock input");
}

export function addStockTool(
  watchlistService: WatchlistService,
  klineService: KlineService,
  klinesRepository: KlinesRepository,
  indicatorService: IndicatorService,
  indicatorsRepository: IndicatorsRepository,
) {
  return {
    name: "add_stock",
    description: "Add a symbol to the watchlist, then fetch daily K-lines and indicators.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      const { symbol, costPrice, count } = parseInput(rawInput);
      const item = await watchlistService.add(symbol, costPrice);
      const klineCount = count ?? DEFAULT_ADD_STOCK_KLINE_COUNT;

      try {
        const rows = await klineService.fetchKlines(item.symbol, {
          count: klineCount,
          adjust: "forward",
        });

        if (rows.length === 0) {
          return [
            `✅ 已添加: ${item.name}（${item.symbol}），成本价: ${item.costPrice.toFixed(2)}`,
            `⚠️ 已尝试拉取 ${klineCount} 天日K，但返回数据为空`,
          ].join("\n");
        }

        await klinesRepository.saveAll(item.symbol, rows);
        const indicators = await indicatorService.calculate(rows);
        await indicatorsRepository.saveAll(item.symbol, indicators);

        const first = rows[0];
        const last = rows[rows.length - 1];
        return [
          `✅ 已添加: ${item.name}（${item.symbol}），成本价: ${item.costPrice.toFixed(2)}`,
          `📊 已自动获取日K: ${rows.length} 根`,
          `区间: ${first.trade_date} ~ ${last.trade_date}`,
          `最新收盘: ${last.close.toFixed(2)}`,
          `🔧 技术指标已计算并写入数据库`,
        ].join("\n");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [
          `✅ 已添加: ${item.name}（${item.symbol}），成本价: ${item.costPrice.toFixed(2)}`,
          `⚠️ 自动拉取 ${klineCount} 天日K失败: ${message}`,
        ].join("\n");
      }
    },
  };
}
