import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Jin10FlashMonitorService } from "./jin10-flash-monitor-service.js";
import { formatChinaDateTime } from "../utils/china-time.js";
import type { WatchlistItem } from "../types/domain.js";
import type { FlashMonitorState } from "../types/flash-monitor.js";
import type { Jin10FlashDeliveryEntry, Jin10FlashPage, Jin10FlashRecord } from "../types/jin10.js";

const watchlistItem: WatchlistItem = {
  symbol: "000001.SZ",
  name: "平安银行",
  costPrice: 10.8,
  addedAt: "2026-04-01 09:30:00",
  sector: null,
  themes: [],
  themeQuery: null,
  themeUpdatedAt: null,
};

test("runMonitorOnce stores backfill flashes without alerting historical pages", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-jin10-test-"));
  const savedKeys: string[][] = [];
  const deliveredKeys: string[] = [];
  const sentMessages: string[] = [];
  const now = Date.now();
  const anchorUrl = "https://flash.example/anchor";
  const freshUrl = "https://flash.example/fresh";
  const oldUrl = "https://flash.example/yesterday";

  try {
    await seedFlashMonitorState(tempRoot, {
      initialized: true,
      lastSeenKey: anchorUrl,
      lastSeenPublishedAt: formatChinaDateTime(new Date(now - 2 * 60 * 1000)),
      lastSeenUrl: anchorUrl,
      backfillCursor: "cursor-yesterday",
      lastPollAt: formatChinaDateTime(new Date(now - 2 * 60 * 1000)),
    });

    const service = createFlashMonitorService(tempRoot, {
      pollIntervalSeconds: 300,
      jin10McpService: {
        async listFlash(cursor?: string): Promise<Jin10FlashPage> {
          if (!cursor) {
            return {
              hasMore: false,
              nextCursor: null,
              items: [
                makeFlashItem("平安银行获得新订单", new Date(now - 60 * 1000), freshUrl),
                makeFlashItem("历史锚点", new Date(now - 2 * 60 * 1000), anchorUrl),
              ],
            };
          }

          assert.equal(cursor, "cursor-yesterday");
          return {
            hasMore: false,
            nextCursor: null,
            items: [
              makeFlashItem("平安银行昨日公告落地", new Date(now - 24 * 60 * 60 * 1000), oldUrl),
            ],
          };
        },
      },
      flashRepository: {
        async saveAll(entries: Jin10FlashRecord[]) {
          savedKeys.push(entries.map((entry) => entry.flash_key));
          return {
            added: entries.length,
            skipped: 0,
            addedKeys: entries.map((entry) => entry.flash_key),
          };
        },
      },
      flashDeliveryRepository: {
        async hasDelivered() {
          return false;
        },
        async append(entry: Jin10FlashDeliveryEntry) {
          deliveredKeys.push(entry.flash_key);
        },
      },
      alertService: {
        async sendWithResult(message: string | { message: string }) {
          sentMessages.push(typeof message === "string" ? message : message.message);
          return {
            ok: true,
            mediaAttempted: false,
            mediaDelivered: false,
            error: null,
          };
        },
      },
    });

    const alertCount = await service.runMonitorOnce();

    assert.equal(alertCount, 1);
    assert.deepEqual(savedKeys, [[oldUrl, freshUrl]]);
    assert.deepEqual(deliveredKeys, [freshUrl]);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0] ?? "", /平安银行获得新订单/);
    assert.doesNotMatch(sentMessages[0] ?? "", /昨日公告/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runMonitorOnce skips stale flashes that are older than the poll window", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-jin10-test-"));
  const deliveredKeys: string[] = [];
  const sentMessages: string[] = [];
  const savedKeys: string[][] = [];
  const now = Date.now();
  const anchorUrl = "https://flash.example/anchor";
  const staleUrl = "https://flash.example/stale";

  try {
    await seedFlashMonitorState(tempRoot, {
      initialized: true,
      lastSeenKey: anchorUrl,
      lastSeenPublishedAt: formatChinaDateTime(new Date(now - 20 * 60 * 1000)),
      lastSeenUrl: anchorUrl,
      lastPollAt: formatChinaDateTime(new Date(now - 12 * 60 * 60 * 1000)),
    });

    const service = createFlashMonitorService(tempRoot, {
      pollIntervalSeconds: 300,
      jin10McpService: {
        async listFlash(): Promise<Jin10FlashPage> {
          return {
            hasMore: false,
            nextCursor: null,
            items: [
              makeFlashItem("平安银行出现旧快讯", new Date(now - 10 * 60 * 1000), staleUrl),
              makeFlashItem("历史锚点", new Date(now - 20 * 60 * 1000), anchorUrl),
            ],
          };
        },
      },
      flashRepository: {
        async saveAll(entries: Jin10FlashRecord[]) {
          savedKeys.push(entries.map((entry) => entry.flash_key));
          return {
            added: entries.length,
            skipped: 0,
            addedKeys: entries.map((entry) => entry.flash_key),
          };
        },
      },
      flashDeliveryRepository: {
        async hasDelivered() {
          return false;
        },
        async append(entry: Jin10FlashDeliveryEntry) {
          deliveredKeys.push(entry.flash_key);
        },
      },
      alertService: {
        async sendWithResult(message: string | { message: string }) {
          sentMessages.push(typeof message === "string" ? message : message.message);
          return {
            ok: true,
            mediaAttempted: false,
            mediaDelivered: false,
            error: null,
          };
        },
      },
    });

    const alertCount = await service.runMonitorOnce();

    assert.equal(alertCount, 0);
    assert.deepEqual(savedKeys, [[staleUrl]]);
    assert.deepEqual(deliveredKeys, []);
    assert.deepEqual(sentMessages, []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function createFlashMonitorService(
  baseDir: string,
  overrides: {
    pollIntervalSeconds?: number;
    watchlistService?: Partial<{ list(): Promise<WatchlistItem[]> }>;
    jin10McpService?: Partial<{
      isConfigured(): boolean;
      getConfigurationError(): string | null;
      listFlash(cursor?: string): Promise<Jin10FlashPage>;
    }>;
    analysisService?: Partial<{
      isConfigured(): boolean;
      generateText(systemPrompt: string, userPrompt: string, options: Record<string, unknown>): Promise<string>;
    }>;
    alertService?: Partial<{
      formatSystemNotification(title: string, lines: string[]): string;
      sendWithResult(input: string | { message: string }): Promise<{
        ok: boolean;
        mediaAttempted: boolean;
        mediaDelivered: boolean;
        error: string | null;
      }>;
    }>;
    flashRepository?: Partial<{
      getLatest(): Promise<Jin10FlashRecord | null>;
      saveAll(entries: Jin10FlashRecord[]): Promise<{ added: number; skipped: number; addedKeys: string[] }>;
      countSincePublishedTs(publishedTs: number): Promise<number>;
      pruneOlderThanPublishedTs(publishedTs: number): Promise<void>;
    }>;
    flashDeliveryRepository?: Partial<{
      hasDelivered(flashKey: string): Promise<boolean>;
      append(entry: Jin10FlashDeliveryEntry): Promise<void>;
      countSinceDeliveredAt(deliveredAt: string): Promise<number>;
      pruneOlderThanDeliveredAt(deliveredAt: string): Promise<void>;
    }>;
  } = {},
): Jin10FlashMonitorService {
  return new Jin10FlashMonitorService(
    baseDir,
    overrides.pollIntervalSeconds ?? 300,
    7,
    true,
    {
      async list() {
        return [watchlistItem];
      },
      ...overrides.watchlistService,
    } as never,
    {
      isConfigured() {
        return true;
      },
      getConfigurationError() {
        return null;
      },
      async listFlash() {
        return {
          hasMore: false,
          items: [],
          nextCursor: null,
        };
      },
      ...overrides.jin10McpService,
    } as never,
    {
      isConfigured() {
        return false;
      },
      async generateText() {
        return "";
      },
      ...overrides.analysisService,
    } as never,
    {
      formatSystemNotification(title: string, lines: string[]) {
        return [title, lines.join("\n")].join("\n\n");
      },
      async sendWithResult() {
        return {
          ok: true,
          mediaAttempted: false,
          mediaDelivered: false,
          error: null,
        };
      },
      ...overrides.alertService,
    } as never,
    {
      async getLatest() {
        return null;
      },
      async saveAll(entries: Jin10FlashRecord[]) {
        return {
          added: entries.length,
          skipped: 0,
          addedKeys: entries.map((entry) => entry.flash_key),
        };
      },
      async countSincePublishedTs() {
        return 0;
      },
      async pruneOlderThanPublishedTs() {},
      ...overrides.flashRepository,
    } as never,
    {
      async hasDelivered() {
        return false;
      },
      async append() {},
      async countSinceDeliveredAt() {
        return 0;
      },
      async pruneOlderThanDeliveredAt() {},
      ...overrides.flashDeliveryRepository,
    } as never,
  );
}

async function seedFlashMonitorState(baseDir: string, state: Partial<FlashMonitorState>): Promise<void> {
  await writeFile(
    path.join(baseDir, "jin10-flash-monitor-state.json"),
    JSON.stringify(state, null, 2),
    "utf-8",
  );
}

function makeFlashItem(content: string, time: Date, url: string) {
  return {
    content,
    time: time.toISOString(),
    url,
    raw: {},
  };
}
