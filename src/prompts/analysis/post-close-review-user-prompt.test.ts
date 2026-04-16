import assert from "node:assert/strict";
import test from "node:test";

import type { PostCloseReviewInput } from "../../analysis/types/composite-analysis.js";
import { buildPostCloseReviewUserPrompt } from "./post-close-review-user-prompt.js";

test("buildPostCloseReviewUserPrompt renders TickFlow change_pct as percentage", () => {
  const input: PostCloseReviewInput = {
    market: {
      symbol: "002558.SZ",
      companyName: "巨人网络",
      watchlistItem: {
        symbol: "002558.SZ",
        name: "巨人网络",
        costPrice: 32.81,
        addedAt: "2026-04-15 09:30:00",
        sector: "游戏",
        themes: ["AI应用"],
        themeQuery: "游戏 AI应用",
        themeUpdatedAt: "2026-04-15 19:00:00",
      },
      klines: [
        {
          symbol: "002558.SZ",
          trade_date: "2026-04-16",
          timestamp: 1_776_297_600,
          open: 32.3,
          high: 33.5,
          low: 32.1,
          close: 33.27,
          volume: 100,
          amount: 100,
          prev_close: 32.05,
        },
      ],
      indicators: [],
      intradayKlines: [],
      intradayIndicators: [],
      realtimeQuote: {
        symbol: "002558.SZ",
        name: "巨人网络",
        last_price: 33.27,
        prev_close: 32.05,
        timestamp: 1_776_297_600,
        ext: {
          change_pct: 0.03807,
        },
      },
      reviewMemory: {
        available: false,
        summary: "暂无复盘记忆。",
        asOf: null,
      },
      marketOverview: {
        available: true,
        bias: "neutral",
        summary: "大盘整体震荡。",
        indices: [],
      },
    },
    financial: {
      symbol: "002558.SZ",
      companyName: "巨人网络",
      mode: "none",
      source: "none",
      snapshot: null,
      liteSnapshot: null,
      available: false,
      note: null,
    },
    news: {
      symbol: "002558.SZ",
      companyName: "巨人网络",
      query: "巨人网络",
      documents: [],
      available: false,
      boardQuery: null,
      boardDocuments: [],
      boardAvailable: false,
    },
    technicalResult: {
      analysisText: "",
      levels: null,
    },
    financialResult: {
      analysisText: "",
      score: null,
      bias: "neutral",
      strengths: [],
      risks: [],
      watchItems: [],
    },
    newsResult: {
      analysisText: "",
      score: null,
      bias: "neutral",
      catalysts: [],
      risks: [],
      watchItems: [],
    },
    compositeResult: {
      analysisText: "",
      levels: null,
    },
    validation: {
      available: false,
      snapshotDate: null,
      evaluatedTradeDate: "2026-04-16",
      verdict: "unavailable",
      snapshot: null,
      summary: "暂无昨日关键位。",
      lines: [],
    },
    flashContext: {
      stockAlerts: [],
      marketOverviewFlashes: [],
    },
    peerContext: {
      available: false,
      summary: "暂无同业数据。",
      sw1Name: null,
      sw2Name: null,
      sw3Name: null,
      sw3UniverseId: null,
      peerCount: 0,
      otherStockCount: 0,
      advanceCount: 0,
      declineCount: 0,
      flatCount: 0,
      averageChangePct: null,
      medianChangePct: null,
      targetChangePct: null,
      targetRank: null,
      targetPercentile: null,
      leaders: [],
      laggards: [],
      note: null,
    },
  };

  const prompt = buildPostCloseReviewUserPrompt(input);
  assert.match(prompt, /当日涨跌幅: \+3\.81%/);
});
