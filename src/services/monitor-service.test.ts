import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { mock } from "node:test";

import { MonitorService } from "./monitor-service.js";
import { formatChinaDateTime } from "../utils/china-time.js";
import type { KeyLevels, WatchlistItem } from "../types/domain.js";
import type { TickFlowIntradayKlineRow, TickFlowQuote } from "../types/tickflow.js";

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

const intradayRows: TickFlowIntradayKlineRow[] = [
  {
    symbol: "000001.SZ",
    period: "1m",
    trade_date: formatChinaDateTime().slice(0, 10),
    trade_time: "09:30:00",
    timestamp: 1,
    open: 10.2,
    high: 10.2,
    low: 10.0,
    close: 10.1,
    volume: 1000,
    amount: 10_000,
    prev_close: 10.4,
    open_interest: null,
    settlement_price: null,
  },
  {
    symbol: "000001.SZ",
    period: "1m",
    trade_date: formatChinaDateTime().slice(0, 10),
    trade_time: "09:31:00",
    timestamp: 2,
    open: 10.1,
    high: 10.1,
    low: 9.9,
    close: 10.0,
    volume: 1200,
    amount: 12_000,
    prev_close: 10.4,
    open_interest: null,
    settlement_price: null,
  },
];

const baseLevels: KeyLevels = {
  current_price: 10.0,
  stop_loss: 10.05,
  support: 10.0,
  resistance: 10.7,
  breakthrough: 10.8,
  take_profit: 11.2,
  analysis_text: "",
  score: 6,
};

const quoteAtSupport: TickFlowQuote = {
  symbol: "000001.SZ",
  last_price: 10.0,
  prev_close: 10.4,
  timestamp: Date.now(),
  volume: 50_000,
  ext: {
    name: "平安银行",
    change_pct: -0.0384,
  },
};

test("trySendCandidate skips PNG rendering when the rule was already sent this session", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-monitor-test-"));
  let mediaWrites = 0;
  let sendCalls = 0;

  try {
    const service = createMonitorService(tempRoot, {
      alertLogRepository: {
        async isSentThisSession() {
          return true;
        },
      },
      alertService: {
        async sendWithResult() {
          sendCalls += 1;
          return {
            ok: true,
            mediaAttempted: true,
            mediaDelivered: true,
            error: null,
          };
        },
      },
      alertMediaService: {
        async writeAlertCard() {
          mediaWrites += 1;
          return {
            filePath: path.join(tempRoot, "tmp", "already-sent.png"),
            filename: "already-sent.png",
            mediaLocalRoots: [path.join(tempRoot, "tmp")],
          };
        },
      },
    });

    const candidate = {
      ruleName: "support_near",
      message: "price:support_near",
      image: {
        tone: "support" as const,
        alertLabel: "支撑观察",
        note: "价格接近支撑位",
        triggerPrice: 10.0,
      },
    };

    const sent = await (service as unknown as {
      trySendCandidate: (
        item: WatchlistItem,
        quote: TickFlowQuote,
        currentCandidate: typeof candidate,
        levels: KeyLevels,
        getIntradayRows: () => Promise<TickFlowIntradayKlineRow[]>,
      ) => Promise<boolean>;
    }).trySendCandidate(
      watchlistItem,
      quoteAtSupport,
      candidate,
      baseLevels,
      async () => intradayRows,
    );

    assert.equal(sent, false);
    assert.equal(mediaWrites, 0);
    assert.equal(sendCalls, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("trySendAlert removes temporary media files after a failed delivery attempt", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-monitor-test-"));
  const removed: string[] = [];

  try {
    const service = createMonitorService(tempRoot, {
      alertLogRepository: {
        async isSentThisSession() {
          return false;
        },
      },
      alertService: {
        async sendWithResult() {
          return {
            ok: false,
            mediaAttempted: true,
            mediaDelivered: false,
            error: "delivery failed",
          };
        },
      },
      alertMediaService: {
        async removeFile(filePath: string) {
          removed.push(filePath);
        },
      },
    });

    const ok = await (service as unknown as {
      trySendAlert: (symbol: string, ruleName: string, input: { message: string; mediaPath: string }) => Promise<boolean>;
    }).trySendAlert("000001.SZ", "support_near", {
      message: "price:support_near",
      mediaPath: path.join(tempRoot, "tmp", "support.png"),
    });

    assert.equal(ok, false);
    assert.deepEqual(removed, [path.join(tempRoot, "tmp", "support.png")]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("trySendAlert records ambiguous media delivery to avoid immediate duplicate retries", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-monitor-test-"));
  const appendedRules: string[] = [];

  try {
    const service = createMonitorService(tempRoot, {
      alertLogRepository: {
        async isSentThisSession() {
          return false;
        },
        async append(entry: { rule_name: string }) {
          appendedRules.push(entry.rule_name);
        },
      },
      alertService: {
        async sendWithResult() {
          return {
            ok: false,
            mediaAttempted: true,
            mediaDelivered: false,
            error: "runtime delivery failed: message send timed out after upload",
            deliveryUncertain: true,
          };
        },
      },
    });

    const ok = await (service as unknown as {
      trySendAlert: (symbol: string, ruleName: string, input: { message: string; mediaPath: string }) => Promise<boolean>;
    }).trySendAlert("000001.SZ", "support_near", {
      message: "price:support_near",
      mediaPath: path.join(tempRoot, "tmp", "support.png"),
    });

    assert.equal(ok, true);
    assert.deepEqual(appendedRules, ["support_near"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runMonitorOnce keeps only the highest-priority alert for the symbol", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-monitor-test-"));
  const sentInputs: Array<string | { message: string; mediaPath?: string }> = [];
  const appendedRules: string[] = [];
  let mediaWrites = 0;
  let volumeFormats = 0;

  try {
    await seedMonitorState(tempRoot);

    const service = createMonitorService(tempRoot, {
      watchlistService: {
        async list() {
          return [watchlistItem];
        },
      },
      quoteService: {
        async fetchQuotes() {
          return [
            {
              ...quoteAtSupport,
              last_price: 10.0,
              prev_close: 9.3,
              volume: 500_000,
              ext: {
                name: "平安银行",
                change_pct: 0.0753,
              },
            },
          ];
        },
      },
      keyLevelsRepository: {
        async getBySymbol() {
          return {
            ...baseLevels,
            stop_loss: 10.05,
            support: 10.0,
            resistance: 10.2,
            breakthrough: 10.2,
          };
        },
      },
      alertLogRepository: {
        async isSentThisSession() {
          return false;
        },
        async append(entry: { rule_name: string }) {
          appendedRules.push(entry.rule_name);
        },
      },
      klinesRepository: {
        async listBySymbol() {
          return [
            { volume: 1000 },
            { volume: 1100 },
            { volume: 900 },
            { volume: 950 },
            { volume: 1050 },
          ];
        },
      },
      klineService: {
        async fetchIntradayKlines() {
          return intradayRows;
        },
      },
      alertService: {
        formatPriceAlert(params: { ruleCode: string }) {
          return `price:${params.ruleCode}`;
        },
        formatVolumeAlert() {
          volumeFormats += 1;
          return "volume:spike";
        },
        async sendWithResult(input: string | { message: string; mediaPath?: string }) {
          sentInputs.push(input);
          return {
            ok: true,
            mediaAttempted: typeof input !== "string" && Boolean(input.mediaPath),
            mediaDelivered: typeof input !== "string" && Boolean(input.mediaPath),
            error: null,
          };
        },
      },
      alertMediaService: {
        async writeAlertCard() {
          mediaWrites += 1;
          return {
            filePath: path.join(tempRoot, "tmp", "stop-loss.png"),
            filename: "stop-loss.png",
            mediaLocalRoots: [path.join(tempRoot, "tmp")],
          };
        },
      },
    });

    const alertCount = await service.runMonitorOnce();

    assert.equal(alertCount, 1);
    assert.equal(mediaWrites, 1);
    assert.equal(volumeFormats, 0);
    assert.deepEqual(appendedRules, ["stop_loss_hit"]);
    assert.equal(sentInputs.length, 1);
    assert.match(
      typeof sentInputs[0] === "string" ? sentInputs[0] : sentInputs[0]!.message,
      /price:stop_loss_hit/,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("monitor run lease prevents a second loop instance from entering", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-monitor-test-"));

  try {
    const first = createMonitorService(tempRoot);
    const second = createMonitorService(tempRoot);

    const firstLease = await (first as unknown as {
      tryAcquireRunLease: () => Promise<{ release(): Promise<void> } | null>;
    }).tryAcquireRunLease();
    const secondLease = await (second as unknown as {
      tryAcquireRunLease: () => Promise<{ release(): Promise<void> } | null>;
    }).tryAcquireRunLease();

    assert.ok(firstLease);
    assert.equal(secondLease, null);

    await firstLease?.release();
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("alert claim prevents duplicate concurrent deliveries for the same symbol and rule", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-monitor-test-"));
  let sendCalls = 0;
  let appendCalls = 0;
  let releaseFirstSend = () => {};
  let signalFirstSendStarted = () => {};
  const firstSendStarted = new Promise<void>((resolve) => {
    signalFirstSendStarted = resolve;
  });
  const firstSendCanFinish = new Promise<void>((resolve) => {
    releaseFirstSend = resolve;
  });

  try {
    const alertService = {
      async sendWithResult() {
        sendCalls += 1;
        signalFirstSendStarted();
        await firstSendCanFinish;
        return {
          ok: true,
          mediaAttempted: false,
          mediaDelivered: false,
          error: null,
        };
      },
    };

    const alertLogRepository = {
      async isSentThisSession() {
        return false;
      },
      async append() {
        appendCalls += 1;
      },
    };

    const first = createMonitorService(tempRoot, {
      alertService,
      alertLogRepository,
    });
    const second = createMonitorService(tempRoot, {
      alertService,
      alertLogRepository,
    });

    const firstPromise = (first as unknown as {
      trySendAlert: (symbol: string, ruleName: string, input: string) => Promise<boolean>;
    }).trySendAlert("000001.SZ", "support_near", "price:support_near");

    await firstSendStarted;

    const secondResult = await (second as unknown as {
      trySendAlert: (symbol: string, ruleName: string, input: string) => Promise<boolean>;
    }).trySendAlert("000001.SZ", "support_near", "price:support_near");

    releaseFirstSend();
    const firstResult = await firstPromise;

    assert.equal(firstResult, true);
    assert.equal(secondResult, false);
    assert.equal(sendCalls, 1);
    assert.equal(appendCalls, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runMonitorOnce keeps session notifications idempotent even if state sent markers are overwritten", {
  concurrency: false,
}, async (t) => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-04-17T09:32:00+08:00") });
  t.after(() => {
    mock.timers.reset();
  });

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-monitor-test-"));
  const sentKeys = new Set<string>();
  let sendCalls = 0;

  try {
    await writeFile(
      path.join(tempRoot, "monitor-state.json"),
      JSON.stringify({
        running: true,
        lastObservedPhase: "pre_market",
        lastObservedPhaseDate: "2026-04-17",
        sessionNotificationsDate: "2026-04-17",
        sessionNotificationsSent: [],
      }),
      "utf-8",
    );

    const service = createMonitorService(tempRoot, {
      watchlistService: {
        async list() {
          return [watchlistItem];
        },
      },
      quoteService: {
        async fetchQuotes() {
          return [];
        },
      },
      tradingCalendarService: {
        async getTradingPhase() {
          return "trading";
        },
      },
      alertLogRepository: {
        async isSentThisSession(symbol: string, ruleName: string, sessionKey: string) {
          return sentKeys.has(`${symbol}:${ruleName}:${sessionKey}`);
        },
        async append(entry: { symbol: string; alert_date: string; rule_name: string }) {
          sentKeys.add(`${entry.symbol}:${entry.rule_name}:${entry.alert_date}`);
        },
      },
      alertService: {
        async sendWithResult() {
          sendCalls += 1;
          return {
            ok: true,
            mediaAttempted: false,
            mediaDelivered: false,
            error: null,
          };
        },
      },
    });

    const firstCount = await service.runMonitorOnce();

    await writeFile(
      path.join(tempRoot, "monitor-state.json"),
      JSON.stringify({
        running: true,
        lastObservedPhase: "trading",
        lastObservedPhaseDate: "2026-04-17",
        sessionNotificationsDate: "2026-04-17",
        sessionNotificationsSent: [],
      }),
      "utf-8",
    );

    const secondCount = await service.runMonitorOnce();

    assert.equal(firstCount, 1);
    assert.equal(secondCount, 0);
    assert.equal(sendCalls, 1);
    assert.deepEqual([...sentKeys], ["__system_session__:morning_start:2026-04-17_AM"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("getStatusReport excludes session boundary notifications from today's alert count", {
  concurrency: false,
}, async (t) => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-04-17T10:00:00+08:00") });
  t.after(() => {
    mock.timers.reset();
  });

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-monitor-test-"));

  try {
    const service = createMonitorService(tempRoot, {
      alertLogRepository: {
        async listByNaturalDate() {
          return [
            {
              symbol: "__system_session__",
              alert_date: "2026-04-17_AM",
              rule_name: "morning_start",
              message: "session",
              triggered_at: "2026-04-17 09:32:00",
            },
            {
              symbol: "000001.SZ",
              alert_date: "2026-04-17_AM",
              rule_name: "support_near",
              message: "price",
              triggered_at: "2026-04-17 09:35:00",
            },
          ];
        },
      },
    });

    const report = await service.getStatusReport();

    assert.match(report, /今日告警: 1条/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runMonitorOnce does not replay morning end notification inside catch-up window when phase is already lunch break", {
  concurrency: false,
}, async (t) => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-04-17T11:35:00+08:00") });
  t.after(() => {
    mock.timers.reset();
  });

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tickflow-monitor-test-"));
  let sendCalls = 0;

  try {
    await writeFile(
      path.join(tempRoot, "monitor-state.json"),
      JSON.stringify({
        running: true,
        lastObservedPhase: "lunch_break",
        lastObservedPhaseDate: "2026-04-17",
        sessionNotificationsDate: "2026-04-17",
        sessionNotificationsSent: [],
      }),
      "utf-8",
    );

    const service = createMonitorService(tempRoot, {
      tradingCalendarService: {
        async getTradingPhase() {
          return "lunch_break";
        },
      },
      alertService: {
        async sendWithResult() {
          sendCalls += 1;
          return {
            ok: true,
            mediaAttempted: false,
            mediaDelivered: false,
            error: null,
          };
        },
      },
    });

    const count = await service.runMonitorOnce();

    assert.equal(count, 0);
    assert.equal(sendCalls, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function createMonitorService(
  baseDir: string,
  overrides: {
    watchlistService?: Partial<{ list(): Promise<WatchlistItem[]> }>;
    quoteService?: Partial<{ fetchQuotes(symbols: string[]): Promise<TickFlowQuote[]> }>;
    tradingCalendarService?: Partial<{ getTradingPhase(): Promise<"trading" | "closed" | "pre_market" | "lunch_break" | "non_trading_day"> }>;
    keyLevelsRepository?: Partial<{ getBySymbol(symbol: string): Promise<KeyLevels | null> }>;
    alertLogRepository?: Partial<{
      isSentThisSession(symbol: string, ruleName: string, sessionKey: string): Promise<boolean>;
      append(entry: { symbol: string; alert_date: string; rule_name: string }): Promise<void>;
      listByNaturalDate(date: string): Promise<unknown[]>;
    }>;
    klinesRepository?: Partial<{ listBySymbol(symbol: string): Promise<Array<{ volume: number }>> }>;
    intradayKlinesRepository?: Partial<{
      listBySymbol(symbol: string, period: string): Promise<TickFlowIntradayKlineRow[]>;
      saveAll(symbol: string, period: string, rows: TickFlowIntradayKlineRow[]): Promise<void>;
    }>;
    klineService?: Partial<{ fetchIntradayKlines(symbol: string, params: { period: string }): Promise<TickFlowIntradayKlineRow[]> }>;
    alertService?: Partial<{
      formatSystemNotification(title: string, lines: string[]): string;
      formatPriceAlert(params: { ruleCode: string }): string;
      formatVolumeAlert(params: unknown): string;
      send(message: string): Promise<boolean>;
      sendWithResult(input: string | { message: string; mediaPath?: string }): Promise<{
        ok: boolean;
        mediaAttempted: boolean;
        mediaDelivered: boolean;
        error: string | null;
      }>;
    }>;
    alertMediaService?: Partial<{
      maybeCleanupExpired(): Promise<void>;
      writeAlertCard(params: unknown): Promise<{
        filePath: string;
        filename: string;
        mediaLocalRoots: readonly string[];
      }>;
      removeFile(filePath: string): Promise<void>;
    }>;
  } = {},
): MonitorService {
  return new MonitorService(
    baseDir,
    30,
    "telegram",
    {
      async list() {
        return [];
      },
      ...overrides.watchlistService,
    } as never,
    {
      async fetchQuotes() {
        return [];
      },
      ...overrides.quoteService,
    } as never,
    {
      async getTradingPhase() {
        return "trading";
      },
      ...overrides.tradingCalendarService,
    } as never,
    {
      async getBySymbol() {
        return null;
      },
      ...overrides.keyLevelsRepository,
    } as never,
    {
      async isSentThisSession() {
        return false;
      },
      async append() {},
      async listByNaturalDate() {
        return [];
      },
      ...overrides.alertLogRepository,
    } as never,
    {
      async listBySymbol() {
        return [];
      },
      ...overrides.klinesRepository,
    } as never,
    {
      async listBySymbol() {
        return [];
      },
      async saveAll() {},
      ...overrides.intradayKlinesRepository,
    } as never,
    {
      async fetchIntradayKlines() {
        return [];
      },
      ...overrides.klineService,
    } as never,
    {
      formatSystemNotification(title: string, lines: string[]) {
        return [title, lines.join("\n")].join("\n\n");
      },
      formatPriceAlert(params: { ruleCode: string }) {
        return `price:${params.ruleCode}`;
      },
      formatVolumeAlert() {
        return "volume:spike";
      },
      async send() {
        return true;
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
      async maybeCleanupExpired() {},
      async writeAlertCard() {
        return {
          filePath: path.join(baseDir, "tmp", "alert.png"),
          filename: "alert.png",
          mediaLocalRoots: [path.join(baseDir, "tmp")],
        };
      },
      async removeFile() {},
      ...overrides.alertMediaService,
    } as never,
  );
}

async function seedMonitorState(baseDir: string): Promise<void> {
  const today = formatChinaDateTime().slice(0, 10);
  await writeFile(
    path.join(baseDir, "monitor-state.json"),
    JSON.stringify({
      running: true,
      lastObservedPhase: "trading",
      lastObservedPhaseDate: today,
      sessionNotificationsDate: today,
      sessionNotificationsSent: [],
    }),
    "utf-8",
  );
}
