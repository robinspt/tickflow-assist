import { AnalysisLogRepository } from "../storage/repositories/analysis-log-repo.js";
import { CompositeAnalysisRepository } from "../storage/repositories/composite-analysis-repo.js";
import { FinancialAnalysisRepository } from "../storage/repositories/financial-analysis-repo.js";
import { KeyLevelsRepository } from "../storage/repositories/key-levels-repo.js";
import { NewsAnalysisRepository } from "../storage/repositories/news-analysis-repo.js";
import { TechnicalAnalysisRepository } from "../storage/repositories/technical-analysis-repo.js";
import type {
  AnalysisBias,
  CompositeAnalysisEntry,
  FinancialAnalysisEntry,
  KeyLevels,
  NewsAnalysisEntry,
  TechnicalAnalysisEntry,
} from "../types/domain.js";

export type AnalysisViewProfile = "composite" | "technical" | "financial" | "news" | "all";

interface LegacyCompositeAnalysisView {
  analysis_date: string;
  analysis_text: string;
  structured_ok: boolean;
  levels: KeyLevels | null;
}

export class AnalysisViewService {
  constructor(
    private readonly analysisLogRepository: AnalysisLogRepository,
    private readonly keyLevelsRepository: KeyLevelsRepository,
    private readonly technicalAnalysisRepository: TechnicalAnalysisRepository,
    private readonly financialAnalysisRepository: FinancialAnalysisRepository,
    private readonly newsAnalysisRepository: NewsAnalysisRepository,
    private readonly compositeAnalysisRepository: CompositeAnalysisRepository,
  ) {}

  async render(symbol: string, profile: AnalysisViewProfile, limit = 1): Promise<string> {
    const normalizedLimit = Math.max(1, Math.trunc(limit));
    switch (profile) {
      case "technical":
        return this.renderTechnical(symbol, normalizedLimit);
      case "financial":
        return this.renderFinancial(symbol, normalizedLimit);
      case "news":
        return this.renderNews(symbol, normalizedLimit);
      case "all":
        return this.renderAll(symbol, normalizedLimit);
      case "composite":
      default:
        return this.renderComposite(symbol, normalizedLimit);
    }
  }

  private async renderComposite(symbol: string, limit: number): Promise<string> {
    const entries = await this.compositeAnalysisRepository.listLatest(symbol, limit);
    if (entries.length > 0) {
      return renderEntryCollection(symbol, "综合分析", entries, formatCompositeEntry, limit);
    }

    const legacy = await this.getLegacyComposite(symbol);
    if (!legacy) {
      return `⚠️ 暂无 ${symbol} 的综合分析记录`;
    }
    if (limit > 1) {
      return [
        `🗂️ 最近 ${limit} 次综合分析: ${symbol}`,
        "返回记录: 1",
        "说明: 当前仅存在 legacy 综合分析记录，历史列表从第二阶段结果表开始累计。",
        "",
        formatLegacyCompositeEntry(symbol, legacy),
      ].join("\n");
    }
    return formatLegacyCompositeEntry(symbol, legacy);
  }

  private async renderTechnical(symbol: string, limit: number): Promise<string> {
    const entries = await this.technicalAnalysisRepository.listLatest(symbol, limit);
    if (entries.length > 0) {
      return renderEntryCollection(symbol, "技术面分析", entries, formatTechnicalEntry, limit);
    }

    const legacy = await this.getLegacyComposite(symbol);
    if (!legacy) {
      return `⚠️ 暂无 ${symbol} 的技术面分析记录`;
    }
    if (limit > 1) {
      return [
        `🗂️ 最近 ${limit} 次技术面分析: ${symbol}`,
        "返回记录: 1",
        "说明: 当前仅存在 legacy 技术面记录，历史列表从第二阶段结果表开始累计。",
        "",
        formatLegacyTechnicalEntry(symbol, legacy),
      ].join("\n");
    }
    return formatLegacyTechnicalEntry(symbol, legacy);
  }

  private async renderFinancial(symbol: string, limit: number): Promise<string> {
    const entries = await this.financialAnalysisRepository.listLatest(symbol, limit);
    if (entries.length === 0) {
      return `⚠️ 暂无 ${symbol} 的基本面分析记录`;
    }
    return renderEntryCollection(symbol, "基本面分析", entries, formatFinancialEntry, limit);
  }

  private async renderNews(symbol: string, limit: number): Promise<string> {
    const entries = await this.newsAnalysisRepository.listLatest(symbol, limit);
    if (entries.length === 0) {
      return `⚠️ 暂无 ${symbol} 的资讯面分析记录`;
    }
    return renderEntryCollection(symbol, "资讯面分析", entries, formatNewsEntry, limit);
  }

  private async renderAll(symbol: string, limit: number): Promise<string> {
    const [composite, technical, financial, news] = await Promise.all([
      this.compositeAnalysisRepository.listLatest(symbol, limit),
      this.technicalAnalysisRepository.listLatest(symbol, limit),
      this.financialAnalysisRepository.listLatest(symbol, limit),
      this.newsAnalysisRepository.listLatest(symbol, limit),
    ]);
    const legacy = composite.length === 0 || technical.length === 0
      ? await this.getLegacyComposite(symbol)
      : null;

    const sections = [
      composite.length > 0
        ? renderEntryCollection(symbol, "综合分析", composite, formatCompositeEntry, limit)
        : formatLegacyOrEmptyComposite(symbol, legacy, limit),
      technical.length > 0
        ? renderEntryCollection(symbol, "技术面分析", technical, formatTechnicalEntry, limit)
        : formatLegacyOrEmptyTechnical(symbol, legacy, limit),
      financial.length > 0
        ? renderEntryCollection(symbol, "基本面分析", financial, formatFinancialEntry, limit)
        : `⚠️ 暂无 ${symbol} 的基本面分析记录`,
      news.length > 0
        ? renderEntryCollection(symbol, "资讯面分析", news, formatNewsEntry, limit)
        : `⚠️ 暂无 ${symbol} 的资讯面分析记录`,
    ];

    return sections.join("\n\n====================\n\n");
  }

  private async getLegacyComposite(symbol: string): Promise<LegacyCompositeAnalysisView | null> {
    const [analysisLog, keyLevels] = await Promise.all([
      this.analysisLogRepository.getLatest(symbol),
      this.keyLevelsRepository.getBySymbol(symbol),
    ]);
    if (!analysisLog) {
      return null;
    }
    return {
      analysis_date: analysisLog.analysis_date,
      analysis_text: analysisLog.analysis_text,
      structured_ok: analysisLog.structured_ok,
      levels: keyLevels && keyLevels.symbol === symbol ? keyLevels : null,
    };
  }
}

type EntryFormatter<TEntry> = (symbol: string, entry: TEntry) => string;

function formatCompositeEntry(symbol: string, entry: CompositeAnalysisEntry): string {
  const lines = [
    `📝 最近一次综合分析: ${symbol}`,
    `日期: ${entry.analysis_date}`,
    `结构化解析: ${entry.structured_ok ? "成功" : "失败"}`,
    renderScoreLine("综合评分", entry.score),
    renderScoreLine("技术面评分", entry.technical_score),
    renderScoreLine("基本面评分", entry.financial_score),
    renderScoreLine("资讯面评分", entry.news_score),
    `财务倾向: ${renderBias(entry.financial_bias)}`,
    `资讯倾向: ${renderBias(entry.news_bias)}`,
  ];
  if (entry.evidence.financial_mode && entry.evidence.financial_mode !== "none") {
    lines.push(
      `基本面模式: ${entry.evidence.financial_mode}${entry.evidence.financial_source ? ` | 来源=${entry.evidence.financial_source}` : ""}`,
    );
  }
  if (entry.evidence.financial_latest_period_end) {
    lines.push(`最新财报期: ${entry.evidence.financial_latest_period_end}`);
  } else if (entry.evidence.financial_lite_as_of) {
    lines.push(`指标日期: ${entry.evidence.financial_lite_as_of}`);
  }
  if (entry.evidence.news_query) {
    lines.push(`资讯检索: ${entry.evidence.news_query}`);
  }
  lines.push(`资讯条数: ${entry.evidence.news_source_count}`);
  lines.push(...renderLevels(entry));
  lines.push("", entry.analysis_text);
  return lines.join("\n");
}

function formatTechnicalEntry(symbol: string, entry: TechnicalAnalysisEntry): string {
  const lines = [
    `📝 最近一次技术面分析: ${symbol}`,
    `日期: ${entry.analysis_date}`,
    `结构化解析: ${entry.structured_ok ? "成功" : "失败"}`,
    renderScoreLine("技术面评分", entry.score),
    ...renderLevels(entry),
    "",
    entry.analysis_text,
  ];
  return lines.join("\n");
}

function formatFinancialEntry(symbol: string, entry: FinancialAnalysisEntry): string {
  const lines = [
    `📝 最近一次基本面分析: ${symbol}`,
    `日期: ${entry.analysis_date}`,
    renderScoreLine("基本面评分", entry.score),
    `基本面倾向: ${renderBias(entry.bias)}`,
  ];
  if (entry.evidence.mode && entry.evidence.mode !== "none") {
    lines.push(
      `分析模式: ${entry.evidence.mode}${entry.evidence.source ? ` | 来源=${entry.evidence.source}` : ""}`,
    );
  }
  if (entry.evidence.latest_period_end) {
    lines.push(`最新财报期: ${entry.evidence.latest_period_end}`);
  } else if (entry.evidence.lite_as_of) {
    lines.push(`指标日期: ${entry.evidence.lite_as_of}`);
  }
  if (entry.evidence.latest_announce_date) {
    lines.push(`公告日期: ${entry.evidence.latest_announce_date}`);
  }
  if (entry.evidence.mode === "lite") {
    lines.push(
      `指标覆盖: ${entry.evidence.lite_metric_count ?? 0}${entry.evidence.lite_metric_labels && entry.evidence.lite_metric_labels.length > 0 ? ` | ${entry.evidence.lite_metric_labels.join(" / ")}` : ""}`,
    );
    if (entry.evidence.lite_query) {
      lines.push(`拖底检索: ${entry.evidence.lite_query}`);
    }
  } else {
    lines.push(
      `数据覆盖: income=${entry.evidence.income_count}, metrics=${entry.evidence.metrics_count}, cash_flow=${entry.evidence.cash_flow_count}, balance_sheet=${entry.evidence.balance_sheet_count}`,
    );
  }
  if (entry.evidence.note) {
    lines.push(`备注: ${entry.evidence.note}`);
  }
  lines.push(...renderStringSection("优势", entry.strengths));
  lines.push(...renderStringSection("风险", entry.risks));
  lines.push(...renderStringSection("关注点", entry.watch_items));
  lines.push("", entry.analysis_text);
  return lines.join("\n");
}

function formatNewsEntry(symbol: string, entry: NewsAnalysisEntry): string {
  const lines = [
    `📝 最近一次资讯面分析: ${symbol}`,
    `日期: ${entry.analysis_date}`,
    renderScoreLine("资讯面评分", entry.score),
    `资讯倾向: ${renderBias(entry.bias)}`,
    `检索问句: ${entry.query}`,
    `资讯条数: ${entry.source_count}`,
  ];
  lines.push(...renderStringSection("催化因素", entry.catalysts));
  lines.push(...renderStringSection("风险因素", entry.risks));
  lines.push(...renderStringSection("跟踪要点", entry.watch_items));
  if (entry.evidence.documents.length > 0) {
    lines.push("证据快照:");
    entry.evidence.documents.forEach((document, index) => {
      const parts = [document.title];
      if (document.published_at) {
        parts.push(document.published_at);
      }
      if (document.source) {
        parts.push(document.source);
      }
      lines.push(`${index + 1}. ${parts.join(" | ")}`);
    });
  }
  lines.push("", entry.analysis_text);
  return lines.join("\n");
}

function formatLegacyCompositeEntry(symbol: string, entry: LegacyCompositeAnalysisView): string {
  const lines = [
    `📝 最近一次综合分析: ${symbol}`,
    `日期: ${entry.analysis_date}`,
    `结构化解析: ${entry.structured_ok ? "成功" : "失败"}`,
    "来源: legacy analysis_log",
    ...renderLevels(entry.levels),
    "",
    entry.analysis_text,
  ];
  return lines.join("\n");
}

function formatLegacyTechnicalEntry(symbol: string, entry: LegacyCompositeAnalysisView): string {
  const lines = [
    `📝 最近一次技术面分析: ${symbol}`,
    `日期: ${entry.analysis_date}`,
    `结构化解析: ${entry.structured_ok ? "成功" : "失败"}`,
    "来源: legacy key_levels/analysis_log",
    ...renderLevels(entry.levels),
    "",
    entry.analysis_text,
  ];
  return lines.join("\n");
}

function formatLegacyOrEmptyComposite(
  symbol: string,
  legacy: LegacyCompositeAnalysisView | null,
  limit = 1,
): string {
  if (!legacy) {
    return `⚠️ 暂无 ${symbol} 的综合分析记录`;
  }
  if (limit > 1) {
    return [
      `🗂️ 最近 ${limit} 次综合分析: ${symbol}`,
      "返回记录: 1",
      "说明: 当前仅存在 legacy 综合分析记录，历史列表从第二阶段结果表开始累计。",
      "",
      formatLegacyCompositeEntry(symbol, legacy),
    ].join("\n");
  }
  return formatLegacyCompositeEntry(symbol, legacy);
}

function formatLegacyOrEmptyTechnical(
  symbol: string,
  legacy: LegacyCompositeAnalysisView | null,
  limit = 1,
): string {
  if (!legacy) {
    return `⚠️ 暂无 ${symbol} 的技术面分析记录`;
  }
  if (limit > 1) {
    return [
      `🗂️ 最近 ${limit} 次技术面分析: ${symbol}`,
      "返回记录: 1",
      "说明: 当前仅存在 legacy 技术面记录，历史列表从第二阶段结果表开始累计。",
      "",
      formatLegacyTechnicalEntry(symbol, legacy),
    ].join("\n");
  }
  return formatLegacyTechnicalEntry(symbol, legacy);
}

function renderEntryCollection<TEntry>(
  symbol: string,
  title: string,
  entries: TEntry[],
  formatter: EntryFormatter<TEntry>,
  requestedLimit: number,
): string {
  if (entries.length === 1 && requestedLimit <= 1) {
    return formatter(symbol, entries[0]);
  }

  const sections = entries.map((entry, index) =>
    [`[${index + 1}]`, formatter(symbol, entry)].join("\n"),
  );
  return [
    `🗂️ 最近 ${requestedLimit} 次${title}: ${symbol}`,
    `返回记录: ${entries.length}`,
    "",
    sections.join("\n\n--------------------\n\n"),
  ].join("\n");
}

function renderLevels(
  entry:
    | Pick<
        TechnicalAnalysisEntry,
        | "current_price"
        | "stop_loss"
        | "breakthrough"
        | "support"
        | "cost_level"
        | "resistance"
        | "take_profit"
        | "gap"
        | "target"
        | "round_number"
      >
    | KeyLevels
    | null,
): string[] {
  if (!entry) {
    return [];
  }
  const levelRows: Array<[string, number | null | undefined]> = [
    ["当前价格", entry.current_price],
    ["止损位", entry.stop_loss],
    ["突破位", entry.breakthrough],
    ["支撑位", entry.support],
    ["成本位", entry.cost_level],
    ["压力位", entry.resistance],
    ["止盈位", entry.take_profit],
    ["缺口位", entry.gap],
    ["目标位", entry.target],
    ["整数关", entry.round_number],
  ];
  return levelRows
    .filter(([, value]) => value != null)
    .map(([label, value]) => `${label}: ${formatPrice(value)}`);
}

function renderStringSection(title: string, items: string[]): string[] {
  if (items.length === 0) {
    return [];
  }
  return [`${title}:`, ...items.map((item, index) => `${index + 1}. ${item}`)];
}

function renderScoreLine(label: string, score: number | null): string {
  return `${label}: ${score == null ? "暂无" : `${score}/10`}`;
}

function renderBias(bias: AnalysisBias): string {
  if (bias === "positive") {
    return "偏多";
  }
  if (bias === "negative") {
    return "偏空";
  }
  return "中性";
}

function formatPrice(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) {
    return "-";
  }
  return Number(value).toFixed(2);
}
