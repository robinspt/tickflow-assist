import assert from "node:assert/strict";
import test from "node:test";

import type {
  IndustryPeerContext,
  PostCloseReviewResult,
  PriorKeyLevelValidationContext,
} from "../analysis/types/composite-analysis.js";
import type { WatchlistItem } from "../types/domain.js";
import { formatPostCloseReviewDetailMessage } from "./post-close-review-service.js";

test("formatPostCloseReviewDetailMessage renders bold section titles and level rail", () => {
  const item: WatchlistItem = {
    symbol: "002202.SZ",
    name: "金风科技",
    costPrice: 30.57,
    addedAt: "2026-03-20 10:00:00",
    sector: "风电设备",
    themes: ["抽水蓄能"],
    themeQuery: "风电设备 抽水蓄能",
    themeUpdatedAt: "2026-03-30 18:00:00",
  };

  const validation: PriorKeyLevelValidationContext = {
    available: true,
    snapshotDate: "2026-03-27",
    evaluatedTradeDate: "2026-03-30",
    verdict: "mixed",
    snapshot: null,
    summary: "昨日关键位效果偏混合。",
    lines: [
      "快照日期 2026-03-27，验证交易日 2026-03-30。",
      "当日K线: 高 28.36 | 低 27.46 | 收 27.72",
      "支撑 27.05: 当日未触达。",
    ],
  };

  const review: PostCloseReviewResult = {
    analysisText: "",
    decision: "keep",
    decisionReason: "今日运行区间仍在原关键位框架内，结构未变。",
    sessionSummary: "股价日内冲高回落，继续受 28.8 元附近压力压制。",
    marketSectorSummary: "大盘整体中性，但板块偏弱，对个股形成一定逆风。",
    newsSummary: "盘后公告偏常规，未形成新的短线催化。",
    actionAdvice: "继续观察 27.05 支撑是否守住，未突破前不宜追价。",
    marketBias: "neutral",
    sectorBias: "headwind",
    newsImpact: "neutral",
    levels: {
      current_price: 27.72,
      support: 27.05,
      resistance: 28.8,
      breakthrough: 28.8,
      stop_loss: 26.8,
      take_profit: 29.5,
      analysis_text: "",
      score: 4,
    },
  };

  const peerContext: IndustryPeerContext = {
    available: true,
    summary: "申万3级风电设备共 8 只；除本股外上涨 5 / 下跌 2 / 平 0；均值 +1.42%；中位数 +1.11%；本股 +2.97%，位列 2/8",
    sw1Name: "电力设备",
    sw2Name: "风电设备",
    sw3Name: "风机零部件",
    sw3UniverseId: "sw3-demo",
    peerCount: 8,
    otherStockCount: 7,
    advanceCount: 5,
    declineCount: 2,
    flatCount: 0,
    averageChangePct: 1.42,
    medianChangePct: 1.11,
    targetChangePct: 2.97,
    targetRank: 2,
    targetPercentile: 0.8571428571428572,
    leaders: [],
    laggards: [],
    note: null,
  };

  const message = formatPostCloseReviewDetailMessage(item, validation, review, {
    latestClose: 27.72,
    dailyChangePct: 2.97,
  }, peerContext);

  assert.match(message, /\*\*📘 收盘复盘｜金风科技（002202\.SZ）\*\*/);
  assert.match(message, /🟨 昨日验证：效果偏混合 \| 🟩 明日处理：沿用/);
  assert.match(message, /• 收盘 27\.72 \| 当日 \+2\.97% \| 成本 30\.57/);
  assert.match(message, /• 风向：大盘 🟨中性 \| 板块 🟥逆风 \| 同业 领涨区（2\/8）/);
  assert.match(message, /\*\*【📍 昨日关键位验证】\*\*/);
  assert.match(message, /\*\*【🎯 更新后关键位】\*\*/);
  assert.match(message, /价位框架：⛔止损 26\.80 → 🛡️支撑 27\.05 → 💹现价 27\.72 → 🚧压力\/🚀突破 28\.80 → 🎯止盈 29\.50/);
});
