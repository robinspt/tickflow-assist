import {
  formatTickflowApiKeyLevel,
  supportsIntradayKlines,
  type TickflowApiKeyLevel,
} from "../config/tickflow-access.js";
import { FinancialService } from "../services/financial-service.js";
import { AnalysisService } from "../services/analysis-service.js";
import { KlineService } from "../services/kline-service.js";
import { MxApiService } from "../services/mx-search-service.js";
import { QuoteService } from "../services/quote-service.js";
import { WatchlistService } from "../services/watchlist-service.js";
import type { MxSelectStockColumn, MxSelectStockResult } from "../types/mx-select-stock.js";
import type {
  TickFlowFinancialMetricsRecord,
  TickFlowIntradayKlineRow,
  TickFlowKlineRow,
  TickFlowQuote,
} from "../types/tickflow.js";
import { formatChinaDateTime } from "../utils/china-time.js";
import { normalizeSymbol } from "../utils/symbol.js";
import { resolveTickFlowQuoteChangePct } from "../utils/tickflow-quote.js";

interface ScreenStockCandidatesInput {
  keyword: string;
  limit: number;
  dailyKlineCount: number;
  includeDailyKlines: boolean;
  includeIntraday: boolean;
  intradayCount: number;
  includeFinancial: boolean;
  summarize: boolean;
}

interface StockCandidate {
  rank: number;
  symbol: string;
  code: string;
  market: string | null;
  name: string;
  mx: {
    latestPrice: string | null;
    changePct: string | null;
    pe: string | null;
    pb: string | null;
    turnoverRate: string | null;
    volumeRatio: string | null;
    amount: string | null;
    marketValue: string | null;
  };
}

const DEFAULT_CANDIDATE_LIMIT = 3;
const MAX_CANDIDATE_LIMIT = 8;
const DEFAULT_DAILY_KLINE_COUNT = 20;
const MAX_DAILY_KLINE_COUNT = 60;
const DEFAULT_INTRADAY_COUNT = 20;
const MAX_INTRADAY_COUNT = 60;
const MAX_INTRADAY_CANDIDATES = 3;
const MAX_FINANCIAL_CANDIDATES = 2;

function parseInput(rawInput: unknown): ScreenStockCandidatesInput {
  if (typeof rawInput === "string" && rawInput.trim()) {
    return buildInput({ keyword: rawInput.trim() });
  }

  if (typeof rawInput === "object" && rawInput !== null) {
    const input = rawInput as Record<string, unknown>;
    const keyword = String(input.keyword ?? input.query ?? input.q ?? "").trim();
    if (!keyword) {
      throw new Error("screen_stock_candidates requires keyword");
    }
    return buildInput({
      keyword,
      limit: input.limit,
      dailyKlineCount: input.dailyKlineCount ?? input.klineCount,
      includeDailyKlines: input.includeDailyKlines,
      includeIntraday: input.includeIntraday,
      intradayCount: input.intradayCount,
      includeFinancial: input.includeFinancial,
      summarize: input.summarize ?? input.llm,
    });
  }

  throw new Error("invalid screen_stock_candidates input");
}

function buildInput(input: {
  keyword: string;
  limit?: unknown;
  dailyKlineCount?: unknown;
  includeDailyKlines?: unknown;
  includeIntraday?: unknown;
  intradayCount?: unknown;
  includeFinancial?: unknown;
  summarize?: unknown;
}): ScreenStockCandidatesInput {
  return {
    keyword: input.keyword,
    limit: parsePositiveInteger(input.limit, DEFAULT_CANDIDATE_LIMIT, MAX_CANDIDATE_LIMIT),
    dailyKlineCount: parsePositiveInteger(input.dailyKlineCount, DEFAULT_DAILY_KLINE_COUNT, MAX_DAILY_KLINE_COUNT),
    includeDailyKlines: parseOptionalBoolean(input.includeDailyKlines, true),
    includeIntraday: parseOptionalBoolean(input.includeIntraday, false),
    intradayCount: parsePositiveInteger(input.intradayCount, DEFAULT_INTRADAY_COUNT, MAX_INTRADAY_COUNT),
    includeFinancial: parseOptionalBoolean(input.includeFinancial, false),
    summarize: parseOptionalBoolean(input.summarize, false),
  };
}

export function screenStockCandidatesTool(
  tickflowApiKeyLevel: TickflowApiKeyLevel,
  mxApiService: MxApiService,
  quoteService: QuoteService,
  klineService: KlineService,
  financialService: FinancialService,
  watchlistService: WatchlistService,
  analysisService: AnalysisService,
) {
  return {
    name: "screen_stock_candidates",
    description: "Build a small enriched stock candidate pool from MX smart screening plus TickFlow quote/daily K-line data, with strict candidate limits by design.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      let input: ScreenStockCandidatesInput;
      try {
        input = parseInput(rawInput);
      } catch (error) {
        return `智能选股联动失败😔 ${formatError(error)}`;
      }

      try {
        const mxResult = await mxApiService.selectStocks({
          keyword: input.keyword,
          pageNo: 1,
          pageSize: Math.max(20, input.limit),
        });
        const candidates = extractStockCandidatesFromMxResult(mxResult, input.limit);
        if (candidates.length === 0) {
          return [
            `🧭 智能选股候选池: ${input.keyword}`,
            renderMxSummary(mxResult),
            "⚠️ 未解析到可用于 TickFlow 补数据的股票代码。",
          ].join("\n");
        }

        const symbols = candidates.map((candidate) => candidate.symbol);
        const notes: string[] = [];
        const [watchlistSymbols, quotesBySymbol, dailyBySymbol, intradayBySymbol, financialBySymbol] = await Promise.all([
          loadWatchlistSymbols(watchlistService, notes),
          loadQuotes(quoteService, symbols, notes),
          input.includeDailyKlines
            ? loadDailyKlines(klineService, candidates, input.dailyKlineCount, notes)
            : Promise.resolve(new Map<string, TickFlowKlineRow[]>()),
          input.includeIntraday && supportsIntradayKlines(tickflowApiKeyLevel)
            ? loadIntradayKlines(klineService, candidates.slice(0, MAX_INTRADAY_CANDIDATES), input.intradayCount, notes)
            : Promise.resolve(new Map<string, TickFlowIntradayKlineRow[]>()),
          input.includeFinancial && tickflowApiKeyLevel === "expert"
            ? loadFinancialMetrics(financialService, candidates.slice(0, MAX_FINANCIAL_CANDIDATES), notes)
            : Promise.resolve(new Map<string, TickFlowFinancialMetricsRecord>()),
        ]);

        const deterministicText = renderCandidatePool({
          input,
          tickflowApiKeyLevel,
          mxResult,
          candidates,
          watchlistSymbols,
          quotesBySymbol,
          dailyBySymbol,
          intradayBySymbol,
          financialBySymbol,
          notes,
        });
        if (!input.summarize) {
          return deterministicText;
        }

        return appendLlmSummary(deterministicText, analysisService);
      } catch (error) {
        return `智能选股联动失败😔 ${formatError(error)}`;
      }
    },
  };
}

async function appendLlmSummary(
  deterministicText: string,
  analysisService: AnalysisService,
): Promise<string> {
  const configError = analysisService.getConfigurationError();
  if (configError) {
    return [
      deterministicText,
      "",
      "LLM整理:",
      `⚠️ ${configError}`,
    ].join("\n");
  }

  try {
    const summary = await analysisService.generateText(
      [
        "你是 A 股候选池整理助手。",
        "只能基于用户提供的候选池文本进行整理，不得引入外部事实、不得改写或臆造数值。",
        "候选池文本未提供的字段必须写“未提供”或“需另查”，禁止按股票名称推断主营业务、概念归属、产业链位置或公告事件。",
        "输出中文，简洁，突出优先级、主要看点、风险点和下一步验证动作。",
        "这不是投资建议，不要给买卖指令。",
      ].join("\n"),
      [
        "请整理下面的智能选股候选池结果。",
        "要求:",
        "1. 给出候选优先级排序和理由。",
        "2. 标出需要排除或谨慎的点。",
        "3. 给出下一步最多 3 个验证动作。",
        "4. 不要重复大段原始表格。",
        "5. 不要提及候选公司主营业务或具体概念归属，除非原文候选明细已提供该字段。",
        "",
        deterministicText,
      ].join("\n"),
      {
        maxTokens: 900,
        temperature: 0.2,
      },
    );

    return [
      deterministicText,
      "",
      "LLM整理:",
      summary,
    ].join("\n");
  } catch (error) {
    return [
      deterministicText,
      "",
      "LLM整理:",
      `⚠️ LLM整理失败: ${formatError(error)}`,
    ].join("\n");
  }
}

export function extractStockCandidatesFromMxResult(
  result: MxSelectStockResult,
  limit: number,
): StockCandidate[] {
  const columns = result.columns;
  const keyMap = buildCandidateColumnKeyMap(columns);
  const candidates: StockCandidate[] = [];
  const seen = new Set<string>();

  for (const row of result.dataList) {
    const code = readCell(row, keyMap.codeKeys);
    if (!code) {
      continue;
    }
    const market = readCell(row, keyMap.marketKeys);
    const symbol = normalizeCandidateSymbol(code, market);
    if (!symbol || seen.has(symbol)) {
      continue;
    }
    seen.add(symbol);

    candidates.push({
      rank: candidates.length + 1,
      symbol,
      code,
      market,
      name: readCell(row, keyMap.nameKeys) ?? symbol,
      mx: {
        latestPrice: readCell(row, keyMap.latestPriceKeys),
        changePct: readCell(row, keyMap.changePctKeys),
        pe: readCell(row, keyMap.peKeys),
        pb: readCell(row, keyMap.pbKeys),
        turnoverRate: readCell(row, keyMap.turnoverRateKeys),
        volumeRatio: readCell(row, keyMap.volumeRatioKeys),
        amount: readCell(row, keyMap.amountKeys),
        marketValue: readCell(row, keyMap.marketValueKeys),
      },
    });

    if (candidates.length >= limit) {
      break;
    }
  }

  return candidates;
}

function renderCandidatePool(input: {
  input: ScreenStockCandidatesInput;
  tickflowApiKeyLevel: TickflowApiKeyLevel;
  mxResult: MxSelectStockResult;
  candidates: StockCandidate[];
  watchlistSymbols: Set<string>;
  quotesBySymbol: Map<string, TickFlowQuote>;
  dailyBySymbol: Map<string, TickFlowKlineRow[]>;
  intradayBySymbol: Map<string, TickFlowIntradayKlineRow[]>;
  financialBySymbol: Map<string, TickFlowFinancialMetricsRecord>;
  notes: string[];
}): string {
  const lines = [
    `🧭 智能选股候选池: ${input.input.keyword}`,
    `TickFlow等级: ${formatTickflowApiKeyLevel(input.tickflowApiKeyLevel)} | 候选展示: ${input.candidates.length}/${input.input.limit} | 硬上限: ${MAX_CANDIDATE_LIMIT}`,
    renderMxSummary(input.mxResult),
    renderCapabilityPolicy(input.input, input.tickflowApiKeyLevel, input.candidates.length),
  ];

  const conditionLines = renderConditions(input.mxResult);
  if (conditionLines.length > 0) {
    lines.push("", "条件拆解:", ...conditionLines);
  }

  lines.push("", "候选明细:");
  for (const candidate of input.candidates) {
    const quote = input.quotesBySymbol.get(candidate.symbol) ?? null;
    const dailyRows = input.dailyBySymbol.get(candidate.symbol) ?? [];
    const intradayRows = input.intradayBySymbol.get(candidate.symbol) ?? [];
    const financial = input.financialBySymbol.get(candidate.symbol) ?? null;

    lines.push(`${candidate.rank}. ${candidate.name}（${candidate.symbol}）${input.watchlistSymbols.has(candidate.symbol) ? " | 已在本地自选" : ""}`);
    lines.push(`   - 妙想: ${renderMxCandidateMetrics(candidate)}`);
    lines.push(`   - TickFlow行情: ${renderQuote(quote)}`);
    lines.push(`   - 日线: ${renderDailySummary(dailyRows)}`);
    if (input.input.includeIntraday) {
      lines.push(`   - 分钟K: ${supportsIntradayKlines(input.tickflowApiKeyLevel) ? renderIntradaySummary(intradayRows) : "当前等级不支持，已跳过"}`);
    }
    if (input.input.includeFinancial) {
      lines.push(`   - 财务: ${input.tickflowApiKeyLevel === "expert" ? renderFinancialMetrics(financial) : "当前等级不是 Expert，已跳过 TickFlow 财务"}`);
    }
  }

  lines.push("", "后续联动建议:");
  lines.push("- 需要加入本地观察时，先确认具体股票，再调用 `add_stock`；本工具不会自动写入自选。");
  lines.push("- 需要同步到东方财富自选时，先加入本地自选，再调用 `push_eastmoney_watchlist`。");
  lines.push("- 需要单股深度分析时，对候选中的 1-2 只再调用 `analyze`，避免一次性拉取过多数据。");

  if (input.notes.length > 0) {
    lines.push("", "补数据提示:", ...input.notes.map((note) => `- ${note}`));
  }

  return lines.join("\n");
}

function renderMxSummary(result: MxSelectStockResult): string {
  return `妙想选股: 状态 ${result.status ?? "-"} | 业务码 ${result.code ?? "-"} | 总数 ${result.total} | 接口返回 ${result.dataList.length} | 数据来源 ${result.dataSource}`;
}

function renderCapabilityPolicy(
  input: ScreenStockCandidatesInput,
  level: TickflowApiKeyLevel,
  candidateCount: number,
): string {
  const parts = [
    "补数据策略: TickFlow行情 1次批量请求",
    input.includeDailyKlines ? `日K ${candidateCount}只 x ${input.dailyKlineCount}天` : "日K已关闭",
    input.includeIntraday
      ? supportsIntradayKlines(level)
        ? `分钟K最多 ${Math.min(candidateCount, MAX_INTRADAY_CANDIDATES)}只 x ${input.intradayCount}根`
        : "分钟K需 Pro/Expert，已跳过"
      : "分钟K默认关闭",
    input.includeFinancial
      ? level === "expert"
        ? `财务最多 ${Math.min(candidateCount, MAX_FINANCIAL_CANDIDATES)}只`
        : "财务需 Expert，已跳过"
      : "财务默认关闭",
  ];
  return parts.join("；");
}

function renderConditions(result: MxSelectStockResult): string[] {
  const lines: string[] = [];
  if (result.totalCondition) {
    lines.push(`- 组合条件: ${result.totalCondition.describe}（${result.totalCondition.stockCount ?? "-"} 只）`);
  }
  for (const condition of result.responseConditionList.slice(0, 5)) {
    lines.push(`- ${condition.describe}（${condition.stockCount ?? "-"} 只）`);
  }
  return lines;
}

function renderMxCandidateMetrics(candidate: StockCandidate): string {
  return [
    candidate.mx.latestPrice ? `最新价 ${candidate.mx.latestPrice}` : null,
    candidate.mx.changePct ? `涨跌幅 ${candidate.mx.changePct}%` : null,
    candidate.mx.pe ? `PE ${candidate.mx.pe}` : null,
    candidate.mx.pb ? `PB ${candidate.mx.pb}` : null,
    candidate.mx.turnoverRate ? `换手 ${candidate.mx.turnoverRate}%` : null,
    candidate.mx.amount ? `成交额 ${candidate.mx.amount}` : null,
    candidate.mx.marketValue ? `总市值 ${candidate.mx.marketValue}` : null,
  ].filter(Boolean).join("；") || "无核心字段";
}

async function loadWatchlistSymbols(
  watchlistService: WatchlistService,
  notes: string[],
): Promise<Set<string>> {
  try {
    return new Set((await watchlistService.list()).map((item) => item.symbol));
  } catch (error) {
    notes.push(`本地自选状态读取失败: ${formatError(error)}`);
    return new Set();
  }
}

async function loadQuotes(
  quoteService: QuoteService,
  symbols: string[],
  notes: string[],
): Promise<Map<string, TickFlowQuote>> {
  try {
    const quotes = await quoteService.fetchQuotes(symbols);
    return new Map(quotes.map((quote) => [quote.symbol, quote]));
  } catch (error) {
    notes.push(`TickFlow批量行情获取失败: ${formatError(error)}`);
    return new Map();
  }
}

async function loadDailyKlines(
  klineService: KlineService,
  candidates: StockCandidate[],
  count: number,
  notes: string[],
): Promise<Map<string, TickFlowKlineRow[]>> {
  const result = new Map<string, TickFlowKlineRow[]>();
  for (const candidate of candidates) {
    try {
      result.set(candidate.symbol, await klineService.fetchKlines(candidate.symbol, {
        count,
        adjust: "forward",
      }));
    } catch (error) {
      notes.push(`${candidate.symbol} 日K获取失败: ${formatError(error)}`);
    }
  }
  return result;
}

async function loadIntradayKlines(
  klineService: KlineService,
  candidates: StockCandidate[],
  count: number,
  notes: string[],
): Promise<Map<string, TickFlowIntradayKlineRow[]>> {
  const result = new Map<string, TickFlowIntradayKlineRow[]>();
  for (const candidate of candidates) {
    try {
      result.set(candidate.symbol, await klineService.fetchIntradayKlines(candidate.symbol, {
        period: "1m",
        count,
      }));
    } catch (error) {
      notes.push(`${candidate.symbol} 分钟K获取失败: ${formatError(error)}`);
    }
  }
  return result;
}

async function loadFinancialMetrics(
  financialService: FinancialService,
  candidates: StockCandidate[],
  notes: string[],
): Promise<Map<string, TickFlowFinancialMetricsRecord>> {
  const result = new Map<string, TickFlowFinancialMetricsRecord>();
  for (const candidate of candidates) {
    try {
      const rows = await financialService.fetchMetrics(candidate.symbol, { latest: true });
      if (rows[0]) {
        result.set(candidate.symbol, rows[0]);
      }
    } catch (error) {
      notes.push(`${candidate.symbol} 财务指标获取失败: ${formatError(error)}`);
    }
  }
  return result;
}

function renderQuote(quote: TickFlowQuote | null): string {
  if (!quote) {
    return "未返回";
  }
  const changePct = resolveTickFlowQuoteChangePct(quote);
  return [
    `最新 ${formatNumber(quote.last_price)}`,
    changePct == null ? null : `涨跌幅 ${formatSignedPct(changePct)}`,
    quote.timestamp ? `时间 ${formatChinaDateTime(new Date(quote.timestamp))}` : null,
  ].filter(Boolean).join("；");
}

function renderDailySummary(rows: TickFlowKlineRow[]): string {
  if (rows.length === 0) {
    return "未返回";
  }
  const last = rows[rows.length - 1]!;
  const change5 = calculateWindowChange(rows, 5);
  const change20 = calculateWindowChange(rows, 20);
  return [
    `${rows.length}根`,
    `${last.trade_date} 收盘 ${formatNumber(last.close)}`,
    change5 == null ? null : `5日 ${formatSignedPct(change5)}`,
    change20 == null ? null : `20日 ${formatSignedPct(change20)}`,
  ].filter(Boolean).join("；");
}

function renderIntradaySummary(rows: TickFlowIntradayKlineRow[]): string {
  if (rows.length === 0) {
    return "未返回";
  }
  const last = rows[rows.length - 1]!;
  return `${rows.length}根；${last.trade_date} ${last.trade_time} 收盘 ${formatNumber(last.close)}`;
}

function renderFinancialMetrics(row: TickFlowFinancialMetricsRecord | null): string {
  if (!row) {
    return "未返回";
  }
  return [
    `期末 ${row.period_end}`,
    row.roe == null ? null : `ROE ${formatPercentLike(row.roe)}`,
    row.gross_margin == null ? null : `毛利率 ${formatPercentLike(row.gross_margin)}`,
    row.net_income_yoy == null ? null : `净利同比 ${formatPercentLike(row.net_income_yoy)}`,
    row.debt_to_asset_ratio == null ? null : `资产负债率 ${formatPercentLike(row.debt_to_asset_ratio)}`,
  ].filter(Boolean).join("；");
}

function buildCandidateColumnKeyMap(columns: MxSelectStockColumn[]) {
  return {
    codeKeys: ["SECURITY_CODE", ...findColumnKeys(columns, [/代码/, /security.*code/i])],
    nameKeys: ["SECURITY_SHORT_NAME", ...findColumnKeys(columns, [/名称/, /简称/, /security.*name/i])],
    marketKeys: ["MARKET_SHORT_NAME", ...findColumnKeys(columns, [/市场代码简称/, /market/i])],
    latestPriceKeys: ["NEWEST_PRICE", ...findColumnKeys(columns, [/最新价/])],
    changePctKeys: ["CHG", ...findColumnKeys(columns, [/涨跌幅/])],
    peKeys: findColumnKeys(columns, [/市盈率/]),
    pbKeys: findColumnKeys(columns, [/市净率/]),
    turnoverRateKeys: findColumnKeys(columns, [/换手率/]),
    volumeRatioKeys: findColumnKeys(columns, [/量比/]),
    amountKeys: findColumnKeys(columns, [/成交额/]),
    marketValueKeys: findColumnKeys(columns, [/总市值/]),
  };
}

function findColumnKeys(columns: MxSelectStockColumn[], patterns: RegExp[]): string[] {
  return columns
    .filter((column) => {
      const text = `${column.title}\n${column.key}`;
      return patterns.some((pattern) => pattern.test(text));
    })
    .map((column) => column.key);
}

function readCell(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return null;
}

function normalizeCandidateSymbol(code: string, market: string | null): string {
  const digits = code.match(/\d{6}/)?.[0] ?? code.trim();
  const normalizedMarket = String(market ?? "").trim().toUpperCase();
  if (/^\d{6}$/.test(digits) && ["SH", "SZ", "BJ"].includes(normalizedMarket)) {
    return `${digits}.${normalizedMarket}`;
  }
  return normalizeSymbol(digits);
}

function calculateWindowChange(rows: TickFlowKlineRow[], windowSize: number): number | null {
  if (rows.length <= windowSize) {
    return null;
  }
  const latest = rows[rows.length - 1]?.close;
  const previous = rows[rows.length - 1 - windowSize]?.close;
  return calculateChangePct(latest, previous);
}

function calculateChangePct(current: number | undefined, previous: number | undefined): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }
  return ((current - previous) / previous) * 100;
}

function parsePositiveInteger(value: unknown, fallback: number, max: number): number {
  if (value == null || String(value).trim() === "") {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("number must be greater than 0");
  }
  return Math.min(Math.trunc(numeric), max);
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

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return value.toFixed(2);
}

function formatSignedPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatPercentLike(value: number): string {
  return `${value.toFixed(2)}%`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
