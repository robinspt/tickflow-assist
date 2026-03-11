import { normalizeSymbol } from "../utils/symbol.js";
import { KlineService } from "../services/kline-service.js";
import { KlinesRepository } from "../storage/repositories/klines-repo.js";
import { IndicatorService } from "../services/indicator-service.js";
import { IndicatorsRepository } from "../storage/repositories/indicators-repo.js";

interface FetchKlinesInput {
  symbol: string;
  count?: number;
  adjust?: string;
}

function parseInput(rawInput: unknown): FetchKlinesInput {
  if (typeof rawInput === "object" && rawInput !== null) {
    const obj = rawInput as Record<string, unknown>;
    const symbol = String(obj.symbol ?? "").trim();
    const count = obj.count == null ? undefined : Number(obj.count);
    const adjust = obj.adjust == null ? undefined : String(obj.adjust);
    if (!symbol) {
      throw new Error("fetch-klines requires symbol");
    }
    return { symbol, count, adjust };
  }

  if (typeof rawInput === "string" && rawInput.trim()) {
    const parts = rawInput.trim().split(/\s+/);
    return {
      symbol: parts[0],
      count: parts[1] ? Number(parts[1]) : undefined,
    };
  }

  throw new Error("invalid fetch-klines input");
}

export function fetchKlinesTool(
  klineService: KlineService,
  klinesRepository: KlinesRepository,
  indicatorService: IndicatorService,
  indicatorsRepository: IndicatorsRepository,
) {
  return {
    name: "fetch_klines",
    description: "Fetch daily K-lines from TickFlow and return a normalized summary.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      const input = parseInput(rawInput);
      const symbol = normalizeSymbol(input.symbol);
      const rows = await klineService.fetchKlines(symbol, {
        count: input.count ?? 90,
        adjust: input.adjust ?? "forward",
      });

      if (rows.length === 0) {
        return `⚠️ 未获取到 ${symbol} 的日K线数据`;
      }

      await klinesRepository.saveAll(symbol, rows);
      const indicators = await indicatorService.calculate(rows);
      await indicatorsRepository.saveAll(symbol, indicators);

      const first = rows[0];
      const last = rows[rows.length - 1];
      const latestIndicator = indicators[indicators.length - 1];
      return [
        `📊 获取 ${symbol} 日K线数据完成`,
        `数量: ${rows.length} 根`,
        `区间: ${first.trade_date} ~ ${last.trade_date}`,
        `最新收盘: ${last.close.toFixed(2)}`,
        `💾 K线数据已写入数据库`,
        `🔧 技术指标已计算并写入数据库`,
        latestIndicator
          ? `最新指标: MA5 ${formatIndicator(latestIndicator.ma5)} | MA10 ${formatIndicator(latestIndicator.ma10)} | RSI6 ${formatIndicator(latestIndicator.rsi_6)}`
          : `最新指标: 暂无`,
      ].join("\n");
    },
  };
}

function formatIndicator(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return value.toFixed(2);
}
