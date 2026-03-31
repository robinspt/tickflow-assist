import assert from "node:assert/strict";
import test from "node:test";

import { AlertService } from "./alert-service.js";

const alertService = new AlertService({
  openclawCliBin: "openclaw",
  channel: "telegram",
  account: "",
  target: "",
});

test("formatPriceAlert renders bold banner and level rail", () => {
  const message = alertService.formatPriceAlert({
    symbol: "002202.SZ",
    name: "金风科技",
    currentPrice: 26.99,
    ruleCode: "support_near",
    title: "触及支撑",
    ruleDescription: "价格接近支撑位，关注是否企稳",
    levelPrice: 27.05,
    costPrice: 30.57,
    dailyChangePct: -1.23,
    relatedLevels: {
      current_price: 26.99,
      stop_loss: 26.8,
      support: 27.05,
      resistance: 28.8,
      breakthrough: 28.8,
      take_profit: 29.5,
      analysis_text: "",
      score: 4,
    },
  });

  assert.match(message, /\*\*🟦【支撑观察】\*\*/);
  assert.match(message, /📍 信号：价格接近支撑位，关注是否企稳/);
  assert.match(message, /🧭 位阶图：⛔止损 26\.80 → 💹现价 26\.99 → 🛡️支撑 27\.05/);
  assert.match(message, /🚧压力\/🚀突破 28\.80/);
  assert.match(message, /💰 持仓盈亏：/);
});

test("formatVolumeAlert renders bold banner and level rail", () => {
  const message = alertService.formatVolumeAlert({
    symbol: "600343.SH",
    name: "航天动力",
    currentPrice: 34.81,
    currentVolume: 1_234_567,
    avgVolume: 234_567,
    ratio: 5.3,
    dailyChangePct: 6.84,
    relatedLevels: {
      current_price: 34.81,
      support: 32.5,
      resistance: 34.5,
      breakthrough: 35.2,
      take_profit: 36.1,
      analysis_text: "",
      score: 7,
    },
  });

  assert.match(message, /\*\*🟪【放量异动】\*\*/);
  assert.match(message, /📈 当前成交量 1,234,567 \| 📉 近5日均量 234567/);
  assert.match(message, /⚡ 量比 5\.3倍/);
  assert.match(message, /🧭 位阶图：🛡️支撑 32\.50 → 🚧压力 34\.50 → 💹现价 34\.81/);
});

test("buildCliArgs includes media path when sending image alerts", () => {
  const args = (alertService as unknown as {
    buildCliArgs: (input: { message: string; mediaPath: string }) => string[];
  }).buildCliArgs({
    message: "test",
    mediaPath: "/tmp/alert-card.png",
  });

  assert.deepEqual(args, [
    "openclaw",
    "message",
    "send",
    "--channel",
    "telegram",
    "--message",
    "test",
    "--media",
    "/tmp/alert-card.png",
  ]);
});
