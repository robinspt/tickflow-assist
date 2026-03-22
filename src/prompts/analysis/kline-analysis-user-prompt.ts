import type { IndicatorRow } from "../../types/indicator.js";
import type { TickFlowIntradayKlineRow, TickFlowKlineRow, TickFlowQuote } from "../../types/tickflow.js";
import type { ReviewMemoryContext } from "../../analysis/types/composite-analysis.js";
import { formatCostPrice } from "../../utils/cost-price.js";

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
          fmt(row.ma5),
          fmt(row.ma10),
          fmt(row.ma20),
          fmt(row.ma60),
          fmt(row.macd, 4),
          fmt(row.macd_signal, 4),
          fmt(row.rsi_6),
          fmt(row.rsi_12),
          fmt(row.kdj_k),
          fmt(row.kdj_d),
          fmt(row.kdj_j),
          fmt(row.cci),
          fmt(row.adx),
        ].join(","),
    ),
    "```",
  ];

  const latestLines = latest
    ? [
        "## 最新指标状态",
        "",
        `- MACD: DIF=${fmt(latest.macd, 4)}, DEA=${fmt(latest.macd_signal, 4)}, 柱状=${fmt(latest.macd_hist, 4)}`,
        `- KDJ: K=${fmt(latest.kdj_k)}, D=${fmt(latest.kdj_d)}, J=${fmt(latest.kdj_j)}`,
        `- RSI: RSI6=${fmt(latest.rsi_6)}, RSI12=${fmt(latest.rsi_12)}, RSI24=${fmt(latest.rsi_24)}`,
        `- CCI: ${fmt(latest.cci)}`,
        `- BIAS: 6日=${fmt(latest.bias_6)}, 12日=${fmt(latest.bias_12)}, 24日=${fmt(latest.bias_24)}`,
        `- DMI: +DI=${fmt(latest.plus_di)}, -DI=${fmt(latest.minus_di)}, ADX=${fmt(latest.adx)}`,
        `- BOLL: 上轨=${fmt(latest.boll_upper)}, 中轨=${fmt(latest.boll_mid)}, 下轨=${fmt(latest.boll_lower)}`,
      ]
    : [];

  const realtimeLines = buildRealtimeLines(params.realtimeQuote);
  const reviewMemoryLines = buildReviewMemoryLines(params.reviewMemory);
  const intradaySummaryLines = buildIntradaySummaryLines(
    params.intradayKlines,
    latestIntradayIndicator,
    params.realtimeQuote,
  );
  const intradayKlineLines = buildIntradayKlineLines(params.intradayKlines);
  const intradayIndicatorLines = buildIntradayIndicatorLines(params.intradayIndicators);

  return [
    "请结合日线、日内分钟线、分钟指标和实时行情分析以下股票的技术面，并补充日内走势判断，给出关键价位。",
    "",
    `**股票代码**: ${params.symbol}`,
    `**用户成本价**: ${formatCostPrice(params.costPrice, " 元")}`,
    `**最新收盘价**: ${latestClose.toFixed(2)} 元`,
    `**最新实时价**: ${latestRealtimePrice.toFixed(2)} 元`,
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
      `- 分钟指标: MA5=${fmt(latestIndicator.ma5)} | MA10=${fmt(latestIndicator.ma10)} | MACD=${fmt(latestIndicator.macd, 4)} | RSI6=${fmt(latestIndicator.rsi_6)} | KDJ_K=${fmt(latestIndicator.kdj_k)}`,
    );
  }

  return lines;
}

function buildIntradayKlineLines(rows: TickFlowIntradayKlineRow[]): string[] {
  if (rows.length === 0) {
    return ["## 今日分钟K线", "", "- 暂无分钟K线数据"];
  }

  return [
    `## 今日分钟K线（全部 ${rows.length} 根）`,
    "",
    "```csv",
    "时间,开盘,最高,最低,收盘,成交量,成交额",
    ...rows.map(
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
  ];
}

function buildIntradayIndicatorLines(rows: IndicatorRow[]): string[] {
  if (rows.length === 0) {
    return ["## 今日分钟指标", "", "- 暂无分钟指标数据"];
  }

  return [
    `## 今日分钟指标（全部 ${rows.length} 条）`,
    "",
    "```csv",
    "时间,MA5,MA10,MA20,MACD,Signal,RSI6,KDJ_K,KDJ_D,KDJ_J",
    ...rows.map(
      (row) =>
        [
          row.trade_time ?? "-",
          fmt(row.ma5),
          fmt(row.ma10),
          fmt(row.ma20),
          fmt(row.macd, 4),
          fmt(row.macd_signal, 4),
          fmt(row.rsi_6),
          fmt(row.kdj_k),
          fmt(row.kdj_d),
          fmt(row.kdj_j),
        ].join(","),
    ),
    "```",
  ];
}

function stripTrailingZeros(value: string): string {
  return value.replace(/(?:\.0+|(\.\d*?[1-9])0+)$/, "$1");
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
