import type { MxSearchDocument } from "../types/mx-search.js";
import { MxApiService } from "./mx-search-service.js";

const MAX_PROFILE_DOCUMENTS = 8;
const MAX_THEMES = 20;
const MAX_CONCEPT_QUERY_KEYWORDS = 3;
const EXPLICIT_HIT_SCORE = 3;
const LOOSE_HIT_SCORE = 1;
const EXPLICIT_THEME_HEADERS = [
  "概念板块",
  "所属概念",
  "相关概念",
  "概念题材",
  "核心题材",
  "题材概念",
  "涉及概念",
  "覆盖题材",
] as const;
const ALWAYS_BLOCK_THEME_HEADERS = new Set<string>(["概念板块", "相关概念"]);
const EXPLICIT_THEME_HEADER_PATTERN = new RegExp(
  `^(${EXPLICIT_THEME_HEADERS.join("|")})(?:[:：]|为|是)?\\s*(.*)$`,
);
const GENERIC_LABELS = new Set([
  "最新新闻",
  "公司新闻",
  "公司公告",
  "最新公告",
  "相关概念",
  "所属概念",
  "核心题材",
  "热门题材",
  "行业动态",
  "板块动态",
  "题材动态",
  "概念动态",
  "资金流向",
  "龙虎榜",
  "收盘复盘",
]);

export interface WatchlistProfile {
  sector: string | null;
  themes: string[];
  themeQuery: string | null;
  themeUpdatedAt: string | null;
}

export interface ExtractedWatchlistProfile {
  sector: string | null;
  themes: string[];
  confidence: "low" | "medium" | "high";
  evidenceCount: number;
  sectorScore: number;
  themeScores: Array<{ label: string; score: number }>;
}

interface LabelEvidence {
  score: number;
  explicitHits: number;
  looseHits: number;
  documents: Set<number>;
}

interface RankedLabel {
  label: string;
  score: number;
  explicitHits: number;
  looseHits: number;
  documentCount: number;
}

interface ParsedThemeHeader {
  header: string;
  content: string;
}

export class WatchlistProfileService {
  constructor(private readonly mxApiService: MxApiService) {}

  async resolve(symbol: string, companyName: string, updatedAt: string): Promise<WatchlistProfile> {
    const themeQuery = buildThemeQuery(companyName, symbol);
    if (!this.mxApiService.isConfigured()) {
      return {
        sector: null,
        themes: [],
        themeQuery,
        themeUpdatedAt: null,
      };
    }

    try {
      const documents = (await this.mxApiService.search(themeQuery)).slice(0, MAX_PROFILE_DOCUMENTS);
      const profile = extractWatchlistProfile(documents, companyName, symbol);
      return {
        sector: profile.sector,
        themes: profile.themes,
        themeQuery,
        themeUpdatedAt: updatedAt,
      };
    } catch {
      return {
        sector: null,
        themes: [],
        themeQuery,
        themeUpdatedAt: null,
      };
    }
  }
}

export function extractWatchlistProfile(
  documents: MxSearchDocument[],
  companyName: string,
  symbol: string,
): ExtractedWatchlistProfile {
  const sectorCounts = new Map<string, LabelEvidence>();
  const themeCounts = new Map<string, LabelEvidence>();
  const sourceDocuments = filterRelevantDocuments(documents, companyName, symbol);

  sourceDocuments.forEach((document, index) => {
    const text = [document.title, document.trunk].filter(Boolean).join("\n");
    collectExplicitLabels(text, sectorCounts, themeCounts, companyName, symbol, index);
    collectLooseLabels(text, sectorCounts, themeCounts, companyName, symbol, index);
  });

  const rankedSectors = rankLabels(sectorCounts);
  const rankedThemes = rankLabels(themeCounts);
  const sector = rankedSectors.find(isAcceptedLabel)?.label ?? null;
  const acceptedThemes = rankedThemes
    .filter((item) => item.label !== sector)
    .filter(isAcceptedLabel)
    .slice(0, MAX_THEMES);

  const acceptedLabels = [
    ...acceptedThemes,
    ...(sector ? rankedSectors.filter((item) => item.label === sector).slice(0, 1) : []),
  ];
  const evidenceCount = countEvidenceDocuments(acceptedLabels);
  const totalScore = acceptedLabels.reduce((sum, item) => sum + item.score, 0);
  const confidence = deriveConfidence(sector, acceptedThemes, evidenceCount, totalScore);

  return {
    sector,
    themes: acceptedThemes.map((item) => item.label),
    confidence,
    evidenceCount,
    sectorScore: rankedSectors.find((item) => item.label === sector)?.score ?? 0,
    themeScores: acceptedThemes.map((item) => ({ label: item.label, score: item.score })),
  };
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
      .slice(0, MAX_CONCEPT_QUERY_KEYWORDS),
  ].filter(Boolean);

  if (keywords.length === 0) {
    return null;
  }

  return `${keywords.join(" ")} 板块 题材 最新新闻 政策 资金`;
}

function buildThemeQuery(companyName: string, symbol: string): string {
  return `${companyName} ${symbol} 所属行业 板块 题材 概念`;
}

function filterRelevantDocuments(
  documents: MxSearchDocument[],
  companyName: string,
  symbol: string,
): MxSearchDocument[] {
  const relevant = documents.filter((document) => isRelevantDocument(document, companyName, symbol));
  return relevant.length > 0 ? relevant : documents;
}

function isRelevantDocument(
  document: MxSearchDocument,
  companyName: string,
  symbol: string,
): boolean {
  const normalizedSymbol = normalizeSymbolToken(symbol);
  const normalizedCompanyName = normalizeTextToken(companyName);
  const text = normalizeTextToken(`${document.title} ${document.trunk}`);

  if (normalizedCompanyName && text.includes(normalizedCompanyName)) {
    return true;
  }
  if (normalizedSymbol && text.includes(normalizedSymbol)) {
    return true;
  }

  return document.secuList.some((security) => {
    const code = normalizeSymbolToken(security.secuCode ?? "");
    const name = normalizeTextToken(security.secuName ?? "");
    return Boolean(
      (normalizedSymbol && code && (code === normalizedSymbol || normalizedSymbol.endsWith(code) || code.endsWith(normalizedSymbol)))
      || (normalizedCompanyName && name && (name.includes(normalizedCompanyName) || normalizedCompanyName.includes(name)))
    );
  });
}

function collectExplicitLabels(
  text: string,
  sectorCounts: Map<string, LabelEvidence>,
  themeCounts: Map<string, LabelEvidence>,
  companyName: string,
  symbol: string,
  documentIndex: number,
): void {
  const sectorPatterns = [
    /(?:所属行业|申万行业|行业分类|行业归属|所属板块)(?:[:：]|为|是)\s*([^\n。；;，,]{2,32})/g,
  ];
  const themePatterns = [
    /(?:所属概念|概念题材|核心题材|题材概念|涉及概念|覆盖题材)(?:[:：]|为|是)\s*([^\n。；;]{2,64})/g,
  ];

  for (const pattern of sectorPatterns) {
    for (const match of text.matchAll(pattern)) {
      for (const item of splitCandidates(match[1])) {
        addLabel(sectorCounts, item, companyName, symbol, documentIndex, true);
      }
    }
  }

  for (const pattern of themePatterns) {
    for (const match of text.matchAll(pattern)) {
      for (const item of splitCandidates(match[1])) {
        addLabel(themeCounts, item, companyName, symbol, documentIndex, true);
      }
    }
  }

  collectExplicitThemeBlocks(text, themeCounts, companyName, symbol, documentIndex);
}

function collectLooseLabels(
  text: string,
  sectorCounts: Map<string, LabelEvidence>,
  themeCounts: Map<string, LabelEvidence>,
  companyName: string,
  symbol: string,
  documentIndex: number,
): void {
  const matches = text.match(/[A-Za-z0-9\u4e00-\u9fa5]{2,16}(?:概念|题材|板块|行业)/g) ?? [];
  for (const match of matches) {
    if (match.endsWith("行业")) {
      addLabel(sectorCounts, match, companyName, symbol, documentIndex, false);
      continue;
    }
    addLabel(themeCounts, match, companyName, symbol, documentIndex, false);
  }
}

function splitCandidates(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line) => stripListMarker(line).split(/[、,，;；|/]/))
    .map((item) => item.trim())
    .filter(Boolean);
}

function addLabel(
  counts: Map<string, LabelEvidence>,
  rawLabel: string,
  companyName: string,
  symbol: string,
  documentIndex: number,
  explicit: boolean,
): void {
  const label = normalizeLabel(rawLabel, companyName, symbol, explicit);
  if (!label) {
    return;
  }

  const current = counts.get(label) ?? {
    score: 0,
    explicitHits: 0,
    looseHits: 0,
    documents: new Set<number>(),
  };
  current.score += explicit ? EXPLICIT_HIT_SCORE : LOOSE_HIT_SCORE;
  current.documents.add(documentIndex);
  if (explicit) {
    current.explicitHits += 1;
  } else {
    current.looseHits += 1;
  }
  counts.set(label, current);
}

function collectExplicitThemeBlocks(
  text: string,
  themeCounts: Map<string, LabelEvidence>,
  companyName: string,
  symbol: string,
  documentIndex: number,
): void {
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseExplicitThemeHeader(lines[index] ?? "");
    if (!parsed) {
      continue;
    }

    const hasContinuation = hasLikelyThemeContinuation(lines, index + 1);
    if (!ALWAYS_BLOCK_THEME_HEADERS.has(parsed.header) && parsed.content && !hasContinuation) {
      continue;
    }

    for (const item of splitCandidates(parsed.content)) {
      addLabel(themeCounts, item, companyName, symbol, documentIndex, true);
    }

    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const rawLine = lines[nextIndex] ?? "";
      const cleaned = stripListMarker(rawLine).trim();
      if (!cleaned || isThemeBlockBoundary(cleaned) || !isLikelyThemeContinuation(rawLine, cleaned)) {
        break;
      }

      for (const item of splitCandidates(cleaned)) {
        addLabel(themeCounts, item, companyName, symbol, documentIndex, true);
      }
      nextIndex += 1;
    }

    index = nextIndex - 1;
  }
}

function parseExplicitThemeHeader(line: string): ParsedThemeHeader | null {
  const cleaned = stripListMarker(line).trim();
  const match = cleaned.match(EXPLICIT_THEME_HEADER_PATTERN);
  if (!match) {
    return null;
  }

  return {
    header: match[1] ?? "",
    content: match[2] ?? "",
  };
}

function hasLikelyThemeContinuation(lines: string[], startIndex: number): boolean {
  for (let index = startIndex; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const cleaned = stripListMarker(rawLine).trim();
    if (!cleaned) {
      continue;
    }
    if (isThemeBlockBoundary(cleaned)) {
      return false;
    }
    return isLikelyThemeContinuation(rawLine, cleaned);
  }

  return false;
}

function isLikelyThemeContinuation(rawLine: string, cleanedLine: string): boolean {
  if (!cleanedLine || cleanedLine.length > 32) {
    return false;
  }
  if (/[。！？!?]/.test(cleanedLine)) {
    return false;
  }

  const hasListMarker = /^[\s>*•·●▪◦\-–—]+/.test(rawLine) || /^\s*\d+[.)、]\s*/.test(rawLine);
  if (hasListMarker) {
    return true;
  }

  if (/[、,，;；|/]/.test(cleanedLine)) {
    return true;
  }

  return /^[A-Za-z0-9\u4e00-\u9fa5()（）+&\-\s]{2,32}$/.test(cleanedLine);
}

function isThemeBlockBoundary(line: string): boolean {
  return /^(?:所属行业|申万行业|行业分类|行业归属|所属板块|主营业务|主营产品|主要产品|公司简介|经营范围|证券代码|证券简称|相关新闻|新闻摘要|风险提示|财务指标|行业地位)(?:[:：]|为|是)/.test(
    line,
  );
}

function stripListMarker(text: string): string {
  return text
    .replace(/^[\s>*•·●▪◦\-–—]+/, "")
    .replace(/^\d+[.)、]\s*/, "")
    .trim();
}

function normalizeLabel(rawLabel: string, companyName: string, symbol: string, explicit: boolean): string | null {
  const text = rawLabel
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[《》"'“”]/g, "")
    .replace(/^[：:、，,；;\-]+/, "")
    .replace(/[：:、，,；;。]+$/g, "")
    .replace(/\s+/g, "")
    .trim();

  if (!text || text.length < 2 || text.length > 16) {
    return null;
  }
  if (text.includes(companyName) || text.includes(symbol)) {
    return null;
  }
  if (GENERIC_LABELS.has(text)) {
    return null;
  }
  if (/^(所属概念|所属板块|所属行业|概念板块)/.test(text)) {
    return null;
  }
  if (/^(或|及|和|与)/.test(text)) {
    return null;
  }
  if (
    explicit
      ? /^(最新新闻|公司新闻|公司公告|最新公告|行业动态|板块动态|题材动态|概念动态|资金流向|龙虎榜|收盘复盘|市场快讯|消息面)$/.test(text)
      : /(最新|今日|公司|个股|资讯|公告|新闻|数据|市场|资金|复盘|消息)/.test(text)
  ) {
    return null;
  }

  return text;
}

function rankLabels(counts: Map<string, LabelEvidence>): RankedLabel[] {
  return [...counts.entries()]
    .map(([label, value]) => ({
      label,
      score: value.score,
      explicitHits: value.explicitHits,
      looseHits: value.looseHits,
      documentCount: value.documents.size,
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.explicitHits !== left.explicitHits) {
        return right.explicitHits - left.explicitHits;
      }
      if (right.documentCount !== left.documentCount) {
        return right.documentCount - left.documentCount;
      }
      return 0;
    });
}

function isAcceptedLabel(item: RankedLabel): boolean {
  return item.explicitHits > 0 || item.documentCount >= 2 || item.score >= 3;
}

function countEvidenceDocuments(labels: RankedLabel[]): number {
  return labels.reduce((sum, item) => sum + item.documentCount, 0);
}

function normalizeSymbolToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.(sz|sh|hk|us)$/i, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeTextToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");
}

function deriveConfidence(
  sector: string | null,
  themes: RankedLabel[],
  evidenceCount: number,
  totalScore: number,
): ExtractedWatchlistProfile["confidence"] {
  if (!sector && themes.length === 0) {
    return "low";
  }
  if ((sector && themes.length >= 1 && evidenceCount >= 3) || totalScore >= 8 || themes.length >= 2) {
    return "high";
  }
  if (totalScore >= 3 || evidenceCount >= 1) {
    return "medium";
  }
  return "low";
}
