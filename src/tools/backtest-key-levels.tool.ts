import { KeyLevelsBacktestService } from "../services/key-levels-backtest-service.js";

interface BacktestInput {
  symbol?: string;
  recentLimit?: number;
}

function parseInput(rawInput: unknown): BacktestInput {
  if (rawInput == null || rawInput === "") {
    return {};
  }

  if (typeof rawInput === "string") {
    const text = rawInput.trim();
    if (!text || text.toLowerCase() === "all" || text === "全部") {
      return {};
    }

    const [symbol, limitToken] = text.split(/\s+/, 2);
    return {
      symbol,
      recentLimit: normalizeLimit(limitToken),
    };
  }

  if (typeof rawInput === "object" && rawInput !== null) {
    const input = rawInput as Record<string, unknown>;
    return {
      symbol: typeof input.symbol === "string" && input.symbol.trim() ? input.symbol.trim() : undefined,
      recentLimit: normalizeLimit(input.recentLimit ?? input.limit ?? input.count),
    };
  }

  throw new Error("backtest_key_levels input is invalid");
}

function normalizeLimit(value: unknown): number | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("backtest_key_levels recentLimit must be > 0");
  }
  return Math.min(Math.trunc(limit), 20);
}

export function backtestKeyLevelsTool(keyLevelsBacktestService: KeyLevelsBacktestService) {
  return {
    name: "backtest_key_levels",
    description:
      "Backtest active key-level snapshots with 1/3/5-day support, resistance, stop-loss, take-profit, and breakthrough effectiveness statistics.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      return keyLevelsBacktestService.render(parseInput(rawInput));
    },
  };
}
