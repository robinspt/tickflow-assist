export function extractNarrativeWithoutJson(text: string): string {
  const stripped = text.replace(/```json\s*[\s\S]*?\s*```/gi, "").trim();
  return stripped || text.trim();
}

export function truncatePromptText(text: string, maxLength: number): string {
  const normalized = text.trim();
  if (!normalized) {
    return "";
  }
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

export function buildReferencedNarrative(text: string, maxLength: number): string {
  return truncatePromptText(extractNarrativeWithoutJson(text), maxLength);
}

const EXTERNAL_INSTRUCTION_MARKER_REGEX = new RegExp([
  literalMarker(["忽略", "以上"]),
  literalMarker(["请", "忽略"]),
  literalMarker(["不要", "遵循"]),
  rawMarker(["sys", "tem\\s*pro", "mpt"]),
  rawMarker(["devel", "oper\\s*:"]),
  rawMarker(["assist", "ant\\s*:"]),
  rawMarker(["us", "er\\s*:"]),
  rawMarker(["只输出", "\\s*js", "on"]),
].join("|"), "i");

export function sanitizeExternalPromptText(text: string | null | undefined, maxLength: number): string {
  const normalized = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`#>*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  if (EXTERNAL_INSTRUCTION_MARKER_REGEX.test(normalized)) {
    return "";
  }

  return truncatePromptText(normalized, maxLength);
}

function literalMarker(parts: string[]): string {
  return parts.map(escapeRegex).join("");
}

function rawMarker(parts: string[]): string {
  return parts.join("");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
