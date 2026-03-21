import type { ReviewMemoryContext } from "../analysis/types/composite-analysis.js";
import { KeyLevelsBacktestService } from "./key-levels-backtest-service.js";

const RECENT_SNAPSHOTS_LIMIT = 2;

export class ReviewMemoryService {
  constructor(private readonly keyLevelsBacktestService: KeyLevelsBacktestService) {}

  async getSymbolContext(symbol: string): Promise<ReviewMemoryContext> {
    const report = await this.keyLevelsBacktestService.buildReport({
      symbol,
      recentLimit: RECENT_SNAPSHOTS_LIMIT,
    });
    const asOf = report.recentSnapshots[0]?.analysis_date ?? null;

    if (report.snapshots.length === 0) {
      return {
        available: false,
        summary: "",
        asOf,
      };
    }

    const primary = [...report.horizons].reverse().find((stats) => countSamples(stats) > 0);
    const lines = [
      "历史关键位复盘经验仅用于校准当前判断；若与最新K线、实时价或资讯催化冲突，以当前证据为主。",
    ];

    if (primary) {
      lines.push(
        `近${primary.horizon}日窗口：支撑守住 ${formatRate(primary.support.validCount, primary.support.touchCount)}，压力压制 ${formatRate(primary.resistance.validCount, primary.resistance.touchCount)}，止损触发 ${formatRate(primary.stopLoss.hitCount, primary.stopLoss.sampleCount)}，止盈触发 ${formatRate(primary.takeProfit.hitCount, primary.takeProfit.sampleCount)}，突破确认 ${formatRate(primary.breakthrough.confirmCount, primary.breakthrough.hitCount)}。`,
      );

      if (primary.tradePath.sampleCount > 0) {
        lines.push(
          `双目标路径：先止盈 ${formatRate(primary.tradePath.takeProfitFirstCount, primary.tradePath.sampleCount)}，先止损 ${formatRate(primary.tradePath.stopFirstCount, primary.tradePath.sampleCount)}，未决 ${formatRate(primary.tradePath.unresolvedCount, primary.tradePath.sampleCount)}。`,
        );
      }
    } else {
      lines.push("历史复盘样本仍少，暂时只能作为弱参考。");
    }

    if (report.recentSnapshots.length > 0) {
      lines.push(`最近活动价位：${report.recentSnapshots.map(formatSnapshot).join("；")}`);
    }

    const conclusion = report.conclusion.replace(/^💡\s*结论:\s*/, "").trim();
    if (conclusion) {
      lines.push(`复盘结论：${conclusion}`);
    }

    return {
      available: true,
      summary: lines.join("\n"),
      asOf,
    };
  }
}

function countSamples(stats: {
  support: { sampleCount: number };
  resistance: { sampleCount: number };
  stopLoss: { sampleCount: number };
  takeProfit: { sampleCount: number };
  breakthrough: { sampleCount: number };
  tradePath: { sampleCount: number };
}): number {
  return (
    stats.support.sampleCount +
    stats.resistance.sampleCount +
    stats.stopLoss.sampleCount +
    stats.takeProfit.sampleCount +
    stats.breakthrough.sampleCount +
    stats.tradePath.sampleCount
  );
}

function formatRate(numerator: number, denominator: number): string {
  if (!(denominator > 0)) {
    return "样本不足";
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function formatSnapshot(snapshot: {
  analysis_date: string;
  score: number | null;
  support: number | null;
  resistance: number | null;
  stop_loss: number | null;
  take_profit: number | null;
}): string {
  return [
    snapshot.analysis_date,
    `评分${formatMaybeInt(snapshot.score)}`,
    `支撑${formatMaybePrice(snapshot.support)}`,
    `压力${formatMaybePrice(snapshot.resistance)}`,
    `止损${formatMaybePrice(snapshot.stop_loss)}`,
    `止盈${formatMaybePrice(snapshot.take_profit)}`,
  ].join(" ");
}

function formatMaybePrice(value: number | null | undefined): string {
  return value == null ? "-" : value.toFixed(2);
}

function formatMaybeInt(value: number | null | undefined): string {
  return value == null ? "-" : String(Math.trunc(value));
}
