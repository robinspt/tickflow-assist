import type { KeyLevelsHistoryEntry } from "../types/domain.js";
import { formatChinaDateTime } from "../utils/china-time.js";
import { CompositeAnalysisOrchestrator } from "../analysis/orchestrators/composite-analysis.orchestrator.js";
import { KeyLevelsHistoryRepository } from "../storage/repositories/key-levels-history-repo.js";
import { WatchlistService } from "./watchlist-service.js";
import { KeyLevelsBacktestService } from "./key-levels-backtest-service.js";

export class PostCloseReviewService {
  constructor(
    private readonly watchlistService: WatchlistService,
    private readonly compositeAnalysisOrchestrator: CompositeAnalysisOrchestrator,
    private readonly keyLevelsHistoryRepository: KeyLevelsHistoryRepository,
    private readonly keyLevelsBacktestService: KeyLevelsBacktestService,
  ) {}

  async run(): Promise<string> {
    const watchlist = await this.watchlistService.list();
    if (watchlist.length === 0) {
      return "🤖 收盘分析: 关注列表为空，已跳过分析与回测。";
    }

    const detailLines = ["收盘分析明细:"];
    let success = 0;
    let failed = 0;
    let refreshed = 0;

    for (const item of watchlist) {
      try {
        const result = await this.compositeAnalysisOrchestrator.analyze(item.symbol);
        success += 1;
        if (result.levels) {
          await this.keyLevelsHistoryRepository.saveDailySnapshot(
            toHistoryEntry(item.symbol, result.analysisText, result.levels),
          );
          refreshed += 1;
          detailLines.push(
            `✅ ${item.name}（${item.symbol}）: 评分 ${result.levels.score}/10 | 支撑 ${formatMaybePrice(result.levels.support)} | 压力 ${formatMaybePrice(result.levels.resistance)} | 止损 ${formatMaybePrice(result.levels.stop_loss)}`,
          );
          continue;
        }

        detailLines.push(`⚠️ ${item.name}（${item.symbol}）: 未生成结构化关键价位，已跳过活动快照更新`);
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        detailLines.push(`❌ ${item.name}（${item.symbol}）: ${message}`);
      }
    }

    const summaryLines = [
      `🤖 收盘分析: ${watchlist.length} 只股票`,
      `🤖 分析完成: ${success} 成功, ${failed} 失败, ${refreshed} 只已刷新活动价位`,
      ...(await this.keyLevelsBacktestService.buildSummaryLines()),
    ];

    return [...summaryLines, "", ...detailLines].join("\n");
  }
}

function toHistoryEntry(
  symbol: string,
  analysisText: string,
  levels: import("../types/domain.js").KeyLevels,
): KeyLevelsHistoryEntry {
  return {
    symbol,
    analysis_date: levels.analysis_date ?? formatChinaDateTime().slice(0, 10),
    activated_at: formatChinaDateTime(),
    profile: "composite",
    current_price: levels.current_price,
    stop_loss: levels.stop_loss ?? null,
    breakthrough: levels.breakthrough ?? null,
    support: levels.support ?? null,
    cost_level: levels.cost_level ?? null,
    resistance: levels.resistance ?? null,
    take_profit: levels.take_profit ?? null,
    gap: levels.gap ?? null,
    target: levels.target ?? null,
    round_number: levels.round_number ?? null,
    analysis_text: analysisText,
    score: levels.score,
  };
}

function formatMaybePrice(value: number | null | undefined): string {
  return value == null ? "-" : value.toFixed(2);
}
