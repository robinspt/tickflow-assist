import { parseWatchlistProfileExtraction } from "../analysis/parsers/watchlist-profile.parser.js";
import {
  buildWatchlistProfileExtractionUserPrompt,
  WATCHLIST_PROFILE_EXTRACTION_SYSTEM_PROMPT,
} from "../prompts/analysis/index.js";
import { AnalysisService } from "./analysis-service.js";
import type { MxSearchDocument } from "../types/mx-search.js";
import { MxApiService } from "./mx-search-service.js";

const MAX_PROFILE_DOCUMENTS = 8;

export interface WatchlistProfile {
  sector: string | null;
  themes: string[];
  themeQuery: string | null;
  themeUpdatedAt: string | null;
}

export class WatchlistProfileService {
  constructor(
    private readonly mxApiService: MxApiService,
    private readonly analysisService: AnalysisService,
  ) {}

  async resolve(symbol: string, companyName: string, updatedAt: string): Promise<WatchlistProfile> {
    const themeQuery = buildThemeQuery(companyName, symbol);
    const mxConfigError = this.mxApiService.getConfigurationError();
    if (mxConfigError) {
      throw new Error(mxConfigError);
    }

    const llmConfigError = this.analysisService.getConfigurationError();
    if (llmConfigError) {
      throw new Error(llmConfigError);
    }

    const documents = (await this.mxApiService.search(themeQuery)).slice(0, MAX_PROFILE_DOCUMENTS);
    if (documents.length === 0) {
      return {
        sector: null,
        themes: [],
        themeQuery,
        themeUpdatedAt: updatedAt,
      };
    }

    const responseText = await this.analysisService.generateText(
      WATCHLIST_PROFILE_EXTRACTION_SYSTEM_PROMPT,
      buildWatchlistProfileExtractionUserPrompt({
        symbol,
        companyName,
        documents,
      }),
      {
        maxTokens: 1200,
        temperature: 0.1,
      },
    );

    const profile = parseWatchlistProfileExtraction(responseText);
    if (!profile) {
      throw new Error(`watchlist profile extraction returned invalid JSON for ${symbol}`);
    }

    return {
      sector: profile.sector,
      themes: profile.themes,
      themeQuery,
      themeUpdatedAt: updatedAt,
    };
  }
}

export function buildBoardNewsQuery(profile: {
  sector: string | null;
  themes: string[];
}): string | null {
  const keywords = [
    String(profile.sector ?? "").trim(),
    ...profile.themes
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .slice(0, 3),
  ].filter(Boolean);

  if (keywords.length === 0) {
    return null;
  }

  return `${keywords.join(" ")} 板块 题材 最新新闻 政策 资金`;
}

function buildThemeQuery(companyName: string, symbol: string): string {
  return `${companyName} ${symbol} 所属行业 板块 题材 概念`;
}

export function formatWatchlistProfileDocuments(documents: MxSearchDocument[]): string {
  return documents
    .slice(0, MAX_PROFILE_DOCUMENTS)
    .map((document, index) => [
      `${index + 1}. ${document.title}`,
      `来源: ${document.source ?? "未知"}`,
      `时间: ${document.publishedAt ?? "未知"}`,
      `正文: ${document.trunk || "无"}`,
    ].join("\n"))
    .join("\n\n");
}
