import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
    "--json",
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
    "--json",
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

test("sendWithResult avoids split retries after ambiguous telegram command failure", async () => {
  const commandCalls: Array<{
    argv: string[];
    options: number | { timeoutMs: number };
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
          runCommandWithTimeout: async (
            argv: string[],
            options: number | { timeoutMs: number },
          ) => {
            commandCalls.push({ argv, options });
            return {
              stdout: "",
              stderr: "message send timed out after upload",
              code: null,
              signal: null,
              killed: true,
              termination: "timeout" as const,
            };
          },
        },
        channel: {
          telegram: {
            async sendMessageTelegram() {
              throw new Error("telegram runtime should not be used");
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

  assert.equal(commandCalls.length, 1);
  assert.deepEqual(result, {
    ok: false,
    mediaAttempted: true,
    mediaDelivered: false,
    error: "message send timed out after upload",
    deliveryUncertain: true,
  });
});

test("sendWithResult uses CLI for telegram media alerts even when runtime is available", async () => {
  let cliCalled = false;
  let runtimeCalled = false;
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
        channel: {
          telegram: {
            async sendMessageTelegram(
              target: string,
              message: string,
              options: Record<string, unknown>,
            ) {
              runtimeCalled = true;
              throw new Error(
                `telegram runtime should not be used: ${target} ${message} ${JSON.stringify(options)}`,
              );
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

  assert.equal(cliCalled, true);
  assert.equal(runtimeCalled, false);
  assert.deepEqual(result, {
    ok: true,
    mediaAttempted: true,
    mediaDelivered: true,
    error: null,
  });
});

test("sendWithResult uses CLI for text-only telegram notifications even when runtime is available", async () => {
  let cliCalled = false;
  let runtimeCalled = false;
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
        channel: {
          telegram: {
            async sendMessageTelegram() {
              runtimeCalled = true;
              throw new Error("telegram runtime should not be used");
            },
          },
        },
      } as never,
    },
  });

  const result = await service.sendWithResult({
    message: "🔔 上午盯盘结束",
  });

  assert.equal(cliCalled, true);
  assert.equal(runtimeCalled, false);
  assert.deepEqual(result, {
    ok: true,
    mediaAttempted: false,
    mediaDelivered: false,
    error: null,
  });
});

test("sendWithResult uses CLI for qqbot alerts even when runtime is available", async () => {
  let cliCalled = false;
  let runtimeCalled = false;
  const service = new AlertService({
    openclawCliBin: "openclaw",
    channel: "qqbot",
    account: "default",
    target: "qqbot:c2c:USER_OPENID",
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
        channel: {
          qqbot: {
            async sendMessageQQBot() {
              runtimeCalled = true;
              throw new Error("qqbot runtime should not be used");
            },
          },
        },
      } as never,
    },
  });

  const result = await service.sendWithResult({
    message: "caption",
    mediaPath: "https://example.com/alert-card.png",
  });

  assert.equal(cliCalled, true);
  assert.equal(runtimeCalled, false);
  assert.deepEqual(result, {
    ok: true,
    mediaAttempted: true,
    mediaDelivered: true,
    error: null,
  });
});

test("sendWithResult treats qqbot command JSON error as a definite failure", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "tickflow-alert-home-"));
  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;

  const sourceDir = path.join(tempHome, "project");
  await mkdir(sourceDir, { recursive: true });
  const sourcePath = path.join(sourceDir, "alert-card.png");
  await writeFile(sourcePath, Buffer.from("png"));

  let callCount = 0;
  let stagedMediaPath: string | undefined;
  const service = new AlertService({
    openclawCliBin: "openclaw",
    channel: "qqbot",
    account: "default",
    target: "qqbot:c2c:USER_OPENID",
    runtime: {
      config: {} as never,
      runtime: {
        system: {
          runCommandWithTimeout: async (argv: string[]) => {
            callCount += 1;
            const mediaIndex = argv.indexOf("--media");
            if (mediaIndex >= 0) {
              stagedMediaPath = argv[mediaIndex + 1];
            }
            if (callCount === 1) {
              return {
                stdout: JSON.stringify({
                  action: "send",
                  channel: "qqbot",
                  payload: {
                    channel: "qqbot",
                    to: "qqbot:c2c:USER_OPENID",
                    via: "direct",
                    result: {
                      channel: "qqbot",
                      messageId: "",
                      meta: {
                        error: "recipient is not reachable for proactive message",
                      },
                    },
                  },
                }, null, 2),
                stderr: "",
                code: 0,
                signal: null,
                killed: false,
                termination: "exit" as const,
              };
            }

            return {
              stdout: JSON.stringify({
                action: "send",
                channel: "qqbot",
                payload: {
                  channel: "qqbot",
                  to: "qqbot:c2c:USER_OPENID",
                  via: "direct",
                  result: {
                    channel: "qqbot",
                    messageId: "msg-123",
                  },
                },
              }, null, 2),
              stderr: "",
              code: 0,
              signal: null,
              killed: false,
              termination: "exit" as const,
            };
          },
        },
      } as never,
    },
  });

  try {
    const result = await service.sendWithResult({
      message: "caption",
      mediaPath: sourcePath,
      mediaLocalRoots: [sourceDir],
    });

    assert.equal(callCount, 2);
    assert.ok(stagedMediaPath);
    assert.notEqual(stagedMediaPath, sourcePath);
    assert.equal(
      path.relative(path.join(tempHome, ".openclaw", "media", "qqbot"), stagedMediaPath ?? "").startsWith(".."),
      false,
    );
    await assert.rejects(access(stagedMediaPath ?? ""));
    assert.deepEqual(result, {
      ok: true,
      mediaAttempted: true,
      mediaDelivered: false,
      error: "recipient is not reachable for proactive message",
    });
  } finally {
    if (originalHome == null) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("sendWithResult stages qqbot local media under openclaw media storage before command send", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "tickflow-alert-home-"));
  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;

  const sourceDir = path.join(tempHome, "project");
  await mkdir(sourceDir, { recursive: true });
  const sourcePath = path.join(sourceDir, "alert-card.png");
  await writeFile(sourcePath, Buffer.from("png"));

  let stagedMediaPath: string | undefined;
  const service = new AlertService({
    openclawCliBin: "openclaw",
    channel: "qqbot",
    account: "default",
    target: "qqbot:c2c:USER_OPENID",
    runtime: {
      config: {} as never,
      runtime: {
        system: {
          runCommandWithTimeout: async (argv: string[]) => {
            const mediaIndex = argv.indexOf("--media");
            if (mediaIndex >= 0) {
              stagedMediaPath = argv[mediaIndex + 1];
            }

            return {
              stdout: JSON.stringify({
                action: "send",
                channel: "qqbot",
                payload: {
                  channel: "qqbot",
                  to: "qqbot:c2c:USER_OPENID",
                  via: "direct",
                  result: {
                    channel: "qqbot",
                    messageId: "msg-123",
                  },
                },
              }, null, 2),
              stderr: "",
              code: 0,
              signal: null,
              killed: false,
              termination: "exit" as const,
            };
          },
        },
      } as never,
    },
  });

  try {
    const result = await service.sendWithResult({
      message: "caption",
      mediaPath: sourcePath,
      mediaLocalRoots: [sourceDir],
    });

    assert.ok(stagedMediaPath);
    assert.notEqual(stagedMediaPath, sourcePath);
    assert.equal(
      path.relative(path.join(tempHome, ".openclaw", "media", "qqbot"), stagedMediaPath ?? "").startsWith(".."),
      false,
    );
    await assert.rejects(access(stagedMediaPath ?? ""));
    assert.deepEqual(result, {
      ok: true,
      mediaAttempted: true,
      mediaDelivered: true,
      error: null,
    });
  } finally {
    if (originalHome == null) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(tempHome, { recursive: true, force: true });
  }
});
