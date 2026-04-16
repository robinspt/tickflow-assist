import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTickFlowChangePct, resolveTickFlowQuoteChangePct } from "./tickflow-quote.js";

test("normalizeTickFlowChangePct converts TickFlow ratio to percentage", () => {
  assert.equal(normalizeTickFlowChangePct(0.03807), 3.807);
});

test("resolveTickFlowQuoteChangePct falls back to price delta when ext.change_pct is missing", () => {
  const changePct = resolveTickFlowQuoteChangePct({
    symbol: "002558.SZ",
    last_price: 33.27,
    prev_close: 32.05,
    timestamp: 1_713_273_600,
  });

  assert.ok(changePct != null);
  assert.ok(Math.abs(changePct - 3.8065522620904875) < 1e-9);
});
