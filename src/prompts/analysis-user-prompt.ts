import type { IndicatorRow } from "../types/indicator.js";
import type { TickFlowKlineRow } from "../types/tickflow.js";

export function buildAnalysisUserPrompt(params: {
  symbol: string;
  costPrice: number;
  klines: TickFlowKlineRow[];
  indicators: IndicatorRow[];
}): string {
  const recentK = params.klines.slice(-30);
  const recentIndicators = params.indicators.slice(-10);
  const latest = params.indicators[params.indicators.length - 1];
  const latestClose = params.klines[params.klines.length - 1]?.close ?? 0;

  const klineLines = [
    "## 日K线数据（最近30个交易日）",
    "",
    "| 日期 | 开盘 | 最高 | 最低 | 收盘 | 成交量 | 成交额 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...recentK.map(
      (row) =>
        `| ${row.trade_date} | ${row.open.toFixed(2)} | ${row.high.toFixed(2)} | ${row.low.toFixed(2)} | ${row.close.toFixed(2)} | ${Math.trunc(row.volume)} | ${Math.trunc(row.amount)} |`,
    ),
  ];

  const indicatorLines = [
    "## 技术指标（最近10个交易日）",
    "",
    "| 日期 | MA5 | MA10 | MA20 | MA60 | MACD | Signal | RSI6 | RSI12 | KDJ_K | KDJ_D | KDJ_J | CCI | ADX |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...recentIndicators.map(
      (row) =>
        `| ${row.trade_date} | ${fmt(row.ma5)} | ${fmt(row.ma10)} | ${fmt(row.ma20)} | ${fmt(row.ma60)} | ${fmt(row.macd, 4)} | ${fmt(row.macd_signal, 4)} | ${fmt(row.rsi_6)} | ${fmt(row.rsi_12)} | ${fmt(row.kdj_k)} | ${fmt(row.kdj_d)} | ${fmt(row.kdj_j)} | ${fmt(row.cci)} | ${fmt(row.adx)} |`,
    ),
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

  return [
    "请分析以下股票的技术面，给出关键价位。",
    "",
    `**股票代码**: ${params.symbol}`,
    `**用户成本价**: ${params.costPrice.toFixed(2)} 元`,
    `**最新收盘价**: ${latestClose.toFixed(2)} 元`,
    "",
    ...klineLines,
    "",
    ...indicatorLines,
    "",
    ...latestLines,
    "",
    "请给出简洁的技术分析结论和完整的关键价位数据。",
  ].join("\n");
}

function fmt(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return value.toFixed(digits);
}
