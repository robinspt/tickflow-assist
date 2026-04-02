import assert from "node:assert/strict";
import test from "node:test";

import { renderAlertCardPng, renderAlertCardSvg } from "./alert-image-service.js";

const sampleInput = {
  tone: "support" as const,
  alertLabel: "支撑观察",
  name: "金风科技",
  symbol: "002202.SZ",
  timestampLabel: "Prototype | 2026-03-31 14:00",
  currentPrice: 26.99,
  triggerPrice: 27.05,
  changePct: -3.28,
  distancePct: -0.22,
  costPrice: 30.57,
  profitPct: -11.72,
  note: "价格接近支撑位，关注是否企稳。",
  points: [
    { time: "09:30", price: 27.42 },
    { time: "10:30", price: 27.66 },
    { time: "11:30", price: 27.21 },
    { time: "13:00", price: 27.28 },
    { time: "14:00", price: 27.06 },
    { time: "15:00", price: 26.99 },
  ],
  levels: {
    stopLoss: 26.8,
    support: 27.05,
    resistance: 28.8,
    breakthrough: 28.8,
    takeProfit: 29.5,
  },
};

test("renderAlertCardSvg contains primary sections", () => {
  const svg = renderAlertCardSvg(sampleInput);

  assert.match(svg, /^<\?xml/);
  assert.match(svg, /支撑观察/);
  assert.match(svg, /金风科技/);
  assert.match(svg, /日内下跌/);
  assert.match(svg, /关键价位/);
  assert.match(svg, /位阶带/);
  assert.match(svg, /压力\/突破 28\.80/);
  assert.match(svg, /现价 26\.99/);
});

test("renderAlertCardSvg switches market background label by direction", () => {
  const svg = renderAlertCardSvg({
    ...sampleInput,
    tone: "breakthrough",
    alertLabel: "突破确认",
    changePct: 4.21,
    points: [
      { time: "09:30", price: 30.2 },
      { time: "10:30", price: 30.6 },
      { time: "11:30", price: 30.88 },
      { time: "13:00", price: 31.12 },
      { time: "14:00", price: 31.66 },
      { time: "15:00", price: 31.88 },
    ],
    currentPrice: 31.88,
    triggerPrice: 31.88,
    note: "价格已突破关键压力位。",
    levels: {
      stopLoss: 30.9,
      support: 31.2,
      resistance: 31.88,
      breakthrough: 31.88,
      takeProfit: 33.2,
    },
  });

  assert.match(svg, /日内上涨/);
});

test("renderAlertCardPng returns png bytes", async () => {
  const buffer = await renderAlertCardPng(sampleInput);

  assert.ok(buffer.length > 0);
  assert.equal(buffer[0], 0x89);
  assert.equal(buffer[1], 0x50);
  assert.equal(buffer[2], 0x4e);
  assert.equal(buffer[3], 0x47);
});

test("renderAlertCardSvg keeps the x-axis fixed to 15:00 for partial-day previews", () => {
  const svg = renderAlertCardSvg({
    ...sampleInput,
    timestampLabel: "Prototype | 2026-03-31 14:12",
    points: [
      { time: "09:30", price: 27.42 },
      { time: "10:30", price: 27.66 },
      { time: "11:30", price: 27.21 },
      { time: "13:00", price: 27.28 },
      { time: "14:00", price: 27.06 },
      { time: "14:12", price: 26.99 },
    ],
  });

  assert.match(svg, />15:00</);
  assert.match(svg, />11:30\/13:00</);

  const currentDot = svg.match(/<circle cx="([0-9.]+)" cy="([0-9.]+)" r="7"/);
  assert.ok(currentDot, "current point marker should exist");
  assert.ok(Number(currentDot[1]) < 694, "partial-day point should not extend to the 15:00 edge");
});
