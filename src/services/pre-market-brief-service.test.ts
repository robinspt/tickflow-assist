import assert from "node:assert/strict";
import test from "node:test";

import type { WatchlistItem } from "../types/domain.js";
import type { Jin10FlashPage, Jin10FlashRecord } from "../types/jin10.js";
import { PreMarketBriefService } from "./pre-market-brief-service.js";

const watchlist: WatchlistItem[] = [
  {
    symbol: "300024.SZ",
    name: "机器人",
    costPrice: 15.2,
    addedAt: "2026-04-01 09:30:00",
    sector: "自动化设备",
    themes: ["机器人", "人工智能"],
    themeQuery: "自动化设备 机器人 人工智能",
    themeUpdatedAt: "2026-04-08 18:00:00",
  },
  {
    symbol: "002415.SZ",
    name: "海康威视",
    costPrice: 31.5,
    addedAt: "2026-04-01 09:30:00",
    sector: "安防设备",
    themes: ["AI视觉"],
    themeQuery: "安防设备 AI视觉",
    themeUpdatedAt: "2026-04-08 18:00:00",
  },
];

test("run builds pre-market brief from Jin10 window and watchlist context", async () => {
  const stored: Jin10FlashRecord[] = [];
  let capturedPrompt = "";

  const service = new PreMarketBriefService(
    {
      async list() {
        return watchlist;
      },
    } as never,
    {
      getConfigurationError() {
        return null;
      },
      async listFlash(): Promise<Jin10FlashPage> {
        return {
          hasMore: false,
          nextCursor: null,
          items: [
            makeFlashItem(
              "金十数据整理：A股每日市场要闻回顾。机器人板块早盘情绪升温，政策预期回暖。",
              "2026-04-09T09:12:00+08:00",
              "https://flash.example/a",
            ),
            makeFlashItem(
              "金十数据整理：每日投行/机构观点梳理。海康威视所在安防设备方向关注度抬升。",
              "2026-04-08T18:20:00+08:00",
              "https://flash.example/b",
            ),
            makeFlashItem(
              "金十数据整理：更早一条，不应进入本次窗口。",
              "2026-04-08T16:40:00+08:00",
              "https://flash.example/c",
            ),
          ],
        };
      },
    } as never,
    {
      async saveAll(entries: Jin10FlashRecord[]) {
        for (const entry of entries) {
          if (!stored.some((item) => item.flash_key === entry.flash_key)) {
            stored.push(entry);
          }
        }
        return {
          added: entries.length,
          skipped: 0,
          addedKeys: entries.map((entry) => entry.flash_key),
        };
      },
      async listByPublishedRange(startTs: number, endTs: number) {
        return stored
          .filter((entry) => entry.published_ts >= startTs && entry.published_ts <= endTs)
          .sort((left, right) => left.published_ts - right.published_ts);
      },
    } as never,
    {
      isConfigured() {
        return true;
      },
      async generateText(_systemPrompt: string, userPrompt: string) {
        capturedPrompt = userPrompt;
        return [
          "**【🧭 重大要闻】**",
          "• 机器人与安防方向情绪抬升。",
          "",
          "**【🎯 自选相关】**",
          "• 机器人、海康威视均有对应整理快讯。",
        ].join("\n");
      },
    } as never,
  );

  const result = await service.run(new Date("2026-04-09T09:21:00+08:00"));

  assert.equal(result.resultType, "success");
  assert.equal(result.sourceCount, 2);
  assert.equal(result.matchedWatchlistCount, 2);
  assert.match(result.message, /整理快讯: 2 条 \| 自选: 2 只 \| 规则命中: 2 只/);
  assert.match(result.message, /机器人与安防方向情绪抬升/);
  assert.match(capturedPrompt, /机器人（300024\.SZ）/);
  assert.match(capturedPrompt, /海康威视（002415\.SZ）/);
  assert.match(capturedPrompt, /金十数据整理：A股每日市场要闻回顾/);
  assert.match(capturedPrompt, /提炼摘要:/);
  assert.match(capturedPrompt, /正文要点:/);
  assert.doesNotMatch(result.message, /更早一条/);
});

test("run falls back to extracted details when llm output only repeats titles", async () => {
  const stored: Jin10FlashRecord[] = [];

  const service = new PreMarketBriefService(
    {
      async list() {
        return watchlist;
      },
    } as never,
    {
      getConfigurationError() {
        return null;
      },
      async listFlash(): Promise<Jin10FlashPage> {
        return {
          hasMore: false,
          nextCursor: null,
          items: [
            makeFlashItem(
              [
                "金十数据整理：中东局势跟踪（4月15日）",
                "1. 霍尔木兹海峡交通再次中断，多艘油轮选择绕行。",
                "2. 中东油气设施受损，全球能源供应链扰动加剧。",
              ].join("\n"),
              "2026-04-15T05:15:00+08:00",
              "https://flash.example/middle-east",
            ),
            makeFlashItem(
              [
                "金十数据整理：每日科技要闻速递（4月15日）",
                "1. 新一代人形机器人发布，带动机器人产业链关注度升温。",
                "2. AI 基础设施需求预期继续上修。",
              ].join("\n"),
              "2026-04-15T07:27:00+08:00",
              "https://flash.example/tech",
            ),
          ],
        };
      },
    } as never,
    {
      async saveAll(entries: Jin10FlashRecord[]) {
        stored.push(...entries);
        return {
          added: entries.length,
          skipped: 0,
          addedKeys: entries.map((entry) => entry.flash_key),
        };
      },
      async listByPublishedRange(startTs: number, endTs: number) {
        return stored
          .filter((entry) => entry.published_ts >= startTs && entry.published_ts <= endTs)
          .sort((left, right) => left.published_ts - right.published_ts);
      },
    } as never,
    {
      isConfigured() {
        return true;
      },
      async generateText() {
        return [
          "**【🧭 重大要闻】**",
          "• [05:15] 【金十数据整理：中东局势跟踪（4月15日）】",
          "",
          "**【🎯 自选相关】**",
          "• 机器人（300024.SZ）: 【金十数据整理：每日科技要闻速递（4月15日）】",
        ].join("\n");
      },
    } as never,
  );

  const result = await service.run(new Date("2026-04-15T09:21:00+08:00"));

  assert.equal(result.resultType, "success");
  assert.match(result.message, /霍尔木兹海峡交通再次中断/);
  assert.match(result.message, /中东油气设施受损/);
  assert.match(result.message, /新一代人形机器人发布/);
  assert.doesNotMatch(result.message, /• \[05:15\] 【金十数据整理：中东局势跟踪（4月15日）】/);
});

function makeFlashItem(content: string, time: string, url: string) {
  return {
    content,
    time,
    url,
    raw: {},
  };
}
