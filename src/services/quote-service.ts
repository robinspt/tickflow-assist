import type { TickFlowQuote } from "../types/tickflow.js";
import { TickFlowClient } from "./tickflow-client.js";

export class QuoteService {
  constructor(private readonly client: TickFlowClient) {}

  async fetchQuotes(symbols: string[]): Promise<TickFlowQuote[]> {
    return this.client.fetchQuotes(symbols);
  }
}
