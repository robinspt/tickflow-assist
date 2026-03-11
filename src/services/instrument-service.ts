import { TickFlowClient } from "./tickflow-client.js";

export class InstrumentService {
  constructor(private readonly client: TickFlowClient) {}

  async resolveName(symbol: string): Promise<string> {
    const instruments = await this.client.fetchInstruments([symbol]);
    const matched = instruments.find((item) => item.symbol === symbol);
    return matched?.name?.trim() || symbol;
  }
}
