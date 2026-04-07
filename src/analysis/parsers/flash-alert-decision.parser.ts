import { parseJsonBlock } from "./json-block.parser.js";

interface FlashAlertDecisionJson {
  alert?: unknown;
  importance?: unknown;
  relevant_symbols?: unknown;
  headline?: unknown;
  reason?: unknown;
}

export interface FlashAlertDecision {
  alert: boolean;
  importance: "high" | "medium" | "low";
  relevantSymbols: string[];
  headline: string;
  reason: string;
}

export function parseFlashAlertDecision(responseText: string): FlashAlertDecision {
  const parsed = parseJsonBlock<FlashAlertDecisionJson>(responseText, {
    requiredKeys: ["alert", "relevant_symbols"],
  });

  return {
    alert: normalizeBoolean(parsed?.alert),
    importance: normalizeImportance(parsed?.importance),
    relevantSymbols: normalizeSymbols(parsed?.relevant_symbols),
    headline: normalizeText(parsed?.headline),
    reason: normalizeText(parsed?.reason),
  };
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeImportance(value: unknown): FlashAlertDecision["importance"] {
  if (value === "high" || value === "low") {
    return value;
  }
  return "medium";
}

function normalizeSymbols(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
