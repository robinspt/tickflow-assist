import { MxApiService } from "../../services/mx-search-service.js";
import type { NewsAnalysisContext } from "../types/composite-analysis.js";

const MAX_NEWS_DOCUMENTS = 8;

export class NewsAnalysisProvider {
  constructor(private readonly mxApiService: MxApiService) {}

  async load(symbol: string, companyName: string): Promise<NewsAnalysisContext> {
    const query = buildNewsQuery(symbol, companyName);
    if (!this.mxApiService.isConfigured()) {
      return {
        symbol,
        companyName,
        query,
        documents: [],
        available: false,
      };
    }

    try {
      const documents = (await this.mxApiService.search(query)).slice(0, MAX_NEWS_DOCUMENTS);
      return {
        symbol,
        companyName,
        query,
        documents,
        available: documents.length > 0,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[analyze] news fetch skipped for ${symbol}: ${message}`);
      return {
        symbol,
        companyName,
        query,
        documents: [],
        available: false,
      };
    }
  }
}

function buildNewsQuery(symbol: string, companyName: string): string {
  if (companyName && companyName !== symbol) {
    return `${companyName} ${symbol} 最新新闻 公告 研报`;
  }
  return `${symbol} 最新新闻 公告 研报`;
}
