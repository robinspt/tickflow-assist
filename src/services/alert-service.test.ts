import assert from "node:assert/strict";
import test from "node:test";

import { AlertService } from "./alert-service.js";

const alertService = new AlertService({
  openclawCliBin: "openclaw",
  channel: "telegram",
  account: "",
  target: "",
});

test("formatPriceAlert renders bold banner and level rail", () => {
  const message = alertService.formatPriceAlert({
    symbol: "002202.SZ",
    name: "金风科技",
    currentPrice: 26.99,
    ruleCode: "support_near",
    title: "触及支撑",
    ruleDescription: "价格接近支撑位，关注是否企稳",
    levelPrice: 27.05,
    costPrice: 30.57,
    dailyChangePct: -1.23,
    relatedLevels: {
      current_price: 26.99,
      stop_loss: 26.8,
      support: 27.05,
      resistance: 28.8,
      breakthrough: 28.8,
      take_profit: 29.5,
      analysis_text: "",
      score: 4,
    },
  });

  assert.match(message, /\*\*🟦【支撑观察】\*\*/);
  assert.match(message, /📍 信号：价格接近支撑位，关注是否企稳/);
  assert.match(message, /🧭 位阶图：⛔止损 26\.80 → 💹现价 26\.99 → 🛡️支撑 27\.05/);
  assert.match(message, /🚧压力\/🚀突破 28\.80/);
  assert.match(message, /💰 持仓盈亏：/);
});

test("formatVolumeAlert renders bold banner and level rail", () => {
  const message = alertService.formatVolumeAlert({
    symbol: "600343.SH",
    name: "航天动力",
    currentPrice: 34.81,
    currentVolume: 1_234_567,
    avgVolume: 234_567,
    ratio: 5.3,
    dailyChangePct: 6.84,
    relatedLevels: {
      current_price: 34.81,
      support: 32.5,
      resistance: 34.5,
      breakthrough: 35.2,
      take_profit: 36.1,
      analysis_text: "",
      score: 7,
    },
  });

  assert.match(message, /\*\*🟪【放量异动】\*\*/);
  assert.match(message, /📈 当前成交量 1,234,567 \| 📉 近5日均量 234567/);
  assert.match(message, /⚡ 量比 5\.3倍/);
  assert.match(message, /🧭 位阶图：🛡️支撑 32\.50 → 🚧压力 34\.50 → 💹现价 34\.81/);
});

test("buildCliArgs includes media path when sending image alerts", () => {
  const args = (alertService as unknown as {
    buildCliArgs: (input: { message: string; mediaPath: string }) => string[];
  }).buildCliArgs({
    message: "test",
    mediaPath: "/tmp/alert-card.png",
  });

  assert.deepEqual(args, [
    "openclaw",
    "message",
    "send",
    "--channel",
    "telegram",
    "--message",
    "test",
    "--media",
    "/tmp/alert-card.png",
  ]);
});

test("buildCliArgs omits --message for media-only sends", () => {
  const args = (alertService as unknown as {
    buildCliArgs: (input: { message: string; mediaPath: string }) => string[];
  }).buildCliArgs({
    message: "",
    mediaPath: "/tmp/alert-card.png",
  });

  assert.deepEqual(args, [
    "openclaw",
    "message",
    "send",
    "--channel",
    "telegram",
    "--media",
    "/tmp/alert-card.png",
  ]);
});

test("getCommandRunOptions uses longer timeout for media sends", () => {
  const options = (alertService as unknown as {
    getCommandRunOptions: (input: { message: string; mediaPath?: string }) => { timeoutMs: number };
  }).getCommandRunOptions({
    message: "test",
    mediaPath: "/tmp/alert-card.png",
  });

  assert.deepEqual(options, {
    timeoutMs: 45_000,
  });
});

test("getCommandRunOptions keeps short timeout for text-only sends", () => {
  const options = (alertService as unknown as {
    getCommandRunOptions: (input: { message: string; mediaPath?: string }) => { timeoutMs: number };
  }).getCommandRunOptions({
    message: "test",
  });

  assert.deepEqual(options, {
    timeoutMs: 15_000,
  });
});

test("sendWithResult falls back to text-only on definite media pre-send failure", async () => {
  const calls: Array<{ message: string; mediaPath?: string }> = [];
  const service = new AlertService({
    openclawCliBin: "openclaw",
    channel: "telegram",
    account: "",
    target: "",
  });
  const runtimeService = service as unknown as {
    trySendPayload: (
      input: { message: string; mediaPath?: string },
    ) => Promise<{ error: string; ambiguous: boolean } | null>;
    sendWithResult: AlertService["sendWithResult"];
  };

  runtimeService.trySendPayload = async (payload: { message: string; mediaPath?: string }) => {
    calls.push({ message: payload.message, mediaPath: payload.mediaPath });
    if (payload.mediaPath && payload.message === "caption") {
      return {
        error: "media file missing",
        ambiguous: false,
      };
    }
    return null;
  };

  const result = await runtimeService.sendWithResult({
    message: "caption",
    mediaPath: "/tmp/alert-card.png",
  });

  assert.deepEqual(calls, [
    { message: "caption", mediaPath: "/tmp/alert-card.png" },
    { message: "caption", mediaPath: undefined },
  ]);
  assert.deepEqual(result, {
    ok: true,
    mediaAttempted: true,
    mediaDelivered: false,
    error: "media file missing",
  });
});

test("sendWithResult avoids split retries after ambiguous telegram media failure", async () => {
  let cliCalled = false;
  const service = new AlertService({
    openclawCliBin: "openclaw",
    channel: "telegram",
    account: "default",
    target: "telegram:@mychat",
    runtime: {
      config: {} as never,
      runtime: {
        system: {
          runCommandWithTimeout: async () => {
            cliCalled = true;
            throw new Error("CLI fallback should not run after ambiguous runtime failure");
          },
        },
        channel: {
          telegram: {
            async sendMessageTelegram() {
              throw new Error("message send timed out after upload");
            },
          },
        },
      } as never,
    },
  });

  const result = await service.sendWithResult({
    message: "caption",
    mediaPath: "/tmp/alert-card.png",
    mediaLocalRoots: ["/tmp"],
  });

  assert.equal(cliCalled, false);
  assert.deepEqual(result, {
    ok: false,
    mediaAttempted: true,
    mediaDelivered: false,
    error: "runtime delivery failed: message send timed out after upload",
    deliveryUncertain: true,
  });
});

test("sendWithResult falls back to CLI when telegram runtime method is unavailable", async () => {
  let cliCalled = false;
  const service = new AlertService({
    openclawCliBin: "openclaw",
    channel: "telegram",
    account: "default",
    target: "telegram:@mychat",
    runtime: {
      config: {} as never,
      runtime: {
        system: {
          runCommandWithTimeout: async () => {
            cliCalled = true;
            return {
              stdout: "",
              stderr: "",
              code: 0,
              signal: null,
              killed: false,
              termination: "exit" as const,
            };
          },
        },
        channel: {},
      } as never,
    },
  });

  const result = await service.sendWithResult({
    message: "caption",
    mediaPath: "/tmp/alert-card.png",
    mediaLocalRoots: ["/tmp"],
  });

  assert.equal(cliCalled, true);
  assert.deepEqual(result, {
    ok: true,
    mediaAttempted: true,
    mediaDelivered: true,
    error: null,
  });
});

test("sendWithResult falls back to CLI for text-only telegram notifications", async () => {
  let cliCalled = false;
  const service = new AlertService({
    openclawCliBin: "openclaw",
    channel: "telegram",
    account: "default",
    target: "telegram:@mychat",
    runtime: {
      config: {} as never,
      runtime: {
        system: {
          runCommandWithTimeout: async () => {
            cliCalled = true;
            return {
              stdout: "",
              stderr: "",
              code: 0,
              signal: null,
              killed: false,
              termination: "exit" as const,
            };
          },
        },
        channel: {},
      } as never,
    },
  });

  const result = await service.sendWithResult({
    message: "🔔 上午盯盘结束",
  });

  assert.equal(cliCalled, true);
  assert.deepEqual(result, {
    ok: true,
    mediaAttempted: false,
    mediaDelivered: false,
    error: null,
  });
});

test("sendWithResult uses telegram runtime before CLI when available", async () => {
  const telegramCalls: Array<{
    target: string;
    message: string;
    options: Record<string, unknown>;
  }> = [];
  const service = new AlertService({
    openclawCliBin: "openclaw",
    channel: "telegram",
    account: "default",
    target: "telegram:@mychat",
    runtime: {
      config: {} as never,
      runtime: {
        system: {
          runCommandWithTimeout: async () => {
            throw new Error("CLI fallback should not run when telegram runtime succeeds");
          },
        },
        channel: {
          telegram: {
            async sendMessageTelegram(
              target: string,
              message: string,
              options: Record<string, unknown>,
            ) {
              telegramCalls.push({ target, message, options });
            },
          },
        },
      } as never,
    },
  });

  const result = await service.sendWithResult({
    message: "caption",
    mediaPath: "/tmp/alert-card.png",
    mediaLocalRoots: ["/tmp"],
    filename: "alert-card.png",
  });

  assert.deepEqual(telegramCalls, [
    {
      target: "telegram:@mychat",
      message: "caption",
      options: {
        accountId: "default",
        cfg: {},
        mediaUrl: "/tmp/alert-card.png",
        mediaLocalRoots: ["/tmp"],
      },
    },
  ]);
  assert.deepEqual(result, {
    ok: true,
    mediaAttempted: true,
    mediaDelivered: true,
    error: null,
  });
});
