import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseWatchlistProfileExtraction } from "../analysis/parsers/watchlist-profile.parser.js";
import { normalizePluginConfig } from "../config/normalize.js";
import {
  buildWatchlistProfileExtractionUserPrompt,
} from "../prompts/analysis/index.js";
import { AnalysisService } from "../services/analysis-service.js";
import { MxApiService, normalizeMxSearchDocuments } from "../services/mx-search-service.js";
import {
  buildBoardNewsQuery,
  formatWatchlistProfileDocuments,
  WatchlistProfileService,
} from "../services/watchlist-profile-service.js";
import { Database } from "../storage/db.js";
import { AnalysisLogRepository } from "../storage/repositories/analysis-log-repo.js";
import { WatchlistRepository } from "../storage/repositories/watchlist-repo.js";

interface LocalConfigShape {
  plugin?: Record<string, unknown>;
}

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

  const prompt = buildWatchlistProfileExtractionUserPrompt({
    symbol: "002261.SZ",
    companyName: "拓维信息",
    documents: nestedDocs,
  });
  assert.match(prompt, /股票名称: 拓维信息/);
  assert.match(prompt, /1\. 标题: 宁德时代所属行业信息/);

  const formattedDocs = formatWatchlistProfileDocuments(nestedDocs);
  assert.match(formattedDocs, /1\. 宁德时代所属行业信息/);
  assert.match(formattedDocs, /来源: 测试源A/);

  const extracted = parseWatchlistProfileExtraction(
    JSON.stringify({
      sector: "电池行业",
      themes: ["储能", "锂电池", "储能", "公司新闻"],
      confidence: "high",
    }),
  );
  assert.ok(extracted);
  assert.equal(extracted?.sector, "电池行业");
  assert.deepEqual(extracted?.themes, ["储能", "锂电池"]);
  assert.equal(extracted?.confidence, "high");

  const fencedExtraction = parseWatchlistProfileExtraction([
    "```json",
    "{",
    '  "sector": "计算机-软件开发-垂直应用软件",',
    '  "themes": [',
    '    "OpenClaw概念",',
    '    "华为昇腾 / 华为昇思",',
    '    "AI算力 / 数据中心 / 一体机",',
    '    "在线教育（K-12考试测评）",',
    '    "信创",',
    '    "托育概念",',
    '    "公司公告"',
    "  ],",
    '  "confidence": "medium"',
    "}",
    "```",
  ].join("\n"));
  assert.ok(fencedExtraction);
  assert.equal(fencedExtraction?.sector, "计算机-软件开发-垂直应用软件");
  assert.deepEqual(fencedExtraction?.themes, [
    "OpenClaw概念",
    "华为昇腾",
    "华为昇思",
    "AI算力",
    "数据中心",
    "一体机",
    "在线教育",
    "信创",
    "托育概念",
  ]);
  assert.equal(fencedExtraction?.confidence, "medium");

  const invalidExtraction = parseWatchlistProfileExtraction("not-json");
  assert.equal(invalidExtraction, null);

  const boardQuery = buildBoardNewsQuery({
    sector: "计算机-软件开发-垂直应用软件",
    themes: ["OpenClaw概念", "托育概念", "一体机概念", "信创"],
  });
  assert.equal(
    boardQuery,
    "计算机-软件开发-垂直应用软件 OpenClaw概念 托育概念 一体机概念 板块 题材 最新新闻 政策 资金",
  );

  const emptyBoardQuery = buildBoardNewsQuery({
    sector: null,
    themes: [],
  });
  assert.equal(emptyBoardQuery, null);
}

async function runLiveValidation(limit: number): Promise<void> {
  const config = await loadLocalConfig();
  if (!config) {
    console.log("[validate:mx-search] live validation skipped: local.config.json is not available");
    return;
  }

  const database = new Database(config.databasePath);
  const watchlistRepository = new WatchlistRepository(database);
  const analysisLogRepository = new AnalysisLogRepository(database);
  const mxApiService = new MxApiService(config.mxSearchApiUrl, config.mxSearchApiKey);
  const analysisService = new AnalysisService(
    config.llmBaseUrl,
    config.llmApiKey,
    config.llmModel,
    analysisLogRepository,
  );

  const mxConfigError = mxApiService.getConfigurationError();
  if (mxConfigError) {
    console.log(`[validate:mx-search] live validation skipped: ${mxConfigError}`);
    return;
  }

  const llmConfigError = analysisService.getConfigurationError();
  if (llmConfigError) {
    console.log(`[validate:mx-search] live validation skipped: ${llmConfigError}`);
    return;
  }

  const samples = await loadLiveSamples(watchlistRepository, limit);
  if (samples.length === 0) {
    console.log("[validate:mx-search] live validation skipped: no samples available");
    return;
  }

  const watchlistProfileService = new WatchlistProfileService(mxApiService, analysisService);
  console.log(`[validate:mx-search] live validation start: ${samples.length} samples`);

  for (const sample of samples) {
    const profile = await watchlistProfileService.resolve(sample.symbol, sample.name, currentTimestamp());
    const boardQuery = buildBoardNewsQuery(profile);

    console.log(
      JSON.stringify(
        {
          symbol: sample.symbol,
          name: sample.name,
          sector: profile.sector,
          themes: profile.themes,
          themeCount: profile.themes.length,
          themeQuery: profile.themeQuery,
          boardQuery,
        },
        null,
        2,
      ),
    );
  }
}

async function loadLocalConfig() {
  const file = path.join(process.cwd(), "local.config.json");
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as LocalConfigShape;
    return normalizePluginConfig(parsed.plugin ?? {});
  } catch {
    return null;
  }
}

async function loadLiveSamples(
  watchlistRepository: WatchlistRepository,
  limit: number,
): Promise<LiveSample[]> {
  try {
    const items = await watchlistRepository.list();
    if (items.length > 0) {
      return items.slice(0, limit).map((item) => ({ symbol: item.symbol, name: item.name }));
    }
  } catch {
    // fall through to default samples
  }

  return [
    { symbol: "002261.SZ", name: "拓维信息" },
    { symbol: "002202.SZ", name: "金风科技" },
  ].slice(0, limit);
}

function currentTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
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
