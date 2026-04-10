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

function createWorker(
  baseDir: string,
  overrides: {
    canRunPreMarketBrief: () => Promise<{ ok: boolean; reason: string }>;
    runPreMarketBrief: () => Promise<{
      resultType: "success" | "skipped" | "failed";
      message: string;
      sourceCount: number;
      matchedWatchlistCount: number;
    }>;
  },
): DailyUpdateWorker {
  return new DailyUpdateWorker(
    {
      async updateAll() {
        return "unused";
      },
    } as never,
    {
      run: overrides.runPreMarketBrief,
    } as never,
    null,
    {
      canRunPreMarketBrief: overrides.canRunPreMarketBrief,
    } as never,
    baseDir,
    {
      async send() {
        return true;
      },
      formatSystemNotification(title: string, lines: string[]) {
        return [title, ...lines].join("\n");
      },
    } as never,
    false,
    "openclaw_plugin",
    60_000,
  );
}
