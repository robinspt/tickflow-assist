import sharp from "sharp";

export type AlertImageTone = "support" | "breakthrough" | "stop_loss" | "take_profit" | "pressure";

export interface AlertImagePoint {
  time: string;
  price: number;
}

export interface AlertImageLevels {
  stopLoss?: number | null;
  support?: number | null;
  resistance?: number | null;
  breakthrough?: number | null;
  takeProfit?: number | null;
}

export interface AlertImageInput {
  tone: AlertImageTone;
  alertLabel: string;
  name: string;
  symbol: string;
  timestampLabel: string;
  currentPrice: number;
  triggerPrice: number;
  changePct?: number | null;
  distancePct?: number | null;
  costPrice?: number | null;
  profitPct?: number | null;
  note: string;
  points: AlertImagePoint[];
  levels: AlertImageLevels;
}

interface AlertTheme {
  accent: string;
  accentSoft: string;
  accentStrong: string;
  panelBorder: string;
  priceTagFill: string;
  signalPillFill: string;
  signalPillText: string;
}

interface DirectionTheme {
  backgroundStart: string;
  backgroundMid: string;
  backgroundEnd: string;
  glowStrong: string;
  glowSoft: string;
  ribbon: string;
  frameStroke: string;
  marketPillFill: string;
  marketPillText: string;
  marketLabel: string;
  panelFill: string;
  chartPanelFill: string;
  levelPanelFill: string;
}

const WIDTH = 960;
const HEIGHT = 640;
const MARKET_OPEN_MINUTES = 9 * 60 + 30;
const MORNING_CLOSE_MINUTES = 11 * 60 + 30;
const AFTERNOON_OPEN_MINUTES = 13 * 60;
const MARKET_CLOSE_MINUTES = 15 * 60;
const MARKET_SESSION_MINUTES =
  (MORNING_CLOSE_MINUTES - MARKET_OPEN_MINUTES) + (MARKET_CLOSE_MINUTES - AFTERNOON_OPEN_MINUTES);

export function renderAlertCardSvg(input: AlertImageInput): string {
  if (input.points.length < 2) {
    throw new Error("alert image requires at least 2 points");
  }

  const chartPoints = normalizeChartPoints(input.points);
  if (chartPoints.length < 2) {
    throw new Error("alert image requires at least 2 chart points");
  }

  const theme = resolveTheme(input.tone);
  const direction = resolveMarketDirection(input);
  const directionTheme = resolveDirectionTheme(direction);
  const frame = {
    x: 24,
    y: 24,
    width: 912,
    height: HEIGHT - 48,
  };
  const chart = {
    left: 44,
    top: 214,
    width: 650,
    height: 228,
  };
  const levelPanel = {
    x: 714,
    y: 214,
    width: 202,
    height: 228,
  };
  const rail = {
    left: 60,
    top: 594,
    width: 840,
  };
  const xAxisTextY = chart.top + chart.height + 28;
  const noteTitleY = 500;
  const noteTextY = 526;
  const railTitleY = 562;

  const priceValues = [
    input.currentPrice,
    input.triggerPrice,
    ...chartPoints.map((point) => point.price),
    input.levels.stopLoss ?? null,
    input.levels.support ?? null,
    input.levels.resistance ?? null,
    input.levels.breakthrough ?? null,
    input.levels.takeProfit ?? null,
  ].filter((value): value is number => value != null && Number.isFinite(value));

  const minValue = Math.min(...priceValues);
  const maxValue = Math.max(...priceValues);
  const padding = Math.max((maxValue - minValue) * 0.18, 0.18);
  const scaledMin = minValue - padding;
  const scaledMax = maxValue + padding;
  const valueRange = Math.max(0.01, scaledMax - scaledMin);

  const scaleX = (timeLabel: string): number => scaleTradingTime(timeLabel, chart.left, chart.width);
  const scaleY = (value: number): number => (
    chart.top + ((scaledMax - value) / valueRange) * chart.height
  );
  const firstPoint = chartPoints[0]!;
  const lastPoint = chartPoints[chartPoints.length - 1]!;
  const firstX = scaleX(firstPoint.time);
  const currentX = scaleX(lastPoint.time);
  const currentY = scaleY(lastPoint.price);
  const sessionJoinX = scaleX("11:30");

  const linePath = chartPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${scaleX(point.time).toFixed(2)} ${scaleY(point.price).toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L ${currentX.toFixed(2)} ${(chart.top + chart.height).toFixed(2)} L ${firstX.toFixed(2)} ${(chart.top + chart.height).toFixed(2)} Z`;

  const horizontalGrid = Array.from({ length: 5 }, (_, index) => {
    const y = chart.top + (index / 4) * chart.height;
    const value = scaledMax - (index / 4) * valueRange;
    return {
      y,
      value,
    };
  });

  const timeMarkers = buildTimeMarkers(chartPoints, scaleX);
  const levelEntries = buildLevelEntries(input);
  const levelPanelEntries = [...levelEntries].sort((left, right) => right.value - left.value);
  const levelLines = buildLevelLines(levelEntries, scaleY);
  const railMarkers = buildRailMarkers(input, rail.left, rail.width, rail.top, scaledMin, scaledMax);
  const metricLines = buildMetricLines(input);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${WIDTH}" y2="${HEIGHT}" gradientUnits="userSpaceOnUse">
      <stop stop-color="${directionTheme.backgroundStart}"/>
      <stop offset="0.55" stop-color="${directionTheme.backgroundMid}"/>
      <stop offset="1" stop-color="${directionTheme.backgroundEnd}"/>
    </linearGradient>
    <linearGradient id="chartFill" x1="${chart.left}" y1="${chart.top}" x2="${chart.left}" y2="${chart.top + chart.height}" gradientUnits="userSpaceOnUse">
      <stop stop-color="${theme.accentSoft}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${theme.accentSoft}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="chartStroke" x1="${chart.left}" y1="${chart.top}" x2="${chart.left + chart.width}" y2="${chart.top}" gradientUnits="userSpaceOnUse">
      <stop stop-color="${theme.accent}"/>
      <stop offset="1" stop-color="${theme.accentStrong}"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#02060C" flood-opacity="0.42"/>
    </filter>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" rx="28" fill="url(#bg)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" rx="28" fill="${directionTheme.glowSoft}" fill-opacity="0.16"/>
  <circle cx="842" cy="96" r="164" fill="${directionTheme.glowStrong}" fill-opacity="0.26"/>
  <circle cx="760" cy="430" r="192" fill="${directionTheme.glowSoft}" fill-opacity="0.18"/>
  <circle cx="120" cy="520" r="208" fill="${theme.accentSoft}" fill-opacity="0.12"/>

  <rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="24" fill="${directionTheme.panelFill}" fill-opacity="0.90" stroke="${directionTheme.frameStroke}" stroke-width="1.4" stroke-opacity="0.95"/>
  <rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="12" rx="24" fill="${directionTheme.ribbon}"/>

  <text x="48" y="58" fill="#88A2BF" font-size="14" font-family="'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif" letter-spacing="1.2">TICKFLOW ALERT PREVIEW</text>
  <text x="48" y="108" fill="#F4F8FC" font-size="34" font-weight="700" font-family="'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif">${escapeXml(input.name)}</text>
  <text x="48" y="136" fill="#8FA8C4" font-size="18" font-family="'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif">${escapeXml(input.symbol)} | ${escapeXml(input.timestampLabel)}</text>
  <rect x="48" y="150" width="122" height="30" rx="15" fill="${directionTheme.marketPillFill}"/>
  <text x="109" y="170" text-anchor="middle" fill="${directionTheme.marketPillText}" font-size="14" font-weight="700" font-family="'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif">${escapeXml(directionTheme.marketLabel)}</text>

  <rect x="710" y="42" width="198" height="42" rx="21" fill="${theme.signalPillFill}" />
  <text x="809" y="69" text-anchor="middle" fill="${theme.signalPillText}" font-size="18" font-weight="700" font-family="'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif">${escapeXml(input.alertLabel)}</text>

  <text x="718" y="118" fill="#8AA3BE" font-size="15" font-family="'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif">当前价</text>
  <text x="718" y="156" fill="#F6FBFF" font-size="34" font-weight="800" font-family="'JetBrains Mono','SFMono-Regular','Consolas',monospace">${input.currentPrice.toFixed(2)}</text>
  ${metricLines.map((line, index) => `
  <text x="718" y="${180 + index * 18}" fill="#A8BED7" font-size="14" font-family="'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif">${escapeXml(line)}</text>`).join("")}

  <rect x="${chart.left}" y="${chart.top}" width="${chart.width}" height="${chart.height}" rx="18" fill="${directionTheme.chartPanelFill}" stroke="${theme.panelBorder}" stroke-opacity="0.9"/>
  <line x1="${sessionJoinX.toFixed(2)}" y1="${chart.top + 10}" x2="${sessionJoinX.toFixed(2)}" y2="${chart.top + chart.height - 10}" stroke="#3B4F68" stroke-opacity="0.8" stroke-dasharray="3 8"/>
  ${horizontalGrid.map((line) => `
  <line x1="${chart.left}" y1="${line.y.toFixed(2)}" x2="${chart.left + chart.width}" y2="${line.y.toFixed(2)}" stroke="#213247" stroke-dasharray="4 8"/>
  <text x="${chart.left + 12}" y="${(line.y - 8).toFixed(2)}" fill="#6E88A5" font-size="12" font-family="'JetBrains Mono','SFMono-Regular','Consolas',monospace">${line.value.toFixed(2)}</text>`).join("")}

  ${levelLines.map((line) => `
  <line x1="${chart.left}" y1="${line.lineY.toFixed(2)}" x2="${chart.left + chart.width}" y2="${line.lineY.toFixed(2)}" stroke="${line.stroke}" stroke-width="${line.width}" stroke-dasharray="${line.dasharray}"/>`).join("")}

  <path d="${areaPath}" fill="url(#chartFill)"/>
  <path d="${linePath}" stroke="url(#chartStroke)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" filter="url(#shadow)"/>
  <circle cx="${currentX.toFixed(2)}" cy="${currentY.toFixed(2)}" r="7" fill="${theme.accentStrong}" stroke="#F4FBFF" stroke-width="3"/>

  <rect x="${levelPanel.x}" y="${levelPanel.y}" width="${levelPanel.width}" height="${levelPanel.height}" rx="18" fill="${directionTheme.levelPanelFill}" stroke="${theme.panelBorder}" stroke-opacity="0.9"/>
  <text x="${levelPanel.x + 18}" y="${levelPanel.y + 28}" fill="#8EA7C1" font-size="14" font-family="'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif">关键价位</text>
  ${levelPanelEntries.map((entry, index) => {
    const rowY = levelPanel.y + 60 + index * 34;
    return `
  <line x1="${levelPanel.x + 18}" y1="${rowY}" x2="${levelPanel.x + 42}" y2="${rowY}" stroke="${entry.stroke}" stroke-width="${entry.width + 0.5}" stroke-dasharray="${entry.dasharray}"/>
  <text x="${levelPanel.x + 54}" y="${rowY + 5}" fill="#DCE8F5" font-size="14" font-weight="600" font-family="'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif">${escapeXml(entry.label)}</text>
  <text x="${levelPanel.x + levelPanel.width - 18}" y="${rowY + 5}" text-anchor="end" fill="${entry.text}" font-size="14" font-weight="700" font-family="'JetBrains Mono','SFMono-Regular','Consolas',monospace">${entry.value.toFixed(2)}</text>`;
  }).join("")}

  ${timeMarkers.map((marker) => `
  <line x1="${marker.x.toFixed(2)}" y1="${chart.top + chart.height}" x2="${marker.x.toFixed(2)}" y2="${chart.top + chart.height + 8}" stroke="#48627E"/>
  <text x="${marker.x.toFixed(2)}" y="${xAxisTextY}" text-anchor="middle" fill="#7791AD" font-size="12" font-family="'JetBrains Mono','SFMono-Regular','Consolas',monospace">${escapeXml(marker.label)}</text>`).join("")}

  <text x="48" y="${noteTitleY}" fill="#8EA7C1" font-size="14" font-family="'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif">告警说明</text>
  <text x="48" y="${noteTextY}" fill="#E8F1F8" font-size="16" font-weight="600" font-family="'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif">${escapeXml(input.note)}</text>

  <text x="48" y="${railTitleY}" fill="#8EA7C1" font-size="14" font-family="'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif">位阶带</text>
  <line x1="${rail.left}" y1="${rail.top}" x2="${rail.left + rail.width}" y2="${rail.top}" stroke="#2E445D" stroke-width="8" stroke-linecap="round"/>
  ${railMarkers.map((marker) => `
  <line x1="${marker.x.toFixed(2)}" y1="${(rail.top - 14).toFixed(2)}" x2="${marker.x.toFixed(2)}" y2="${(rail.top + 14).toFixed(2)}" stroke="${marker.stroke}" stroke-width="${marker.width}" stroke-linecap="round"/>
  <text x="${marker.x.toFixed(2)}" y="${marker.textY.toFixed(2)}" text-anchor="middle" fill="${marker.text}" font-size="12" font-weight="700" font-family="'Noto Sans CJK SC','Microsoft YaHei','PingFang SC',sans-serif">${escapeXml(marker.label)}</text>`).join("")}
</svg>`;
}

export async function renderAlertCardPng(input: AlertImageInput): Promise<Buffer> {
  const svg = renderAlertCardSvg(input);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function resolveMarketDirection(input: AlertImageInput): "up" | "down" | "flat" {
  const basis = input.changePct ?? (((input.points[input.points.length - 1]?.price ?? input.currentPrice)
    - (input.points[0]?.price ?? input.currentPrice))
    / Math.max(0.01, input.points[0]?.price ?? input.currentPrice)) * 100;

  if (basis > 0.01) {
    return "up";
  }
  if (basis < -0.01) {
    return "down";
  }
  return "flat";
}

function resolveTheme(tone: AlertImageTone): AlertTheme {
  switch (tone) {
    case "breakthrough":
      return {
        accent: "#67F3AE",
        accentSoft: "#2AD97C",
        accentStrong: "#9CFFCB",
        panelBorder: "#2B7251",
        priceTagFill: "#155A3D",
        signalPillFill: "#163F2D",
        signalPillText: "#BDF6D8",
      };
    case "stop_loss":
      return {
        accent: "#FF7C7C",
        accentSoft: "#F55050",
        accentStrong: "#FFC6C6",
        panelBorder: "#7D3131",
        priceTagFill: "#672727",
        signalPillFill: "#471F1F",
        signalPillText: "#FFD4D4",
      };
    case "take_profit":
      return {
        accent: "#D19BFF",
        accentSoft: "#9D5CF2",
        accentStrong: "#E6CCFF",
        panelBorder: "#6B4398",
        priceTagFill: "#4D2F71",
        signalPillFill: "#38214F",
        signalPillText: "#EDD7FF",
      };
    case "pressure":
      return {
        accent: "#FFC56A",
        accentSoft: "#F19E2E",
        accentStrong: "#FFE0A6",
        panelBorder: "#8B6130",
        priceTagFill: "#62441F",
        signalPillFill: "#4A331A",
        signalPillText: "#FFE3B8",
      };
    default:
      return {
        accent: "#6AD4FF",
        accentSoft: "#2F8DFF",
        accentStrong: "#B7ECFF",
        panelBorder: "#285A8D",
        priceTagFill: "#1D4F81",
        signalPillFill: "#183957",
        signalPillText: "#D0F2FF",
      };
  }
}

function resolveDirectionTheme(direction: "up" | "down" | "flat"): DirectionTheme {
  switch (direction) {
    case "up":
      return {
        backgroundStart: "#33080D",
        backgroundMid: "#4C0F17",
        backgroundEnd: "#29070C",
        glowStrong: "#FF5D73",
        glowSoft: "#BD2E49",
        ribbon: "#FF6B81",
        frameStroke: "#FF7488",
        marketPillFill: "#5A1F2A",
        marketPillText: "#FFE3E7",
        marketLabel: "日内上涨",
        panelFill: "#1D0C10",
        chartPanelFill: "#271116",
        levelPanelFill: "#2B1218",
      };
    case "down":
      return {
        backgroundStart: "#0A2B19",
        backgroundMid: "#114124",
        backgroundEnd: "#082214",
        glowStrong: "#30F289",
        glowSoft: "#10A85A",
        ribbon: "#42F79C",
        frameStroke: "#49ED98",
        marketPillFill: "#195334",
        marketPillText: "#D9FFE9",
        marketLabel: "日内下跌",
        panelFill: "#071A10",
        chartPanelFill: "#0A2317",
        levelPanelFill: "#0C2519",
      };
    default:
      return {
        backgroundStart: "#081730",
        backgroundMid: "#0C2144",
        backgroundEnd: "#08162B",
        glowStrong: "#55AFFF",
        glowSoft: "#2767B1",
        ribbon: "#49A5FF",
        frameStroke: "#5EB0FF",
        marketPillFill: "#18456F",
        marketPillText: "#DBF1FF",
        marketLabel: "日内走平",
        panelFill: "#091427",
        chartPanelFill: "#0D1B35",
        levelPanelFill: "#0F203C",
      };
  }
}

function buildMetricLines(input: AlertImageInput): string[] {
  const parts = [
    `触发位 ${input.triggerPrice.toFixed(2)}`,
    input.changePct == null ? null : `当日 ${formatSignedPercent(input.changePct)}`,
    input.distancePct == null ? null : `偏离 ${formatSignedPercent(input.distancePct)}`,
    input.profitPct == null ? null : `持仓 ${formatSignedPercent(input.profitPct)}`,
  ].filter((value): value is string => Boolean(value));
  if (parts.length <= 2) {
    return [parts.join(" | ")];
  }
  return [parts.slice(0, 2).join(" | "), parts.slice(2).join(" | ")];
}

function buildLevelEntries(input: AlertImageInput): Array<{
  value: number;
  stroke: string;
  fill: string;
  text: string;
  width: number;
  dasharray: string;
  label: string;
}> {
  return [
    buildLevelEntry("止损", input.levels.stopLoss, "#FF6A6A", "rgba(92,30,35,0.94)", "#FFD3D3", 2.5, "6 6"),
    buildLevelEntry("支撑", input.levels.support, "#78C7FF", "rgba(27,69,110,0.94)", "#DDF4FF", 2.5, "6 6"),
    buildLevelEntry("压力", input.levels.resistance, "#FFCC66", "rgba(93,69,20,0.94)", "#FFF0C7", 2.5, "6 6"),
    buildLevelEntry("突破", input.levels.breakthrough, "#7EF0B2", "rgba(22,74,49,0.94)", "#D9FFE9", 2.5, "6 6"),
    buildLevelEntry("止盈", input.levels.takeProfit, "#D6A4FF", "rgba(76,43,117,0.94)", "#F1DFFF", 2.5, "6 6"),
  ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function buildLevelLines(
  entries: Array<{
    value: number;
    stroke: string;
    fill: string;
    text: string;
    width: number;
    dasharray: string;
    label: string;
  }>,
  scaleY: (value: number) => number,
): Array<{
  lineY: number;
  stroke: string;
  width: number;
  dasharray: string;
}> {
  return entries.map((entry) => ({
    lineY: scaleY(entry.value),
    stroke: entry.stroke,
    width: entry.width,
    dasharray: entry.dasharray,
  }));
}

function buildLevelEntry(
  label: string,
  value: number | null | undefined,
  stroke: string,
  fill: string,
  text: string,
  width: number,
  dasharray: string,
): {
  value: number;
  stroke: string;
  fill: string;
  text: string;
  width: number;
  dasharray: string;
  label: string;
} | null {
  if (!(value != null && Number.isFinite(value))) {
    return null;
  }
  return {
    value,
    stroke,
    fill,
    text,
    width,
    dasharray,
    label,
  };
}

function buildTimeMarkers(
  _points: AlertImagePoint[],
  scaleX: (timeLabel: string) => number,
): Array<{ x: number; label: string }> {
  const preferred = [
    { timeLabel: "09:30", label: "09:30" },
    { timeLabel: "10:30", label: "10:30" },
    { timeLabel: "11:30", label: "11:30/13:00" },
    { timeLabel: "14:00", label: "14:00" },
    { timeLabel: "15:00", label: "15:00" },
  ];
  return filterNearbyMarkers(
    preferred.map((marker) => ({
      x: scaleX(marker.timeLabel),
      label: marker.label,
    })),
    56,
  );
}

function buildRailMarkers(
  input: AlertImageInput,
  left: number,
  width: number,
  top: number,
  minValue: number,
  maxValue: number,
): Array<{ x: number; label: string; stroke: string; width: number; text: string; textY: number }> {
  const range = Math.max(0.01, maxValue - minValue);
  const rawMarkers = [
    { label: "止损", value: input.levels.stopLoss, stroke: "#FF7373", width: 5, text: "#FFCFCF" },
    { label: "支撑", value: input.levels.support, stroke: "#74CFFF", width: 5, text: "#DBF4FF" },
    { label: "现价", value: input.currentPrice, stroke: "#F7FBFF", width: 6, text: "#F7FBFF" },
    { label: "压力", value: input.levels.resistance, stroke: "#FFCC6D", width: 5, text: "#FFF0C7" },
    { label: "突破", value: input.levels.breakthrough, stroke: "#7DF2B4", width: 5, text: "#D8FFE8" },
    { label: "止盈", value: input.levels.takeProfit, stroke: "#D9ABFF", width: 5, text: "#F2E2FF" },
  ].filter((marker): marker is { label: string; value: number; stroke: string; width: number; text: string } => (
    marker.value != null && Number.isFinite(marker.value)
  ));
  const groupedMarkers = groupRailMarkers(rawMarkers).sort((leftMarker, rightMarker) => leftMarker.value - rightMarker.value);

  const lanes = [
    { y: top - 22, lastRight: -Infinity },
    { y: Math.min(HEIGHT - 16, top + 38), lastRight: -Infinity },
    { y: top - 46, lastRight: -Infinity },
  ];
  let previousX = -Infinity;
  return groupedMarkers.map((marker) => {
    const rawX = left + ((marker.value - minValue) / range) * width;
    const x = Math.max(previousX + 22, Math.min(left + width, rawX));
    const labelWidth = estimateRailLabelWidth(marker.label);
    const preferredLane = lanes.find((lane) => x - labelWidth / 2 >= lane.lastRight + 10)
      ?? lanes.reduce((best, lane) => (lane.lastRight < best.lastRight ? lane : best), lanes[0]!);
    preferredLane.lastRight = x + labelWidth / 2;
    previousX = x;
    return {
      x,
      label: marker.label,
      stroke: marker.stroke,
      width: marker.width,
      text: marker.text,
      textY: preferredLane.y,
    };
  });
}

function estimateRailLabelWidth(label: string): number {
  return label.length * 7 + 18;
}

function groupRailMarkers(
  markers: Array<{ label: string; value: number; stroke: string; width: number; text: string }>,
): Array<{ label: string; value: number; stroke: string; width: number; text: string }> {
  const groups = new Map<string, Array<{ label: string; value: number; stroke: string; width: number; text: string }>>();
  for (const marker of markers) {
    const key = marker.value.toFixed(4);
    const group = groups.get(key) ?? [];
    group.push(marker);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const label = `${group.map((item) => item.label).join("/")} ${group[0]!.value.toFixed(2)}`;
    if (group.length === 1) {
      return {
        label,
        value: group[0]!.value,
        stroke: group[0]!.stroke,
        width: group[0]!.width,
        text: group[0]!.text,
      };
    }
    return {
      label,
      value: group[0]!.value,
      stroke: "#F3F7FB",
      width: 6,
      text: "#F7FBFF",
    };
  });
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function filterNearbyMarkers(
  markers: Array<{ x: number; label: string }>,
  minGap: number,
): Array<{ x: number; label: string }> {
  const filtered: Array<{ x: number; label: string }> = [];
  let previousX = -Infinity;

  for (const marker of markers) {
    if (marker.x - previousX < minGap) {
      continue;
    }
    filtered.push(marker);
    previousX = marker.x;
  }

  return filtered;
}

function scaleTradingTime(timeLabel: string, left: number, width: number): number {
  const minutes = parseClockMinutes(timeLabel);
  if (minutes == null) {
    return left;
  }

  const clamped = clamp(minutes, MARKET_OPEN_MINUTES, MARKET_CLOSE_MINUTES);
  return left + (toTradingSessionMinutes(clamped) / MARKET_SESSION_MINUTES) * width;
}

function normalizeChartPoints(points: AlertImagePoint[]): AlertImagePoint[] {
  const normalized: AlertImagePoint[] = [];

  for (const point of points) {
    const previous = normalized[normalized.length - 1];
    if (previous && isSessionJoinPair(previous.time, point.time)) {
      normalized.push({
        time: point.time,
        price: previous.price,
      });
      continue;
    }

    normalized.push(point);
  }

  return normalized;
}

function parseClockMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toTradingSessionMinutes(minutes: number): number {
  if (minutes <= MORNING_CLOSE_MINUTES) {
    return minutes - MARKET_OPEN_MINUTES;
  }
  if (minutes < AFTERNOON_OPEN_MINUTES) {
    return MORNING_CLOSE_MINUTES - MARKET_OPEN_MINUTES;
  }
  return (
    (MORNING_CLOSE_MINUTES - MARKET_OPEN_MINUTES)
    + (minutes - AFTERNOON_OPEN_MINUTES)
  );
}

function isSessionJoinPair(previousTime: string, nextTime: string): boolean {
  return parseClockMinutes(previousTime) === MORNING_CLOSE_MINUTES
    && parseClockMinutes(nextTime) === AFTERNOON_OPEN_MINUTES;
}
