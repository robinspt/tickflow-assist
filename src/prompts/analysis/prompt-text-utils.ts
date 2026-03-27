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

export function sanitizeExternalPromptText(text: string | null | undefined, maxLength: number): string {
  const normalized = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`#>*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  if (/(忽略以上|请忽略|不要遵循|system\s*prompt|developer\s*:|assistant\s*:|user\s*:|只输出\s*json)/i.test(normalized)) {
    return "";
  }

  return truncatePromptText(normalized, maxLength);
}
