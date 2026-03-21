import type { WatchlistItem } from "../../types/domain.js";
import { MxApiService } from "../../services/mx-search-service.js";
import { buildBoardNewsQuery } from "../../services/watchlist-profile-service.js";
import type { MxSearchDocument } from "../../types/mx-search.js";
import type { NewsAnalysisContext } from "../types/composite-analysis.js";

const MAX_NEWS_DOCUMENTS = 8;
const MAX_BOARD_DOCUMENTS = 6;

export class NewsAnalysisProvider {
  constructor(private readonly mxApiService: MxApiService) {}

  async load(
    symbol: string,
    companyName: string,
    watchlistItem: WatchlistItem | null = null,
  ): Promise<NewsAnalysisContext> {
    const query = buildNewsQuery(symbol, companyName);
    const boardQuery = watchlistItem
      ? buildBoardNewsQuery({
        sector: watchlistItem.sector,
        themes: watchlistItem.themes,
      })
      : null;

    if (!this.mxApiService.isConfigured()) {
      return {
        symbol,
        companyName,
        query,
        documents: [],
        available: false,
        boardQuery,
        boardDocuments: [],
        boardAvailable: false,
      };
    }

    const [documents, boardDocuments] = await Promise.all([
      this.searchDocuments(query, MAX_NEWS_DOCUMENTS, symbol, "company"),
      boardQuery ? this.searchDocuments(boardQuery, MAX_BOARD_DOCUMENTS, symbol, "board") : Promise.resolve([]),
    ]);

    return {
      symbol,
      companyName,
      query,
      documents,
      available: documents.length > 0,
      boardQuery,
      boardDocuments,
      boardAvailable: boardDocuments.length > 0,
    };
  }

  private async searchDocuments(
    query: string,
    limit: number,
    symbol: string,
    scope: "company" | "board",
  ): Promise<MxSearchDocument[]> {
    try {
      return (await this.mxApiService.search(query)).slice(0, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[analyze] ${scope} news fetch skipped for ${symbol}: ${message}`);
      return [];
    }
  }
}

function buildNewsQuery(symbol: string, companyName: string): string {
  if (companyName && companyName !== symbol) {
    return `${companyName} ${symbol} 最新新闻 公告 研报`;
  }
  return `${symbol} 最新新闻 公告 研报`;
}
