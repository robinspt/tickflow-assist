export type TickflowApiKeyLevel = "free" | "start" | "pro" | "expert";

const INTRADAY_ENABLED_LEVELS = new Set<TickflowApiKeyLevel>(["pro", "expert"]);

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
  if (normalized === "free" || normalized === "start" || normalized === "pro" || normalized === "expert") {
    return normalized;
  }
  return fallback;
}

export function supportsIntradayKlines(level: TickflowApiKeyLevel): boolean {
  return INTRADAY_ENABLED_LEVELS.has(level);
}

export function formatTickflowApiKeyLevel(level: TickflowApiKeyLevel): string {
  switch (level) {
    case "free":
      return "Free";
    case "start":
      return "Start";
    case "pro":
      return "Pro";
    case "expert":
      return "Expert";
  }
}
