import assert from "node:assert/strict";
import test from "node:test";

import { chinaHour, chinaToday, formatChinaDateTime } from "./china-time.js";

test("formatChinaDateTime formats an instant in China time independent of host timezone", () => {
  const instant = new Date("2026-04-17T01:32:00.000Z");

  assert.equal(formatChinaDateTime(instant), "2026-04-17 09:32:00");
  assert.equal(chinaToday(instant), "2026-04-17");
  assert.equal(chinaHour(instant), 9);
});

test("chinaToday rolls over at China midnight", () => {
  assert.equal(chinaToday(new Date("2026-04-16T15:59:59.000Z")), "2026-04-16");
  assert.equal(chinaToday(new Date("2026-04-16T16:00:00.000Z")), "2026-04-17");
});
