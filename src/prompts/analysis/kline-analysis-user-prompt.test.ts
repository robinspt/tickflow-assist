import assert from "node:assert/strict";
import test from "node:test";

import { buildKlineAnalysisUserPrompt } from "./kline-analysis-user-prompt.js";

test("buildKlineAnalysisUserPrompt renders TickFlow change_pct as percentage", () => {
  const prompt = buildKlineAnalysisUserPrompt({
    symbol: "002558.SZ",
    costPrice: 32.81,
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
  });

  assert.match(prompt, /- 涨跌幅: 3\.81%/);
});
