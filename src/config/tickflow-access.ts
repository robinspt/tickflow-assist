export type TickflowApiKeyLevel = "free" | "starter" | "pro" | "expert";

const INTRADAY_ENABLED_LEVELS = new Set<TickflowApiKeyLevel>(["pro", "expert"]);
const UNIVERSE_ENABLED_LEVELS = new Set<TickflowApiKeyLevel>(["starter", "pro", "expert"]);

export function normalizeTickflowApiKeyLevel(
  value: unknown,
  fallback: TickflowApiKeyLevel = "free",
): TickflowApiKeyLevel {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (normalized === "export") {
    return "expert";
  }
  if (normalized === "start") {
    return "starter";
  }
  if (normalized === "free" || normalized === "starter" || normalized === "pro" || normalized === "expert") {
    return normalized;
  }
  return fallback;
}

export function supportsIntradayKlines(level: TickflowApiKeyLevel): boolean {
  return INTRADAY_ENABLED_LEVELS.has(level);
}

export function supportsUniverseAccess(level: TickflowApiKeyLevel): boolean {
  return UNIVERSE_ENABLED_LEVELS.has(level);
}

export function formatTickflowApiKeyLevel(level: TickflowApiKeyLevel): string {
  switch (level) {
    case "free":
      return "Free";
    case "starter":
      return "Starter";
    case "pro":
      return "Pro";
    case "expert":
      return "Expert";
  }
}
