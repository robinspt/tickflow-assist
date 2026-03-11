import type { TickFlowCompactKline, TickFlowKlineRow } from "../types/tickflow.js";
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

    return this.toRows(symbol, data);
  }

  private toRows(symbol: string, data: TickFlowCompactKline): TickFlowKlineRow[] {
    const requiredFields = ["timestamp", "open", "high", "low", "close", "volume", "amount"] as const;
    for (const field of requiredFields) {
      if (!Array.isArray(data[field])) {
        throw new Error(`TickFlow K-line data missing required field: ${field}`);
      }
    }

    return data.timestamp.map((timestamp, index) => ({
      symbol,
      trade_date: toChinaTradeDate(timestamp),
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
}

function toChinaTradeDate(timestampMs: number): string {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(timestampMs));
}
