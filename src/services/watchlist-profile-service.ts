import { parseWatchlistProfileExtraction } from "../analysis/parsers/watchlist-profile.parser.js";
import {
  buildWatchlistProfileExtractionUserPrompt,
  WATCHLIST_PROFILE_EXTRACTION_SYSTEM_PROMPT,
} from "../prompts/analysis/index.js";
import { AnalysisService } from "./analysis-service.js";
import type { MxSearchDocument } from "../types/mx-search.js";
import { MxApiService } from "./mx-search-service.js";
import { TickFlowUniverseService } from "./tickflow-universe-service.js";

const MAX_PROFILE_DOCUMENTS = 8;

export interface WatchlistProfile {
  sector: string | null;
  themes: string[];
  themeQuery: string | null;
  themeUpdatedAt: string | null;
}

export class WatchlistProfileService {
  constructor(
    private readonly tickFlowUniverseService: TickFlowUniverseService | null,
    private readonly mxApiService: MxApiService,
    private readonly analysisService: AnalysisService,
  ) {}

  async resolve(symbol: string, companyName: string, updatedAt: string): Promise<WatchlistProfile> {
    const themeQuery = buildThemeQuery(companyName, symbol);
    const industryProfile = this.tickFlowUniverseService
      ? await this.tickFlowUniverseService.resolveIndustryProfile(symbol)
        .catch((error) => {
          console.warn(`[watchlist-profile] tickflow universe lookup skipped for ${symbol}: ${toErrorMessage(error)}`);
          return null;
        })
      : null;

    const mxConfigError = this.mxApiService.getConfigurationError();
    const llmConfigError = this.analysisService.getConfigurationError();
    const canUseMx = !mxConfigError && !llmConfigError;

    let parsedProfile: ReturnType<typeof parseWatchlistProfileExtraction> = null;
    if (canUseMx) {
      try {
        const documents = (await this.mxApiService.search(themeQuery)).slice(0, MAX_PROFILE_DOCUMENTS);
        if (documents.length > 0) {
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

          parsedProfile = parseWatchlistProfileExtraction(responseText);
          if (!parsedProfile) {
            throw new Error(`watchlist profile extraction returned invalid JSON for ${symbol}`);
          }
        }
      } catch (error) {
        if (!industryProfile) {
          throw error;
        }
        console.warn(`[watchlist-profile] mx profile enrichment skipped for ${symbol}: ${toErrorMessage(error)}`);
      }
    } else if (!industryProfile) {
      throw new Error(mxConfigError ?? llmConfigError ?? "watchlist profile service unavailable");
    }

    return {
      sector: industryProfile?.sectorPath ?? parsedProfile?.sector ?? null,
      themes: parsedProfile?.themes ?? [],
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
    ...extractSectorKeywords(profile.sector),
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

export function extractSectorKeywords(sector: string | null | undefined): string[] {
  const raw = String(sector ?? "").trim();
  if (!raw) {
    return [];
  }

  const keywords = raw
    .split(/[-/|>|→｜]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return uniqueStrings(keywords.length > 0 ? keywords : [raw]);
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
