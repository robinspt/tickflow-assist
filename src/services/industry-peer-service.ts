import type { IndustryPeerContext, IndustryPeerMover } from "../analysis/types/composite-analysis.js";
import type { TickFlowQuote } from "../types/tickflow.js";
import { QuoteService } from "./quote-service.js";
import { TickFlowUniverseService } from "./tickflow-universe-service.js";

const MAX_PEER_MOVERS = 3;

interface PeerQuoteSnapshot {
  symbol: string;
  name: string;
  changePct: number;
}

export class IndustryPeerService {
  constructor(
    private readonly universeService: TickFlowUniverseService | null,
    private readonly quoteService: QuoteService,
  ) {}

  async buildContext(symbol: string): Promise<IndustryPeerContext> {
    if (!this.universeService) {
      return buildUnavailableContext("当前 TickFlow API Key Level 不支持标的池，已跳过申万三级同业表现。");
    }

    const industryProfile = await this.universeService.resolveIndustryProfile(symbol);
    if (!industryProfile?.sw3UniverseId || !industryProfile.sw3Name) {
      return buildUnavailableContext("未获取到可用的申万3级行业映射。");
    }

    const peerSymbols = await this.universeService.listUniverseSymbols(industryProfile.sw3UniverseId);
    if (peerSymbols.length === 0) {
      return buildUnavailableContext(`申万3级 ${industryProfile.sw3Name} 暂无可用成分股。`, industryProfile);
    }

    const quotes = await this.quoteService.fetchQuotes(peerSymbols);
    const snapshots = quotes
      .map(toPeerQuoteSnapshot)
      .filter((item): item is PeerQuoteSnapshot => item != null)
      .sort((left, right) => right.changePct - left.changePct || left.symbol.localeCompare(right.symbol));

    if (snapshots.length === 0) {
      return buildUnavailableContext(`申万3级 ${industryProfile.sw3Name} 暂未返回有效行情。`, industryProfile);
    }

    const targetIndex = snapshots.findIndex((item) => item.symbol === symbol);
    const target = targetIndex >= 0 ? snapshots[targetIndex] : null;
    const others = snapshots.filter((item) => item.symbol !== symbol);
    const advanceCount = others.filter((item) => item.changePct > 0.0001).length;
    const declineCount = others.filter((item) => item.changePct < -0.0001).length;
    const flatCount = Math.max(0, others.length - advanceCount - declineCount);
    const changeValues = others.map((item) => item.changePct);
    const averageChangePct = changeValues.length > 0 ? average(changeValues) : null;
    const medianChangePct = changeValues.length > 0 ? median(changeValues) : null;
    const leaders = others.slice(0, MAX_PEER_MOVERS).map(toPeerMover);
    const laggards = [...others]
      .sort((left, right) => left.changePct - right.changePct || left.symbol.localeCompare(right.symbol))
      .slice(0, MAX_PEER_MOVERS)
      .map(toPeerMover);
    const targetRank = targetIndex >= 0 ? targetIndex + 1 : null;
    const targetPercentile = targetRank != null && snapshots.length > 1
      ? 1 - ((targetRank - 1) / (snapshots.length - 1))
      : targetRank != null ? 1 : null;

    return {
      available: true,
      summary: buildSummary({
        industryName: industryProfile.sw3Name,
        peerCount: snapshots.length,
        otherStockCount: others.length,
        advanceCount,
        declineCount,
        flatCount,
        averageChangePct,
        medianChangePct,
        target,
        targetRank,
      }),
      sw1Name: industryProfile.sw1Name,
      sw2Name: industryProfile.sw2Name,
      sw3Name: industryProfile.sw3Name,
      sw3UniverseId: industryProfile.sw3UniverseId,
      peerCount: snapshots.length,
      otherStockCount: others.length,
      advanceCount,
      declineCount,
      flatCount,
      averageChangePct,
      medianChangePct,
      targetChangePct: target?.changePct ?? null,
      targetRank,
      targetPercentile,
      leaders,
      laggards,
      note: null,
    };
  }
}

function toPeerQuoteSnapshot(quote: TickFlowQuote): PeerQuoteSnapshot | null {
  const prevClose = Number(quote.prev_close ?? 0);
  const lastPrice = Number(quote.last_price ?? 0);
  if (!Number.isFinite(prevClose) || !Number.isFinite(lastPrice) || prevClose <= 0) {
    return null;
  }

  return {
    symbol: String(quote.symbol ?? "").trim(),
    name: String(quote.name ?? quote.ext?.name ?? quote.symbol ?? "").trim(),
    changePct: ((lastPrice - prevClose) / prevClose) * 100,
  };
}

function toPeerMover(item: PeerQuoteSnapshot): IndustryPeerMover {
  return {
    symbol: item.symbol,
    name: item.name || item.symbol,
    changePct: item.changePct,
  };
}

function buildSummary(input: {
  industryName: string;
  peerCount: number;
  otherStockCount: number;
  advanceCount: number;
  declineCount: number;
  flatCount: number;
  averageChangePct: number | null;
  medianChangePct: number | null;
  target: PeerQuoteSnapshot | null;
  targetRank: number | null;
}): string {
  const parts = [
    `申万3级 ${input.industryName} 共 ${input.peerCount} 只`,
    `除本股外上涨 ${input.advanceCount} / 下跌 ${input.declineCount} / 平 ${input.flatCount}`,
  ];

  if (input.averageChangePct != null) {
    parts.push(`均值 ${formatSignedPct(input.averageChangePct)}`);
  }
  if (input.medianChangePct != null) {
    parts.push(`中位数 ${formatSignedPct(input.medianChangePct)}`);
  }
  if (input.target && input.targetRank != null) {
    parts.push(`本股 ${formatSignedPct(input.target.changePct)}，位列 ${input.targetRank}/${input.peerCount}`);
  }

  return parts.join("；");
}

function buildUnavailableContext(
  note: string,
  profile?: {
    sw1Name: string | null;
    sw2Name: string | null;
    sw3Name: string | null;
    sw3UniverseId: string | null;
  },
): IndustryPeerContext {
  return {
    available: false,
    summary: note,
    sw1Name: profile?.sw1Name ?? null,
    sw2Name: profile?.sw2Name ?? null,
    sw3Name: profile?.sw3Name ?? null,
    sw3UniverseId: profile?.sw3UniverseId ?? null,
    peerCount: 0,
    otherStockCount: 0,
    advanceCount: 0,
    declineCount: 0,
    flatCount: 0,
    averageChangePct: null,
    medianChangePct: null,
    targetChangePct: null,
    targetRank: null,
    targetPercentile: null,
    leaders: [],
    laggards: [],
    note,
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle] ?? 0;
}

function formatSignedPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
