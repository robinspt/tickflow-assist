import { WatchlistService } from "../services/watchlist-service.js";
import { KlineService } from "../services/kline-service.js";
import { KlinesRepository } from "../storage/repositories/klines-repo.js";
import { IndicatorService } from "../services/indicator-service.js";
import { IndicatorsRepository } from "../storage/repositories/indicators-repo.js";
import type { WatchlistItem } from "../types/domain.js";
import { formatCostPrice } from "../utils/cost-price.js";

interface AddStockInput {
  symbol: string;
  costPrice?: number;
  count?: number;
}

const DEFAULT_ADD_STOCK_KLINE_COUNT = 90;

function parseInput(rawInput: unknown): AddStockInput {
  if (typeof rawInput === "object" && rawInput !== null) {
    const input = rawInput as Record<string, unknown>;
    const symbol = String(input.symbol ?? "").trim();
    const costPrice = parseOptionalPositiveNumber(input.costPrice);
    const count = parseOptionalPositiveNumber(input.klineCount ?? input.count);
    if (!symbol) {
      throw new Error("add-stock requires { symbol }");
    }
    return { symbol, costPrice, count };
  }

  if (typeof rawInput === "string") {
    const parts = rawInput.trim().split(/\s+/, 3).filter(Boolean);
    if (parts.length >= 1) {
      const symbol = parts[0] ?? "";
      const costPrice = parts[1] == null ? undefined : parseOptionalPositiveNumber(parts[1]);
      const count = parts[2] == null ? undefined : parseOptionalPositiveNumber(parts[2]);
      if (symbol) {
        return { symbol, costPrice, count };
      }
    }
  }

  throw new Error("invalid add-stock input");
}

function parseOptionalPositiveNumber(value: unknown): number | undefined {
  if (value == null || String(value).trim() === "") {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("number must be greater than 0");
  }
  return numeric;
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
    description: "Add a symbol to the watchlist with optional cost price, then fetch daily K-lines and indicators.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      let input: AddStockInput;
      try {
        input = parseInput(rawInput);
      } catch (error) {
        return formatAddStockFailure(null, error);
      }

      const { symbol, costPrice, count } = input;
      const klineCount = count ?? DEFAULT_ADD_STOCK_KLINE_COUNT;

      let addResult: Awaited<ReturnType<WatchlistService["add"]>>;
      try {
        addResult = await watchlistService.add(symbol, costPrice ?? null);
      } catch (error) {
        return formatAddStockFailure(symbol, error);
      }

      const { item, profileError } = addResult;

      try {
        const rows = await klineService.fetchKlines(item.symbol, {
          count: klineCount,
          adjust: "forward",
        });

        if (rows.length === 0) {
          return [
            ...buildAddStockPrefix(item, profileError),
            `⚠️ 已尝试拉取 ${klineCount} 天日K，但返回数据为空`,
          ].filter(Boolean).join("\n");
        }

        await klinesRepository.saveAll(item.symbol, rows);
        const indicators = await indicatorService.calculate(rows);
        await indicatorsRepository.saveAll(item.symbol, indicators);

        const first = rows[0];
        const last = rows[rows.length - 1];
        return [
          ...buildAddStockPrefix(item, profileError),
          `📊 已自动获取日K: ${rows.length} 根`,
          `区间: ${first.trade_date} ~ ${last.trade_date}`,
          `最新收盘: ${last.close.toFixed(2)}`,
          `🔧 技术指标已计算并写入数据库`,
        ].filter(Boolean).join("\n");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [
          ...buildAddStockPrefix(item, profileError),
          `⚠️ 自动拉取 ${klineCount} 天日K失败: ${message}`,
        ].filter(Boolean).join("\n");
      }
    },
  };
}

function buildAddStockPrefix(item: WatchlistItem, profileError: string | null): string[] {
  return [
    `✅ 已添加: ${item.name}（${item.symbol}），成本价: ${formatCostPrice(item.costPrice)}`,
    formatWatchlistProfile(item),
    formatWatchlistProfileWarning(profileError),
  ].filter((value): value is string => Boolean(value));
}

function formatWatchlistProfile(item: WatchlistItem): string | null {
  const parts = [
    item.sector ? `行业分类: ${item.sector}` : null,
    item.themes.length > 0 ? `概念板块: ${item.themes.join("、")}` : null,
  ].filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  return `🏷️ ${parts.join(" | ")}`;
}

function formatWatchlistProfileWarning(profileError: string | null): string | null {
  if (!profileError) {
    return null;
  }
  return `⚠️ 行业分类/概念板块获取失败: ${profileError}`;
}

function formatAddStockFailure(symbol: string | null, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!symbol) {
    return `添加失败😔 请求参数无效：${message}`;
  }
  return `添加失败😔 ${symbol} 暂时无法添加：${message}`;
}
