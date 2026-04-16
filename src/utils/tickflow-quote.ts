import type { TickFlowKlineRow, TickFlowQuote } from "../types/tickflow.js";

export function normalizeTickFlowChangePct(value: number | null | undefined): number | null {
  if (value == null) {
    return null;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return numericValue * 100;
}

export function deriveChangePctFromPrices(
  close: number | null | undefined,
  prevClose: number | null | undefined,
): number | null {
  const closeValue = Number(close);
  const prevCloseValue = Number(prevClose);
  if (!Number.isFinite(closeValue) || !Number.isFinite(prevCloseValue) || prevCloseValue <= 0) {
    return null;
  }

  return ((closeValue - prevCloseValue) / prevCloseValue) * 100;
}

export function resolveTickFlowQuoteChangePct(quote: TickFlowQuote | null | undefined): number | null {
  if (!quote) {
    return null;
  }

  return normalizeTickFlowChangePct(quote.ext?.change_pct)
    ?? deriveChangePctFromPrices(quote.last_price, quote.prev_close);
}

export function resolveTickFlowKlineChangePct(
  kline: Pick<TickFlowKlineRow, "close" | "prev_close"> | null | undefined,
): number | null {
  if (!kline) {
    return null;
  }

  return deriveChangePctFromPrices(kline.close, kline.prev_close);
}
