import type { TickFlowInstrument } from "../types/tickflow.js";
import { TickFlowClient } from "./tickflow-client.js";

export class InstrumentService {
  constructor(private readonly client: TickFlowClient) {}

  async resolveName(symbol: string): Promise<string> {
    const instruments = await this.client.fetchInstruments([symbol]);
    const matched = findBestInstrumentMatch(instruments, symbol);
    const resolvedName = matched?.name?.trim();
    return resolvedName || symbol;
  }
}

function findBestInstrumentMatch(instruments: TickFlowInstrument[], symbol: string) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const [targetCode, targetExchange = ""] = normalizedSymbol.split(".");

  return (
    instruments.find((item) => item.symbol?.trim().toUpperCase() === normalizedSymbol) ??
    instruments.find(
      (item) =>
        item.code?.trim().toUpperCase() === targetCode &&
        item.exchange?.trim().toUpperCase() === targetExchange,
    ) ??
    instruments.find((item) => item.code?.trim().toUpperCase() === targetCode) ??
    instruments[0]
  );
}
