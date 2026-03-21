import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { Database } from "../storage/db.js";
import { WatchlistRepository } from "../storage/repositories/watchlist-repo.js";
import { MxApiService, normalizeMxSearchDocuments } from "../services/mx-search-service.js";
import {
  buildBoardNewsQuery,
  extractWatchlistProfile,
} from "../services/watchlist-profile-service.js";

interface LiveSample {
  symbol: string;
  name: string;
}

async function main(): Promise<void> {
  runFixtureValidation();
  console.log("[validate:mx-search] fixture validation passed");

  if (process.argv.includes("--live")) {
    const limit = parseLimitArg("--limit", 2);
    await runLiveValidation(limit);
  }
}

function runFixtureValidation(): void {
  const nestedPayload = {
    data: {
      data: {
        llmSearchResponse: {
          data: [
            {
              title: "宁德时代所属行业信息",
              trunk: "所属行业：电池行业；核心题材：锂电池、储能、固态电池。",
              source: "测试源A",
              publishTime: "2026-03-21 10:00:00",
              secuList: [{ secuCode: "300750", secuName: "宁德时代" }],
            },
            {
              title: "宁德时代题材补充",
              trunk: "涉及概念：储能、锂电池、钠离子电池。",
              sourceName: "测试源B",
              showTime: "2026-03-21 11:00:00",
            },
          ],
        },
      },
    },
  };

  const flatPayload = {
    data: {
      list: [
        {
          headline: "机器人概念板块震荡走强",
          summary: "机器人概念、AI概念热度提升。",
          mediaName: "测试媒体",
          date: "2026-03-20",
        },
      ],
    },
  };

  const nestedDocs = normalizeMxSearchDocuments(nestedPayload);
  assert.equal(nestedDocs.length, 2);
  assert.equal(nestedDocs[0]?.title, "宁德时代所属行业信息");
  assert.equal(nestedDocs[0]?.source, "测试源A");
  assert.equal(nestedDocs[1]?.publishedAt, "2026-03-21 11:00:00");

  const flatDocs = normalizeMxSearchDocuments(flatPayload);
  assert.equal(flatDocs.length, 1);
  assert.equal(flatDocs[0]?.title, "机器人概念板块震荡走强");
  assert.equal(flatDocs[0]?.trunk, "机器人概念、AI概念热度提升。");

  const extracted = extractWatchlistProfile(nestedDocs, "宁德时代", "300750.SZ");
  assert.equal(extracted.sector, "电池行业");
  assert.ok(extracted.themes.includes("储能"));
  assert.ok(extracted.themes.includes("锂电池"));
  assert.equal(extracted.confidence, "high");

  const blockDocs = normalizeMxSearchDocuments({
    data: {
      list: [
        {
          title: "拓维信息概念板块梳理",
          summary: [
            "概念板块：",
            "• OpenClaw概念",
            "• 华为昇腾 / 华为昇思",
            "• 鲲鹏概念",
            "• 开源鸿蒙（OpenHarmony）",
            "• AI算力 / 数据中心 / 一体机",
            "• 信创",
            "• 在线教育（K-12考试测评）",
            "• 托育概念",
            "所属行业：计算机-软件开发-垂直应用软件",
          ].join("\n"),
          mediaName: "测试媒体",
          date: "2026-03-21",
        },
      ],
    },
  });
  const blockProfile = extractWatchlistProfile(blockDocs, "拓维信息", "002261.SZ");
  assert.equal(blockProfile.sector, "计算机-软件开发-垂直应用软件");
  for (const theme of [
    "OpenClaw概念",
    "华为昇腾",
    "华为昇思",
    "鲲鹏概念",
    "开源鸿蒙",
    "AI算力",
    "数据中心",
    "一体机",
    "信创",
    "在线教育",
    "托育概念",
  ]) {
    assert.ok(blockProfile.themes.includes(theme), `missing theme: ${theme}`);
  }
  assert.ok(blockProfile.themes.length >= 11);

  const boardQuery = buildBoardNewsQuery({
    sector: "计算机-软件开发-垂直应用软件",
    themes: ["OpenClaw概念", "托育概念", "一体机概念", "信创"],
  });
  assert.equal(
    boardQuery,
    "计算机-软件开发-垂直应用软件 OpenClaw概念 托育概念 一体机概念 板块 题材 最新新闻 政策 资金",
  );

  const noisyDocs = normalizeMxSearchDocuments({
    data: {
      list: [
        {
          title: "公司新闻",
          summary: "最新新闻，公司公告，板块动态，龙虎榜。",
        },
        {
          title: "市场快讯",
          summary: "今日市场消息较多，但未出现明确所属行业或题材信息。",
        },
      ],
    },
  });
  const noisyProfile = extractWatchlistProfile(noisyDocs, "测试股份", "000001.SZ");
  assert.equal(noisyProfile.sector, null);
  assert.equal(noisyProfile.themes.length, 0);
  assert.equal(noisyProfile.confidence, "low");
}

async function runLiveValidation(limit: number): Promise<void> {
  const config = await loadLocalConfig();
  const pluginConfig = (config?.plugin ?? {}) as Record<string, unknown>;
  const apiUrl = String(pluginConfig.mxSearchApiUrl ?? "").trim();
  const apiKey = String(pluginConfig.mxSearchApiKey ?? "").trim();
  if (!apiUrl || !apiKey) {
    console.log("[validate:mx-search] live validation skipped: mx_search is not configured");
    return;
  }

  const samples = await loadLiveSamples(pluginConfig.databasePath, limit);
  if (samples.length === 0) {
    console.log("[validate:mx-search] live validation skipped: no samples available");
    return;
  }

  const service = new MxApiService(apiUrl, apiKey);
  console.log(`[validate:mx-search] live validation start: ${samples.length} samples`);

  for (const sample of samples) {
    const profileQuery = `${sample.name} ${sample.symbol} 所属行业 板块 题材 概念`;
    const documents = (await service.search(profileQuery)).slice(0, 8);
    const profile = extractWatchlistProfile(documents, sample.name, sample.symbol);
    const boardQuery = buildBoardNewsQuery({
      sector: profile.sector,
      themes: profile.themes,
    });

    console.log(
      JSON.stringify(
        {
          symbol: sample.symbol,
          name: sample.name,
          documentCount: documents.length,
          sector: profile.sector,
          themes: profile.themes,
          confidence: profile.confidence,
          evidenceCount: profile.evidenceCount,
          boardQuery,
        },
        null,
        2,
      ),
    );
  }
}

async function loadLocalConfig(): Promise<Record<string, unknown> | null> {
  const file = path.join(process.cwd(), "local.config.json");
  try {
    return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function loadLiveSamples(databasePath: unknown, limit: number): Promise<LiveSample[]> {
  if (typeof databasePath === "string" && databasePath.trim()) {
    try {
      const db = new Database(databasePath);
      const repo = new WatchlistRepository(db);
      const items = await repo.list();
      if (items.length > 0) {
        return items.slice(0, limit).map((item) => ({ symbol: item.symbol, name: item.name }));
      }
    } catch {
      // fall through to default samples
    }
  }

  return [
    { symbol: "002261.SZ", name: "拓维信息" },
    { symbol: "002202.SZ", name: "金风科技" },
  ].slice(0, limit);
}

function parseLimitArg(prefix: string, fallback: number): number {
  const value = process.argv.find((item) => item.startsWith(`${prefix}=`));
  if (!value) {
    return fallback;
  }
  const parsed = Number(value.slice(prefix.length + 1));
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("[validate:mx-search] failed");
  console.error(message);
  process.exitCode = 1;
});
