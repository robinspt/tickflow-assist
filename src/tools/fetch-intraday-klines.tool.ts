import {
  formatTickflowApiKeyLevel,
  supportsIntradayKlines,
  type TickflowApiKeyLevel,
} from "../config/tickflow-access.js";
import { normalizeSymbol } from "../utils/symbol.js";
import { KlineService } from "../services/kline-service.js";
import { TradingCalendarService } from "../services/trading-calendar-service.js";
import { IntradayKlinesRepository } from "../storage/repositories/intraday-klines-repo.js";

const FETCH_INTRADAY_RETENTION_DAYS = 10;

interface FetchIntradayKlinesInput {
  symbol: string;
  period?: string;
  count?: number;
}

function parseInput(rawInput: unknown): FetchIntradayKlinesInput {
  if (typeof rawInput === "object" && rawInput !== null) {
    const obj = rawInput as Record<string, unknown>;
    const symbol = String(obj.symbol ?? "").trim();
    const period = obj.period == null ? undefined : String(obj.period).trim();
    const count = obj.count == null ? undefined : Number(obj.count);
    if (!symbol) {
      throw new Error("fetch-intraday-klines requires symbol");
    }
    return { symbol, period, count };
  }

  if (typeof rawInput === "string" && rawInput.trim()) {
    const parts = rawInput.trim().split(/\s+/);
    return {
      symbol: parts[0] ?? "",
      period: parts[1] || undefined,
      count: parts[2] ? Number(parts[2]) : undefined,
    };
  }

  throw new Error("invalid fetch-intraday-klines input");
}

export function fetchIntradayKlinesTool(
  tickflowApiKeyLevel: TickflowApiKeyLevel,
  klineService: KlineService,
  intradayKlinesRepository: IntradayKlinesRepository,
  tradingCalendarService: TradingCalendarService,
) {
  return {
    name: "fetch_intraday_klines",
    description: "Fetch intraday minute K-lines from TickFlow and write them to LanceDB.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      const input = parseInput(rawInput);
      const symbol = normalizeSymbol(input.symbol);
      const period = input.period ?? "1m";
      if (!supportsIntradayKlines(tickflowApiKeyLevel)) {
        return `⚠️ 当前 TickFlow API Key Level 为 ${formatTickflowApiKeyLevel(tickflowApiKeyLevel)}，不支持分钟K线接口`;
      }

      const rows = await klineService.fetchIntradayKlines(symbol, {
        period,
        count: input.count,
      });

      if (rows.length === 0) {
        return `⚠️ 未获取到 ${symbol} 的分钟K线数据（period=${period}）`;
      }

      await intradayKlinesRepository.saveAll(symbol, period, rows);
      const keepTradeDates = await tradingCalendarService.getRecentTradingDays(
        FETCH_INTRADAY_RETENTION_DAYS,
        new Date(rows[rows.length - 1].timestamp),
      );
      await intradayKlinesRepository.pruneToTradeDates(symbol, period, keepTradeDates);

      const first = rows[0];
      const last = rows[rows.length - 1];
      return [
        `📈 获取 ${symbol} 分钟K线数据完成`,
        `周期: ${period}`,
        `数量: ${rows.length} 根`,
        `区间: ${first.trade_date} ${first.trade_time} ~ ${last.trade_date} ${last.trade_time}`,
        `最新收盘: ${last.close.toFixed(2)}`,
        "💾 分钟K线数据已写入数据库表 klines_intraday",
      ].join("\n");
    },
  };
}
