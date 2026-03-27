import type { IndicatorRow } from "../../types/indicator.js";
import type { TickFlowIntradayKlineRow, TickFlowKlineRow, TickFlowQuote } from "../../types/tickflow.js";
import type { ReviewMemoryContext } from "../../analysis/types/composite-analysis.js";
import { formatCostPrice, formatCostRelationship } from "../../utils/cost-price.js";

const MAX_INTRADAY_FULL_ROWS = 40;
const MAX_INTRADAY_OPEN_ROWS = 8;
const MAX_INTRADAY_CLOSE_ROWS = 12;
const MAX_INTRADAY_EVENT_ROWS = 6;
const MAX_INTRADAY_INDICATOR_ROWS = 24;

export function buildKlineAnalysisUserPrompt(params: {
  symbol: string;
  costPrice: number | null;
  klines: TickFlowKlineRow[];
  indicators: IndicatorRow[];
  intradayKlines: TickFlowIntradayKlineRow[];
  intradayIndicators: IndicatorRow[];
  realtimeQuote: TickFlowQuote | null;
  reviewMemory?: ReviewMemoryContext | null;
}): string {
  const recentK = params.klines.slice(-30);
  const recentIndicators = params.indicators.slice(-10);
  const latest = params.indicators[params.indicators.length - 1];
  const latestClose = params.klines[params.klines.length - 1]?.close ?? 0;
  const latestRealtimePrice = params.realtimeQuote?.last_price ?? latestClose;
  const latestIntradayIndicator = params.intradayIndicators[params.intradayIndicators.length - 1];

  const klineLines = [
    "## 日K线数据（最近30个交易日）",
    "",
    "```csv",
    "日期,开盘,最高,最低,收盘,成交量,成交额",
    ...recentK.map(
      (row) =>
        [
          row.trade_date,
          fmt(row.open),
          fmt(row.high),
          fmt(row.low),
          fmt(row.close),
          fmtInteger(row.volume),
          fmtInteger(row.amount),
        ].join(","),
    ),
    "```",
  ];

  const indicatorLines = [
    "## 技术指标（最近10个交易日）",
    "",
    "```csv",
    "日期,MA5,MA10,MA20,MA60,MACD,Signal,RSI6,RSI12,KDJ_K,KDJ_D,KDJ_J,CCI,ADX",
    ...recentIndicators.map(
      (row) =>
        [
          row.trade_date,
          fmtPrice(row.ma5),
          fmtPrice(row.ma10),
          fmtPrice(row.ma20),
          fmtPrice(row.ma60),
          fmt(row.macd, 4),
          fmt(row.macd_signal, 4),
          fmtOscillator(row.rsi_6),
          fmtOscillator(row.rsi_12),
          fmtOscillator(row.kdj_k),
          fmtOscillator(row.kdj_d),
          fmtOscillator(row.kdj_j),
          fmtWideOscillator(row.cci),
          fmtOscillator(row.adx),
        ].join(","),
    ),
    "```",
  ];

  const latestLines = latest
    ? [
        "## 最新指标状态",
        "",
        `- MACD: DIF=${fmt(latest.macd, 4)}, DEA=${fmt(latest.macd_signal, 4)}, 柱状=${fmt(latest.macd_hist, 4)}`,
        `- KDJ: K=${fmtOscillator(latest.kdj_k)}, D=${fmtOscillator(latest.kdj_d)}, J=${fmtOscillator(latest.kdj_j)}`,
        `- RSI: RSI6=${fmtOscillator(latest.rsi_6)}, RSI12=${fmtOscillator(latest.rsi_12)}, RSI24=${fmtOscillator(latest.rsi_24)}`,
        `- CCI: ${fmtWideOscillator(latest.cci)}`,
        `- BIAS: 6日=${fmtWideOscillator(latest.bias_6)}, 12日=${fmtWideOscillator(latest.bias_12)}, 24日=${fmtWideOscillator(latest.bias_24)}`,
        `- DMI: +DI=${fmtOscillator(latest.plus_di)}, -DI=${fmtOscillator(latest.minus_di)}, ADX=${fmtOscillator(latest.adx)}`,
        `- BOLL: 上轨=${fmtPrice(latest.boll_upper)}, 中轨=${fmtPrice(latest.boll_mid)}, 下轨=${fmtPrice(latest.boll_lower)}`,
      ]
    : [];

  const realtimeLines = buildRealtimeLines(params.realtimeQuote);
  const reviewMemoryLines = buildReviewMemoryLines(params.reviewMemory);
  const intradaySummaryLines = buildIntradaySummaryLines(
    params.intradayKlines,
    latestIntradayIndicator,
    params.realtimeQuote,
  );
  const sampledIntradayRows = selectSampledIntradayRows(params.intradayKlines);
  const sampledIntradayTimes = new Set(sampledIntradayRows.map((row) => row.trade_time));
  const intradayKlineLines = buildIntradayKlineLines(params.intradayKlines, sampledIntradayRows);
  const intradayIndicatorLines = buildIntradayIndicatorLines(params.intradayIndicators, sampledIntradayTimes);

  return [
    "请结合日线、日内分钟线、分钟指标和实时行情分析以下股票的技术面，并补充日内走势判断，给出关键价位。",
    "",
    `**股票代码**: ${params.symbol}`,
    `**用户成本价**: ${formatCostPrice(params.costPrice, " 元")}`,
    `**最新收盘价**: ${latestClose.toFixed(2)} 元`,
    `**最新实时价**: ${latestRealtimePrice.toFixed(2)} 元`,
    `**相对成本价**: ${formatCostRelationship(latestRealtimePrice, params.costPrice)}`,
    "",
    ...realtimeLines,
    "",
    ...klineLines,
    "",
    ...indicatorLines,
    "",
    ...latestLines,
    "",
    ...reviewMemoryLines,
    ...intradaySummaryLines,
    "",
    ...intradayKlineLines,
    "",
    ...intradayIndicatorLines,
    "",
    "请先给出日线趋势判断，再补充明确的日内走势判断（例如震荡上行、冲高回落、弱势横盘、尾盘转强等）。若历史复盘经验提示近期假突破、支撑失效或止损先到偏多，需要明确判断当前是否仍在重复该模式；但若当前实时走势与历史经验冲突，以当前数据为主。最后输出完整关键价位数据。",
  ].join("\n");
}

function buildReviewMemoryLines(reviewMemory?: ReviewMemoryContext | null): string[] {
  if (!reviewMemory?.available || !reviewMemory.summary.trim()) {
    return [];
  }

  return [
    "## 历史复盘经验（仅作校准）",
    reviewMemory.summary,
  ];
}

function fmt(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return stripTrailingZeros(value.toFixed(digits));
}

function fmtPrice(value: number | null | undefined): string {
  return fmt(value, 2);
}

function fmtOscillator(value: number | null | undefined): string {
  return fmt(value, 1);
}

function fmtWideOscillator(value: number | null | undefined): string {
  return fmt(value, 2);
}

function fmtPercent(value: number | null | undefined, digits = 2): string {
  return value == null || Number.isNaN(value) ? "-" : `${fmt(value, digits)}%`;
}

function fmtInteger(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return String(Math.trunc(value));
}

function buildRealtimeLines(quote: TickFlowQuote | null): string[] {
  if (!quote) {
    return ["## 实时行情", "", "- 暂无实时行情数据"];
  }

  return [
    "## 实时行情",
    "",
    `- 最新价: ${fmt(quote.last_price)}`,
    `- 前收: ${fmt(quote.prev_close)}`,
    `- 涨跌幅: ${fmtPercent(quote.ext?.change_pct)}`,
    `- 成交量: ${Math.trunc(Number(quote.volume ?? 0))}`,
    `- 行情时间: ${formatTimestamp(quote.timestamp)}`,
  ];
}

function buildIntradaySummaryLines(
  rows: TickFlowIntradayKlineRow[],
  latestIndicator: IndicatorRow | undefined,
  quote: TickFlowQuote | null,
): string[] {
  if (rows.length === 0) {
    return ["## 今日分钟线概览", "", "- 今日暂无分钟K线数据"];
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  const sessionHigh = Math.max(...rows.map((row) => row.high));
  const sessionLow = Math.min(...rows.map((row) => row.low));
  const sessionVolume = rows.reduce((sum, row) => sum + row.volume, 0);
  const prevClose = quote?.prev_close ?? last.prev_close ?? first.prev_close;
  const sessionChangePct = prevClose > 0 ? ((last.close - prevClose) / prevClose) * 100 : null;

  const lines = [
    "## 今日分钟线概览",
    "",
    `- 周期: ${last.period}`,
    `- 根数: ${rows.length}`,
    `- 区间: ${first.trade_time} ~ ${last.trade_time}`,
    `- 日内开盘/最高/最低/最新: ${fmt(first.open)} / ${fmt(sessionHigh)} / ${fmt(sessionLow)} / ${fmt(last.close)}`,
    `- 相对前收涨跌幅: ${fmtPercent(sessionChangePct)}`,
    `- 日内累计成交量: ${Math.trunc(sessionVolume)}`,
  ];

  if (latestIndicator) {
    lines.push(
      `- 分钟指标: MA5=${fmtPrice(latestIndicator.ma5)} | MA10=${fmtPrice(latestIndicator.ma10)} | MACD=${fmt(latestIndicator.macd, 4)} | RSI6=${fmtOscillator(latestIndicator.rsi_6)} | KDJ_K=${fmtOscillator(latestIndicator.kdj_k)}`,
    );
  }

  return lines;
}

function buildIntradayKlineLines(
  rows: TickFlowIntradayKlineRow[],
  sampledRows: TickFlowIntradayKlineRow[],
): string[] {
  if (rows.length === 0) {
    return ["## 今日分钟K线", "", "- 暂无分钟K线数据"];
  }

  const sampled = sampledRows.length > 0 ? sampledRows : rows;
  const sampledLabel = sampled.length === rows.length
    ? `全部 ${rows.length} 根`
    : `抽样 ${sampled.length}/${rows.length} 根（开盘、异动、尾盘）`;

  return [
    `## 今日分钟K线（${sampledLabel}）`,
    "",
    "```csv",
    "时间,开盘,最高,最低,收盘,成交量,成交额",
    ...sampled.map(
      (row) =>
        [
          row.trade_time,
          fmt(row.open),
          fmt(row.high),
          fmt(row.low),
          fmt(row.close),
          fmtInteger(row.volume),
          fmtInteger(row.amount),
        ].join(","),
    ),
    "```",
    ...(sampled.length === rows.length
      ? []
      : ["说明: 已保留开盘段、关键异动分钟与尾盘分钟，其余时段用“今日分钟线概览”压缩。"]),
  ];
}

function buildIntradayIndicatorLines(rows: IndicatorRow[], sampledTimes: Set<string>): string[] {
  if (rows.length === 0) {
    return ["## 今日分钟指标", "", "- 暂无分钟指标数据"];
  }

  const sampledRows = selectSampledIntradayIndicatorRows(rows, sampledTimes);
  const sampledLabel = sampledRows.length === rows.length
    ? `全部 ${rows.length} 条`
    : `抽样 ${sampledRows.length}/${rows.length} 条（对齐分钟K与尾盘）`;

  return [
    `## 今日分钟指标（${sampledLabel}）`,
    "",
    "```csv",
    "时间,MA5,MA10,MA20,MACD,Signal,RSI6,KDJ_K,KDJ_D,KDJ_J",
    ...sampledRows.map(
      (row) =>
        [
          row.trade_time ?? "-",
          fmtPrice(row.ma5),
          fmtPrice(row.ma10),
          fmtPrice(row.ma20),
          fmt(row.macd, 4),
          fmt(row.macd_signal, 4),
          fmtOscillator(row.rsi_6),
          fmtOscillator(row.kdj_k),
          fmtOscillator(row.kdj_d),
          fmtOscillator(row.kdj_j),
        ].join(","),
    ),
    "```",
    ...(sampledRows.length === rows.length ? [] : ["说明: 分钟指标按抽样分钟与尾盘区间保留，避免无差别灌入全部 1m 序列。"]),
  ];
}

function stripTrailingZeros(value: string): string {
  return value.replace(/(?:\.0+|(\.\d*?[1-9])0+)$/, "$1");
}

function selectSampledIntradayRows(rows: TickFlowIntradayKlineRow[]): TickFlowIntradayKlineRow[] {
  if (rows.length <= MAX_INTRADAY_FULL_ROWS) {
    return rows;
  }

  const selectedIndexes = new Set<number>();
  addIndexRange(selectedIndexes, 0, Math.min(rows.length - 1, MAX_INTRADAY_OPEN_ROWS - 1));
  addIndexRange(selectedIndexes, Math.max(0, rows.length - MAX_INTRADAY_CLOSE_ROWS), rows.length - 1);

  const eventIndexes = [
    findMaxIndex(rows, (row) => row.high),
    findMinIndex(rows, (row) => row.low),
    findMaxIndex(rows, (row) => row.volume),
    findMaxIndex(rows, (row) => row.amount),
    ...findTopMoveIndexes(rows, MAX_INTRADAY_EVENT_ROWS),
  ];

  for (const index of eventIndexes) {
    if (index >= 0) {
      selectedIndexes.add(index);
    }
  }

  return Array.from(selectedIndexes)
    .sort((left, right) => left - right)
    .map((index) => rows[index]!)
    .filter(Boolean);
}

function selectSampledIntradayIndicatorRows(rows: IndicatorRow[], sampledTimes: Set<string>): IndicatorRow[] {
  if (rows.length <= MAX_INTRADAY_FULL_ROWS) {
    return rows;
  }

  const selectedIndexes = new Set<number>();
  rows.forEach((row, index) => {
    if (row.trade_time && sampledTimes.has(row.trade_time)) {
      selectedIndexes.add(index);
    }
  });
  addIndexRange(selectedIndexes, Math.max(0, rows.length - 12), rows.length - 1);

  let indexes = Array.from(selectedIndexes).sort((left, right) => left - right);
  if (indexes.length === 0) {
    indexes = Array.from({ length: Math.min(rows.length, 12) }, (_, offset) => rows.length - Math.min(rows.length, 12) + offset);
  }
  if (indexes.length > MAX_INTRADAY_INDICATOR_ROWS) {
    indexes = Array.from(
      new Set([
        ...indexes.slice(0, Math.min(8, indexes.length)),
        ...indexes.slice(-16),
      ]),
    ).sort((left, right) => left - right);
  }

  return indexes.map((index) => rows[index]!).filter(Boolean);
}

function addIndexRange(target: Set<number>, start: number, end: number): void {
  for (let index = start; index <= end; index += 1) {
    if (index >= 0) {
      target.add(index);
    }
  }
}

function findMaxIndex<T>(rows: T[], score: (row: T) => number): number {
  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  rows.forEach((row, index) => {
    const value = score(row);
    if (Number.isFinite(value) && value > bestScore) {
      bestScore = value;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function findMinIndex<T>(rows: T[], score: (row: T) => number): number {
  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  rows.forEach((row, index) => {
    const value = score(row);
    if (Number.isFinite(value) && value < bestScore) {
      bestScore = value;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function findTopMoveIndexes(rows: TickFlowIntradayKlineRow[], limit: number): number[] {
  return rows
    .map((row, index) => ({
      index,
      score: Math.abs(row.open > 0 ? (row.close - row.open) / row.open : row.close - row.open),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.index);
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}
