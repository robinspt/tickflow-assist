import type {
  TickFlowCompactKline,
  TickFlowIntradayKlineRow,
  TickFlowKlineRow,
} from "../types/tickflow.js";
import { TickFlowClient } from "./tickflow-client.js";

export class KlineService {
  constructor(private readonly client: TickFlowClient) {}

  async fetchKlines(
    symbol: string,
    options: {
      period?: string;
      count?: number;
      adjust?: string;
      startTime?: number;
      endTime?: number;
    } = {},
  ): Promise<TickFlowKlineRow[]> {
    const response = await this.client.fetchKlinesBatch<TickFlowCompactKline>([symbol], options);
    const data = response.data?.[symbol];
    if (!data) {
      return [];
    }

    return this.toDailyRows(symbol, data);
  }

  async fetchIntradayKlines(
    symbol: string,
    options: {
      period?: string;
      count?: number;
    } = {},
  ): Promise<TickFlowIntradayKlineRow[]> {
    const period = options.period ?? "1m";
    const response = await this.client.fetchIntradayKlinesBatch<TickFlowCompactKline>([symbol], {
      period,
      count: options.count,
    });
    const data = response.data?.[symbol];
    if (!data) {
      return [];
    }

    return this.toIntradayRows(symbol, period, data);
  }

  private toDailyRows(symbol: string, data: TickFlowCompactKline): TickFlowKlineRow[] {
    const requiredFields = ["timestamp", "open", "high", "low", "close", "volume", "amount"] as const;
    for (const field of requiredFields) {
      if (!Array.isArray(data[field])) {
        throw new Error(`TickFlow K-line data missing required field: ${field}`);
      }
    }

    return data.timestamp.map((timestamp, index) => ({
      symbol,
      trade_date: toChinaDateTimeParts(timestamp).tradeDate,
      timestamp,
      open: Number(data.open[index] ?? 0),
      high: Number(data.high[index] ?? 0),
      low: Number(data.low[index] ?? 0),
      close: Number(data.close[index] ?? 0),
      volume: Number(data.volume[index] ?? 0),
      amount: Number(data.amount[index] ?? 0),
      prev_close: Number(data.prev_close?.[index] ?? 0),
    }));
  }

  private toIntradayRows(
    symbol: string,
    period: string,
    data: TickFlowCompactKline,
  ): TickFlowIntradayKlineRow[] {
    const requiredFields = ["timestamp", "open", "high", "low", "close", "volume", "amount"] as const;
    for (const field of requiredFields) {
      if (!Array.isArray(data[field])) {
        throw new Error(`TickFlow K-line data missing required field: ${field}`);
      }
    }

    return data.timestamp.map((timestamp, index) => {
      const chinaTime = toChinaDateTimeParts(timestamp);
      return {
        symbol,
        period,
        trade_date: chinaTime.tradeDate,
        trade_time: chinaTime.tradeTime,
        timestamp,
        open: Number(data.open[index] ?? 0),
        high: Number(data.high[index] ?? 0),
        low: Number(data.low[index] ?? 0),
        close: Number(data.close[index] ?? 0),
        volume: Number(data.volume[index] ?? 0),
        amount: Number(data.amount[index] ?? 0),
        prev_close: Number(data.prev_close?.[index] ?? 0),
        open_interest: toOptionalNumber(data.open_interest?.[index]),
        settlement_price: toOptionalNumber(data.settlement_price?.[index]),
      };
    });
  }
}

function toChinaDateTimeParts(timestampMs: number): { tradeDate: string; tradeTime: string } {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const formatted = formatter.format(new Date(timestampMs));
  const [tradeDate = "", tradeTime = ""] = formatted.split(" ");
  return { tradeDate, tradeTime };
}

function toOptionalNumber(value: number | undefined): number | null {
  return value == null ? null : Number(value);
}
