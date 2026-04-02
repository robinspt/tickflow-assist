import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderAlertCardPng, renderAlertCardSvg, type AlertImagePoint } from "../services/alert-image-service.js";

async function main(): Promise<void> {
  const outputDir = path.resolve("data/alerts/demo");
  await mkdir(outputDir, { recursive: true });

  const outputs = await Promise.all([
    writeDemoCard(outputDir, {
      fileStem: "support-alert-demo",
      input: buildSupportDemoInput(),
    }),
    writeDemoCard(outputDir, {
      fileStem: "breakthrough-alert-demo",
      input: buildBreakthroughDemoInput(),
    }),
    writeDemoCard(outputDir, {
      fileStem: "test-alert-preview",
      input: buildTestAlertPreviewInput(),
    }),
  ]);

  console.log([
    "✅ 告警小图原型已生成",
    ...outputs.flatMap((item) => [
      `PNG: ${item.pngPath}`,
      `SVG: ${item.svgPath}`,
      `尺寸: ${item.sizeLabel}`,
    ]),
  ].join("\n"));
}

async function writeDemoCard(
  outputDir: string,
  payload: {
    fileStem: string;
    input: Parameters<typeof renderAlertCardSvg>[0];
  },
): Promise<{ pngPath: string; svgPath: string; sizeLabel: string }> {
  const png = await renderAlertCardPng(payload.input);
  const svg = renderAlertCardSvg(payload.input);
  const pngPath = path.join(outputDir, `${payload.fileStem}.png`);
  const svgPath = path.join(outputDir, `${payload.fileStem}.svg`);

  await writeFile(pngPath, png);
  await writeFile(svgPath, svg, "utf-8");

  return {
    pngPath,
    svgPath,
    sizeLabel: `${payload.fileStem} ${png.length.toLocaleString("en-US")} bytes`,
  };
}

function buildSupportDemoInput() {
  const points = buildSupportDemoSeries();
  const currentPrice = points[points.length - 1]?.price ?? 26.99;
  const triggerPrice = 27.05;
  const costPrice = 30.57;
  const changePct = -3.28;
  const distancePct = ((currentPrice - triggerPrice) / triggerPrice) * 100;
  const profitPct = ((currentPrice - costPrice) / costPrice) * 100;

  return {
    tone: "support" as const,
    alertLabel: "支撑观察",
    name: "金风科技",
    symbol: "002202.SZ",
    timestampLabel: "Prototype | 2026-03-31 14:00",
    currentPrice,
    triggerPrice,
    changePct,
    distancePct,
    costPrice,
    profitPct,
    note: "价格接近支撑位，关注是否企稳，若放量跌破则切换为止损执行。",
    points,
    levels: {
      stopLoss: 26.8,
      support: 27.05,
      resistance: 28.8,
      breakthrough: 28.8,
      takeProfit: 29.5,
    },
  };
}

function buildBreakthroughDemoInput() {
  const points = buildBreakthroughDemoSeries();
  const currentPrice = points[points.length - 1]?.price ?? 31.88;
  const triggerPrice = 31.88;
  const costPrice = 22.6;
  const changePct = 6.84;
  const distancePct = ((currentPrice - triggerPrice) / triggerPrice) * 100;
  const profitPct = ((currentPrice - costPrice) / costPrice) * 100;

  return {
    tone: "breakthrough" as const,
    alertLabel: "突破确认",
    name: "巨人网络",
    symbol: "002558.SZ",
    timestampLabel: "Prototype | 2026-03-31 14:00",
    currentPrice,
    triggerPrice,
    changePct,
    distancePct,
    costPrice,
    profitPct,
    note: "价格已突破关键压力位，若回踩不破可视为突破确认。",
    points,
    levels: {
      stopLoss: 30.9,
      support: 31.2,
      resistance: 31.88,
      breakthrough: 31.88,
      takeProfit: 33.2,
    },
  };
}

function buildTestAlertPreviewInput() {
  const triggerPrice = 12.18;
  const currentPrice = 12.36;
  const costPrice = 11.92;
  const distancePct = ((currentPrice - triggerPrice) / triggerPrice) * 100;
  const profitPct = ((currentPrice - costPrice) / costPrice) * 100;

  return {
    tone: "breakthrough" as const,
    alertLabel: "测试告警",
    name: "平安银行",
    symbol: "000001.SZ",
    timestampLabel: "Prototype | 2026-04-02 14:12",
    currentPrice,
    triggerPrice,
    changePct: 2.15,
    distancePct,
    costPrice,
    profitPct,
    note: "预览固定收盘时间轴：未到 15:00 时，走势线不会铺满整张日内图。",
    points: [
      { time: "09:30", price: 12.02 },
      { time: "10:00", price: 12.08 },
      { time: "10:30", price: 12.12 },
      { time: "11:30", price: 12.15 },
      { time: "13:00", price: 12.19 },
      { time: "13:30", price: 12.23 },
      { time: "14:00", price: 12.27 },
      { time: "14:12", price: currentPrice },
    ],
    levels: {
      stopLoss: 11.86,
      support: 12.08,
      resistance: 12.30,
      breakthrough: triggerPrice,
      takeProfit: 12.68,
    },
  };
}

function buildSupportDemoSeries(): AlertImagePoint[] {
  const times = buildTradingMinuteLabels("14:00");
  return times.map((time, index) => ({
    time,
    price: Number(priceAtIndex(index, times.length).toFixed(2)),
  }));
}

function buildBreakthroughDemoSeries(): AlertImagePoint[] {
  const times = buildTradingMinuteLabels("14:00");
  return times.map((time, index) => ({
    time,
    price: Number(breakthroughPriceAtIndex(index, times.length).toFixed(2)),
  }));
}

function buildTradingMinuteLabels(endTime = "15:00"): string[] {
  const labels: string[] = [];
  for (let hour = 9; hour <= 11; hour += 1) {
    for (let minute = 0; minute < 60; minute += 1) {
      if (hour === 9 && minute < 30) {
        continue;
      }
      if (hour === 11 && minute > 30) {
        continue;
      }
      labels.push(`${pad2(hour)}:${pad2(minute)}`);
    }
  }
  for (let hour = 13; hour <= 15; hour += 1) {
    for (let minute = 0; minute < 60; minute += 1) {
      if (hour === 15 && minute > 0) {
        continue;
      }
      const label = `${pad2(hour)}:${pad2(minute)}`;
      labels.push(label);
      if (label === endTime) {
        return labels;
      }
    }
  }
  return labels;
}

function priceAtIndex(index: number, total: number): number {
  const t = index / Math.max(1, total - 1);

  if (t < 0.16) {
    return lerp(27.42, 27.78, t / 0.16) + Math.sin(t * 45) * 0.04;
  }
  if (t < 0.42) {
    return lerp(27.78, 27.22, (t - 0.16) / 0.26) + Math.sin(t * 36) * 0.03;
  }
  if (t < 0.58) {
    return lerp(27.22, 27.34, (t - 0.42) / 0.16) + Math.sin(t * 28) * 0.02;
  }
  if (t < 0.8) {
    return lerp(27.34, 27.02, (t - 0.58) / 0.22) + Math.sin(t * 31) * 0.03;
  }
  if (t < 0.92) {
    return lerp(27.02, 26.94, (t - 0.8) / 0.12) + Math.sin(t * 42) * 0.02;
  }
  return lerp(26.94, 26.99, (t - 0.92) / 0.08) + Math.sin(t * 60) * 0.01;
}

function breakthroughPriceAtIndex(index: number, total: number): number {
  const t = index / Math.max(1, total - 1);

  if (t < 0.12) {
    return lerp(29.82, 30.16, t / 0.12) + Math.sin(t * 46) * 0.05;
  }
  if (t < 0.36) {
    return lerp(30.16, 30.04, (t - 0.12) / 0.24) + Math.sin(t * 34) * 0.04;
  }
  if (t < 0.62) {
    return lerp(30.04, 30.96, (t - 0.36) / 0.26) + Math.sin(t * 30) * 0.05;
  }
  if (t < 0.84) {
    return lerp(30.96, 31.72, (t - 0.62) / 0.22) + Math.sin(t * 26) * 0.04;
  }
  if (t < 0.94) {
    return lerp(31.72, 31.98, (t - 0.84) / 0.1) + Math.sin(t * 36) * 0.03;
  }
  return lerp(31.98, 31.88, (t - 0.94) / 0.06) + Math.sin(t * 58) * 0.02;
}

function lerp(from: number, to: number, ratio: number): number {
  return from + (to - from) * ratio;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
