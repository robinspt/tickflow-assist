import assert from "node:assert/strict";
import { access, mkdtemp, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AlertMediaService } from "./alert-media-service.js";

const sampleImage = {
  tone: "support" as const,
  alertLabel: "支撑观察",
  name: "金风科技",
  symbol: "002202.SZ",
  timestampLabel: "2026-03-31 14:00",
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

test("AlertMediaService writes png files under alert-media tmp root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-alert-media-"));
  const service = new AlertMediaService(path.join(tempRoot, "lancedb"));

  try {
    const result = await service.writeAlertCard({
      symbol: "002202.SZ",
      ruleName: "support_near",
      image: sampleImage,
    });

    assert.match(result.filePath, /alert-media\/tmp\//);
    await access(result.filePath);
    assert.equal(result.filename.endsWith(".png"), true);
    assert.deepEqual(result.mediaLocalRoots, [path.dirname(result.filePath)]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("AlertMediaService removes expired temp files during cleanup", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-alert-media-"));
  const service = new AlertMediaService(path.join(tempRoot, "lancedb"), 24, 0);

  try {
    const result = await service.writeAlertCard({
      symbol: "002202.SZ",
      ruleName: "support_near",
      image: sampleImage,
    });

    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(result.filePath, oldDate, oldDate);
    await service.maybeCleanupExpired(Date.now());

    await assert.rejects(access(result.filePath));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("AlertMediaService can write png files under a custom temp root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-alert-media-"));
  const customTempRoot = path.join(tempRoot, "system-tmp", "alert-media", "tmp");
  const service = new AlertMediaService(
    path.join(tempRoot, "lancedb"),
    24,
    60 * 60 * 1000,
    customTempRoot,
  );

  try {
    const result = await service.writeAlertCard({
      symbol: "000001.SZ",
      ruleName: "test_alert",
      image: sampleImage,
    });

    assert.equal(result.filePath.startsWith(customTempRoot), true);
    await access(result.filePath);
    assert.deepEqual(result.mediaLocalRoots, [path.dirname(result.filePath)]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
