import { parseJsonBlock } from "./json-block.parser.js";

export interface WatchlistProfileExtraction {
  sector: string | null;
  themes: string[];
  confidence: "low" | "medium" | "high";
}

interface WatchlistProfileJson {
  sector?: unknown;
  themes?: unknown;
  confidence?: unknown;
}

const MAX_THEMES = 10;
const GENERIC_THEME_LABELS = new Set([
  "公司新闻",
  "最新公告",
  "最新新闻",
  "市场快讯",
  "公司公告",
  "行业动态",
  "板块动态",
  "题材动态",
  "概念动态",
  "资金流向",
  "龙虎榜",
]);

export function parseWatchlistProfileExtraction(responseText: string): WatchlistProfileExtraction | null {
  const parsed = parseJsonBlock<WatchlistProfileJson>(responseText);
  if (!parsed) {
    return null;
  }

  return {
    sector: normalizeSector(parsed.sector),
    themes: normalizeThemes(parsed.themes),
    confidence: normalizeConfidence(parsed.confidence),
  };
}

function normalizeSector(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = cleanLabel(value);
  if (!text || isNullLike(text)) {
    return null;
  }
  return text;
}

function normalizeThemes(value: unknown): string[] {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];

  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawItem of rawItems) {
    const parts = splitThemeItem(String(rawItem ?? ""));
    for (const part of parts) {
      const cleaned = cleanLabel(part);
      if (!cleaned || isNullLike(cleaned) || isGenericTheme(cleaned) || seen.has(cleaned)) {
        continue;
      }
      seen.add(cleaned);
      result.push(cleaned);
      if (result.length >= MAX_THEMES) {
        return result;
      }
    }
  }

  return result;
}

function splitThemeItem(value: string): string[] {
  return value
    .split(/[、,，;；|]/)
    .flatMap((item) => item.split(/\s*\/\s*/))
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanLabel(value: string): string {
  return value
    .trim()
    .replace(/[《》"'“”]/g, "")
    .replace(/^[：:、，,；;\-]+/, "")
    .replace(/[：:、，,；;。]+$/g, "")
    .replace(/等+$/g, "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function isNullLike(value: string): boolean {
  return ["无", "暂无", "未知", "未识别", "未提及", "null", "none", "n/a"].includes(value.toLowerCase());
}

function isGenericTheme(value: string): boolean {
  if (GENERIC_THEME_LABELS.has(value)) {
    return true;
  }
  return /(新闻|公告|快讯|资讯|消息|复盘)$/.test(value);
}

function normalizeConfidence(value: unknown): WatchlistProfileExtraction["confidence"] {
  if (value === "high" || value === "medium") {
    return value;
  }
  return "low";
}
