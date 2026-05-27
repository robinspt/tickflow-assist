import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DailyUpdateWorker } from "./daily-update.worker.js";
import { chinaToday } from "../utils/china-time.js";

test("runScheduledPreMarketBriefPass skips a repeated scheduled retry after the ready-window attempt already happened", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-daily-update-test-"));
  let readinessCalls = 0;
  let runCalls = 0;

  try {
    const today = chinaToday();
    await writeFile(
      path.join(tempRoot, "daily-update-state.json"),
      JSON.stringify({
        lastPreMarketAttemptDate: today,
        lastPreMarketAttemptAt: `${today} 09:25:00`,
      }),
      "utf-8",
    );

    const worker = createWorker(tempRoot, {
      async canRunPreMarketBrief() {
        readinessCalls += 1;
        return { ok: true, reason: "ready" };
      },
      async runPreMarketBrief() {
        runCalls += 1;
        return {
          resultType: "failed" as const,
          message: "⚠️ 开盘前资讯简报失败: test",
          sourceCount: 0,
          matchedWatchlistCount: 0,
        };
      },
    });

    await (worker as unknown as {
      runScheduledPreMarketBriefPass: () => Promise<void>;
    }).runScheduledPreMarketBriefPass();

    assert.equal(readinessCalls, 0);
    assert.equal(runCalls, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runScheduledPreMarketBriefPass still executes once when only a pre-ready skip was recorded earlier", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-daily-update-test-"));
  let readinessCalls = 0;
  let runCalls = 0;

  try {
    const today = chinaToday();
    await writeFile(
      path.join(tempRoot, "daily-update-state.json"),
      JSON.stringify({
        lastPreMarketAttemptDate: today,
        lastPreMarketAttemptAt: `${today} 09:10:00`,
      }),
      "utf-8",
    );

    const worker = createWorker(tempRoot, {
      async canRunPreMarketBrief() {
        readinessCalls += 1;
        return { ok: true, reason: "ready" };
      },
      async runPreMarketBrief() {
        runCalls += 1;
        return {
          resultType: "failed" as const,
          message: "⚠️ 开盘前资讯简报失败: test",
          sourceCount: 0,
          matchedWatchlistCount: 0,
        };
      },
    });

    await (worker as unknown as {
      runScheduledPreMarketBriefPass: () => Promise<void>;
    }).runScheduledPreMarketBriefPass();

    const state = JSON.parse(
      await readFile(path.join(tempRoot, "daily-update-state.json"), "utf-8"),
    ) as { lastPreMarketAttemptDate?: string; lastPreMarketResultType?: string | null };

    assert.equal(readinessCalls, 1);
    assert.equal(runCalls, 1);
    assert.equal(state.lastPreMarketAttemptDate, today);
    assert.equal(state.lastPreMarketResultType, "failed");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runScheduledUpdatePass records a waiting-time skip without updating or notifying", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-daily-update-test-"));
  let readinessCalls = 0;
  let updateCalls = 0;
  let alertCalls = 0;

  try {
    const today = chinaToday();
    const reason = "当前 13:55，须等到 15:25 后执行";
    const worker = createWorker(tempRoot, {
      notifyEnabled: true,
      async canRunDailyUpdate() {
        readinessCalls += 1;
        return { ok: false, reason };
      },
      async updateAll() {
        updateCalls += 1;
        return `🚫 ${reason}`;
      },
      async sendAlert() {
        alertCalls += 1;
      },
    });

    await (worker as unknown as {
      runScheduledUpdatePass: () => Promise<void>;
    }).runScheduledUpdatePass();

    const state = JSON.parse(
      await readFile(path.join(tempRoot, "daily-update-state.json"), "utf-8"),
    ) as {
      lastAttemptDate?: string;
      lastResultType?: string | null;
      lastResultSummary?: string | null;
      consecutiveFailures?: number;
    };

    assert.equal(readinessCalls, 1);
    assert.equal(updateCalls, 0);
    assert.equal(alertCalls, 0);
    assert.equal(state.lastAttemptDate, today);
    assert.equal(state.lastResultType, "skipped");
    assert.equal(state.lastResultSummary, reason);
    assert.equal(state.consecutiveFailures, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runScheduledUpdatePass records a non-trading-day skip without updating or notifying", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-daily-update-test-"));
  let updateCalls = 0;
  let alertCalls = 0;

  try {
    const today = chinaToday();
    const reason = `${today} 非交易日`;
    const worker = createWorker(tempRoot, {
      notifyEnabled: true,
      async canRunDailyUpdate() {
        return { ok: false, reason };
      },
      async updateAll() {
        updateCalls += 1;
        return `🚫 ${reason}`;
      },
      async sendAlert() {
        alertCalls += 1;
      },
    });

    await (worker as unknown as {
      runScheduledUpdatePass: () => Promise<void>;
    }).runScheduledUpdatePass();

    const state = JSON.parse(
      await readFile(path.join(tempRoot, "daily-update-state.json"), "utf-8"),
    ) as {
      lastResultType?: string | null;
      lastResultSummary?: string | null;
      consecutiveFailures?: number;
    };

    assert.equal(updateCalls, 0);
    assert.equal(alertCalls, 0);
    assert.equal(state.lastResultType, "skipped");
    assert.equal(state.lastResultSummary, reason);
    assert.equal(state.consecutiveFailures, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function createWorker(
  baseDir: string,
  overrides: {
    canRunPreMarketBrief?: () => Promise<{ ok: boolean; reason: string }>;
    runPreMarketBrief?: () => Promise<{
      resultType: "success" | "skipped" | "failed";
      message: string;
      sourceCount: number;
      matchedWatchlistCount: number;
    }>;
    canRunDailyUpdate?: () => Promise<{ ok: boolean; reason: string }>;
    updateAll?: (force?: boolean) => Promise<string>;
    sendAlert?: (message: string) => Promise<void>;
    notifyEnabled?: boolean;
  },
): DailyUpdateWorker {
  return new DailyUpdateWorker(
    {
      async updateAll(force?: boolean) {
        return overrides.updateAll?.(force) ?? "unused";
      },
    } as never,
    {
      async run() {
        return overrides.runPreMarketBrief?.() ?? {
          resultType: "skipped" as const,
          message: "unused",
          sourceCount: 0,
          matchedWatchlistCount: 0,
        };
      },
    } as never,
    null,
    {
      async canRunPreMarketBrief() {
        return overrides.canRunPreMarketBrief?.() ?? { ok: true, reason: "ready" };
      },
      async canRunDailyUpdate() {
        return overrides.canRunDailyUpdate?.() ?? { ok: true, reason: "ready" };
      },
    } as never,
    baseDir,
    {
      async send(message: string) {
        await overrides.sendAlert?.(message);
        return true;
      },
      formatSystemNotification(title: string, lines: string[]) {
        return [title, ...lines].join("\n");
      },
    } as never,
    overrides.notifyEnabled ?? false,
    "openclaw_plugin",
    60_000,
  );
}
