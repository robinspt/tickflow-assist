export interface ParseJsonBlockOptions {
  requiredKeys?: string[];
}

export function parseJsonBlock<T>(responseText: string, options: ParseJsonBlockOptions = {}): T | null {
  const sources = [extractFencedCandidate(responseText), responseText].filter((value): value is string => Boolean(value));
  const seen = new Set<string>();

  for (const source of sources) {
    const directCandidate = cleanJsonCandidate(source);
    if (directCandidate && !seen.has(directCandidate)) {
      seen.add(directCandidate);
      const parsed = tryParseJson<T>(directCandidate, options.requiredKeys);
      if (parsed != null) {
        return parsed;
      }
    }

    const extractedCandidate = extractBalancedJsonCandidate(source, options.requiredKeys);
    if (extractedCandidate && !seen.has(extractedCandidate)) {
      seen.add(extractedCandidate);
      const parsed = tryParseJson<T>(extractedCandidate, options.requiredKeys);
      if (parsed != null) {
        return parsed;
      }
    }
  }

  return null;
}

function extractFencedCandidate(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced?.[1]?.trim() || null;
}

function tryParseJson<T>(candidate: string, requiredKeys: string[] | undefined): T | null {
  try {
    const parsed = JSON.parse(candidate) as T;
    if (!requiredKeys?.length) {
      return parsed;
    }
    if (parsed && typeof parsed === "object" && requiredKeys.every((key) => key in (parsed as Record<string, unknown>))) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function cleanJsonCandidate(candidate: string): string | null {
  const trimmed = candidate.trim().replace(/^\uFEFF/, "");
  if (!trimmed) {
    return null;
  }

  return trimmed
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function extractBalancedJsonCandidate(text: string, requiredKeys: string[] | undefined): string | null {
  for (let index = 0; index < text.length; index += 1) {
    const start = text[index];
    if (start !== "{" && start !== "[") {
      continue;
    }

    const end = findBalancedEnd(text, index);
    if (end < 0) {
      continue;
    }

    const candidate = cleanJsonCandidate(text.slice(index, end + 1));
    if (!candidate) {
      continue;
    }
    if (requiredKeys?.length && !requiredKeys.every((key) => candidate.includes(`"${key}"`))) {
      continue;
    }
    return candidate;
  }

  return null;
}

function findBalancedEnd(text: string, startIndex: number): number {
  const opening = text[startIndex];
  const stack = [opening === "{" ? "}" : "]"];
  let inString = false;
  let escaped = false;

  for (let index = startIndex + 1; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      stack.push("}");
      continue;
    }
    if (char === "[") {
      stack.push("]");
      continue;
    }

    const expected = stack[stack.length - 1];
    if (char === expected) {
      stack.pop();
      if (stack.length === 0) {
        return index;
      }
    }
  }

  return -1;
}
