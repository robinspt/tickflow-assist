import type { WatchlistItem } from "../types/domain.js";
import type { MxSelfSelectStock } from "../types/mx-self-select.js";
import { MxApiService } from "../services/mx-search-service.js";
import { WatchlistService } from "../services/watchlist-service.js";
import { normalizeSymbol } from "../utils/symbol.js";

const MX_ZIXUAN_DAILY_LIMIT = 200;
const DEFAULT_SYNC_ENRICH_PROFILE = false;

interface SymbolListInput {
  symbols: string[] | null;
  limit: number | null;
}

interface SyncInput {
  limit: number | null;
  refreshProfiles: boolean;
}

interface RemoveEastmoneyInput {
  target: string;
}

interface OperationResult {
  item: WatchlistItem;
  ok: boolean;
  message: string;
}

export function listEastmoneyWatchlistTool(mxApiService: MxApiService) {
  return {
    name: "list_eastmoney_watchlist",
    description: "List Eastmoney account self-selected stocks via MX zixuan. Uses 1 call from the 200/day MX zixuan quota.",
    async run(): Promise<string> {
      try {
        const result = await mxApiService.getSelfSelectWatchlist();
        return renderEastmoneyWatchlist(result.stocks, 1);
      } catch (error) {
        return `查询东方财富自选失败😔 ${formatErrorMessage(error)}`;
      }
    },
  };
}

export function syncEastmoneyWatchlistTool(
  mxApiService: MxApiService,
  watchlistService: WatchlistService,
) {
  return {
    name: "sync_eastmoney_watchlist",
    description: "Import Eastmoney self-selected stocks into the local TickFlow Assist watchlist. Uses 1 call from the 200/day MX zixuan quota.",
    optional: true,
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      let input: SyncInput;
      try {
        input = parseSyncInput(rawInput);
      } catch (error) {
        return `同步东方财富自选失败😔 ${formatErrorMessage(error)}`;
      }
      try {
        const remote = await mxApiService.getSelfSelectWatchlist();
        const local = await watchlistService.list();
        const localSymbols = new Set(local.map((item) => item.symbol));
        const existingCount = remote.stocks.filter((stock) => localSymbols.has(stock.symbol)).length;
        const missing = remote.stocks.filter((stock) => !localSymbols.has(stock.symbol));
        const candidates = missing.slice(0, input.limit ?? undefined);
        const added: WatchlistItem[] = [];
        const failed: Array<{ stock: MxSelfSelectStock; error: string }> = [];

        for (const stock of candidates) {
          try {
            const result = await watchlistService.add(stock.symbol, null, {
              enrichProfile: input.refreshProfiles,
              name: stock.name,
            });
            added.push(result.item);
          } catch (error) {
            failed.push({ stock, error: formatErrorMessage(error) });
          }
        }

        const limitedOut = missing.length - candidates.length;
        return [
          "🔄 东方财富自选 -> 本地关注列表",
          `妙想自选接口调用: 1 次（每日额度 ${MX_ZIXUAN_DAILY_LIMIT} 次）`,
          `东方财富自选: ${remote.stocks.length} 只 | 本地已有: ${existingCount} 只 | 待同步: ${missing.length} 只 | 本次新增: ${added.length} 只 | 失败: ${failed.length} 只`,
          limitedOut > 0 ? `因 limit 限制未处理: ${limitedOut} 只` : null,
          input.refreshProfiles
            ? "行业/概念: 本次同步已尝试刷新"
            : "行业/概念: 本次同步默认不刷新，可后续调用 refresh_watchlist_profiles",
          formatAddedItems(added),
          formatSyncFailures(failed),
        ].filter(Boolean).join("\n");
      } catch (error) {
        return `同步东方财富自选失败😔 ${formatErrorMessage(error)}`;
      }
    },
  };
}

export function pushEastmoneyWatchlistTool(
  mxApiService: MxApiService,
  watchlistService: WatchlistService,
) {
  return {
    name: "push_eastmoney_watchlist",
    description: "Add local TickFlow Assist watchlist symbols to Eastmoney self-select. Uses 1 MX zixuan call per stock from the 200/day quota.",
    optional: true,
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      let input: SymbolListInput;
      try {
        input = parseSymbolListInput(rawInput);
      } catch (error) {
        return `推送东方财富自选失败😔 ${formatErrorMessage(error)}`;
      }
      const local = await watchlistService.list();
      const targets = selectLocalTargets(local, input);

      if (targets.length === 0) {
        return input.symbols
          ? `⚠️ 本地关注列表中未找到指定股票: ${input.symbols.join("、")}`
          : "⚠️ 本地关注列表为空，无法推送到东方财富自选。";
      }
      if (targets.length > MX_ZIXUAN_DAILY_LIMIT) {
        return `⚠️ 本次需要 ${targets.length} 次妙想自选调用，超过每日额度 ${MX_ZIXUAN_DAILY_LIMIT} 次，已取消。请缩小 symbols 或 limit。`;
      }

      const results: OperationResult[] = [];
      for (const item of targets) {
        try {
          const result = await mxApiService.manageSelfSelect(buildEastmoneyAddQuery(item));
          results.push({ item, ok: true, message: result.message ?? "已提交" });
        } catch (error) {
          results.push({ item, ok: false, message: formatErrorMessage(error) });
        }
      }

      return renderManageResults("⬆️ 本地关注列表 -> 东方财富自选", targets.length, results);
    },
  };
}

export function removeEastmoneyWatchlistTool(mxApiService: MxApiService) {
  return {
    name: "remove_eastmoney_watchlist",
    description: "Remove one stock from Eastmoney self-select via MX zixuan. Uses 1 call from the 200/day quota and does not remove the local watchlist item.",
    optional: true,
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      let input: RemoveEastmoneyInput;
      try {
        input = parseRemoveEastmoneyInput(rawInput);
      } catch (error) {
        return `删除东方财富自选失败😔 ${formatErrorMessage(error)}`;
      }

      try {
        const result = await mxApiService.manageSelfSelect(`把${input.target}从我的自选股列表删除`);
        return [
          "🗑️ 东方财富自选删除",
          `妙想自选接口调用: 1 次（每日额度 ${MX_ZIXUAN_DAILY_LIMIT} 次）`,
          `目标: ${input.target}`,
          `结果: ${result.message ?? "已提交"}`,
          "说明: 本操作不删除 TickFlow Assist 本地关注列表，如需本地删除请调用 remove_stock。",
        ].join("\n");
      } catch (error) {
        return `删除东方财富自选失败😔 ${formatErrorMessage(error)}`;
      }
    },
  };
}

function parseSyncInput(rawInput: unknown): SyncInput {
  if (typeof rawInput === "object" && rawInput !== null) {
    const input = rawInput as Record<string, unknown>;
    return {
      limit: parseOptionalPositiveInteger(input.limit),
      refreshProfiles: parseOptionalBoolean(input.refreshProfiles, DEFAULT_SYNC_ENRICH_PROFILE),
    };
  }

  return {
    limit: null,
    refreshProfiles: DEFAULT_SYNC_ENRICH_PROFILE,
  };
}

function parseSymbolListInput(rawInput: unknown): SymbolListInput {
  if (typeof rawInput === "string" && rawInput.trim()) {
    const text = rawInput.trim();
    if (["all", "全部", "全量", "所有"].includes(text.toLowerCase())) {
      return { symbols: null, limit: null };
    }
    return { symbols: [normalizeSymbol(text)], limit: null };
  }

  if (typeof rawInput === "object" && rawInput !== null) {
    const input = rawInput as Record<string, unknown>;
    const single = String(input.symbol ?? input.code ?? "").trim();
    const rawSymbols = Array.isArray(input.symbols)
      ? input.symbols
      : single
        ? [single]
        : null;
    return {
      symbols: rawSymbols ? rawSymbols.map((item) => normalizeSymbol(String(item))).filter(Boolean) : null,
      limit: parseOptionalPositiveInteger(input.limit),
    };
  }

  return { symbols: null, limit: null };
}

function parseRemoveEastmoneyInput(rawInput: unknown): RemoveEastmoneyInput {
  if (typeof rawInput === "string" && rawInput.trim()) {
    return { target: rawInput.trim() };
  }

  if (typeof rawInput === "object" && rawInput !== null) {
    const input = rawInput as Record<string, unknown>;
    const target = String(input.symbol ?? input.code ?? input.name ?? input.target ?? "").trim();
    if (target) {
      return { target };
    }
  }

  throw new Error("remove_eastmoney_watchlist requires symbol/name");
}

function parseOptionalPositiveInteger(value: unknown): number | null {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("limit must be greater than 0");
  }
  return Math.trunc(numeric);
}

function parseOptionalBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function selectLocalTargets(items: WatchlistItem[], input: SymbolListInput): WatchlistItem[] {
  const selected = input.symbols
    ? items.filter((item) => input.symbols!.includes(item.symbol))
    : items;
  return selected.slice(0, input.limit ?? undefined);
}

function buildEastmoneyAddQuery(item: WatchlistItem): string {
  return `把${item.symbol.slice(0, 6)} ${item.name}添加到我的自选股列表`;
}

function renderEastmoneyWatchlist(stocks: MxSelfSelectStock[], callCount: number): string {
  if (stocks.length === 0) {
    return [
      "📊 东方财富自选股列表",
      `妙想自选接口调用: ${callCount} 次（每日额度 ${MX_ZIXUAN_DAILY_LIMIT} 次）`,
      "ℹ️ 当前东方财富自选股列表为空。",
    ].join("\n");
  }

  const lines = [
    "📊 东方财富自选股列表",
    `妙想自选接口调用: ${callCount} 次（每日额度 ${MX_ZIXUAN_DAILY_LIMIT} 次）`,
    `共 ${stocks.length} 只`,
    "",
  ];
  for (const stock of stocks) {
    const marketFields = [
      stock.latestPrice ? `最新价 ${stock.latestPrice}` : null,
      stock.changePercent ? `涨跌幅 ${formatPercent(stock.changePercent)}` : null,
      stock.changeAmount ? `涨跌额 ${stock.changeAmount}` : null,
      stock.turnoverRate ? `换手率 ${formatPercent(stock.turnoverRate)}` : null,
      stock.volumeRatio ? `量比 ${stock.volumeRatio}` : null,
    ].filter(Boolean);
    lines.push(`• ${stock.name}（${stock.symbol}）${marketFields.length > 0 ? ` | ${marketFields.join(" | ")}` : ""}`);
  }
  return lines.join("\n");
}

function renderManageResults(title: string, callCount: number, results: OperationResult[]): string {
  const success = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  return [
    title,
    `妙想自选接口调用: ${callCount} 次（每日额度 ${MX_ZIXUAN_DAILY_LIMIT} 次）`,
    `成功: ${success.length} 只 | 失败: ${failed.length} 只`,
    formatOperationSection("成功", success),
    formatOperationSection("失败", failed),
  ].filter(Boolean).join("\n");
}

function formatOperationSection(title: string, results: OperationResult[]): string | null {
  if (results.length === 0) {
    return null;
  }
  return [
    `${title}:`,
    ...results.map((result) => `• ${result.item.name}（${result.item.symbol}）: ${result.message}`),
  ].join("\n");
}

function formatAddedItems(items: WatchlistItem[]): string | null {
  if (items.length === 0) {
    return null;
  }
  return [
    "新增:",
    ...items.map((item) => `• ${item.name}（${item.symbol}）`),
  ].join("\n");
}

function formatSyncFailures(failed: Array<{ stock: MxSelfSelectStock; error: string }>): string | null {
  if (failed.length === 0) {
    return null;
  }
  return [
    "失败:",
    ...failed.map(({ stock, error }) => `• ${stock.name}（${stock.symbol}）: ${error}`),
  ].join("\n");
}

function formatPercent(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value;
  }
  return `${numeric > 0 ? "+" : ""}${value}%`;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
