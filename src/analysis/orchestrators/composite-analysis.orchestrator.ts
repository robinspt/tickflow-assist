import { AnalysisService } from "../../services/analysis-service.js";
import type { FinancialLiteSnapshot } from "../../services/financial-lite-service.js";
import {
  type AnalysisLevelsSnapshot,
  type CompositeAnalysisEntry,
  type FinancialAnalysisEntry,
  type NewsAnalysisEntry,
  type TechnicalAnalysisEntry,
} from "../../types/domain.js";
import { formatChinaDateTime } from "../../utils/china-time.js";
import { CompositeAnalysisRepository } from "../../storage/repositories/composite-analysis-repo.js";
import { FinancialAnalysisRepository } from "../../storage/repositories/financial-analysis-repo.js";
import { NewsAnalysisRepository } from "../../storage/repositories/news-analysis-repo.js";
import { TechnicalAnalysisRepository } from "../../storage/repositories/technical-analysis-repo.js";
import type { FinancialSnapshot } from "../../services/financial-service.js";
import { FinancialAnalysisProvider } from "../providers/financial-analysis.provider.js";
import { MarketAnalysisProvider } from "../providers/market-analysis.provider.js";
import { NewsAnalysisProvider } from "../providers/news-analysis.provider.js";
import { CompositeStockAnalysisTask } from "../tasks/composite-stock-analysis.task.js";
import {
  FinancialFundamentalTask,
  buildFinancialFallbackResult,
} from "../tasks/financial-fundamental.task.js";
import { FinancialFundamentalLiteTask } from "../tasks/financial-fundamental-lite.task.js";
import { KlineTechnicalSignalTask } from "../tasks/kline-technical-signal.task.js";
import { NewsCatalystTask, buildNewsFallbackResult } from "../tasks/news-catalyst.task.js";
import type { AnalysisStepTask } from "../tasks/analysis-step-task.js";
import type {
  CompositeAnalysisInput,
  CompositeAnalysisResult,
  FinancialAnalysisContext,
  FinancialInsightResult,
  NewsInsightResult,
  TechnicalSignalResult,
} from "../types/composite-analysis.js";

export class CompositeAnalysisOrchestrator {
  constructor(
    private readonly analysisService: AnalysisService,
    private readonly marketProvider: MarketAnalysisProvider,
    private readonly financialProvider: FinancialAnalysisProvider,
    private readonly newsProvider: NewsAnalysisProvider,
    private readonly technicalTask: KlineTechnicalSignalTask,
    private readonly financialTask: FinancialFundamentalTask,
    private readonly financialLiteTask: FinancialFundamentalLiteTask,
    private readonly newsTask: NewsCatalystTask,
    private readonly compositeTask: CompositeStockAnalysisTask,
    private readonly technicalAnalysisRepository: TechnicalAnalysisRepository,
    private readonly financialAnalysisRepository: FinancialAnalysisRepository,
    private readonly newsAnalysisRepository: NewsAnalysisRepository,
    private readonly compositeAnalysisRepository: CompositeAnalysisRepository,
  ) {}

  async buildInput(symbol: string): Promise<CompositeAnalysisInput> {
    const market = await this.marketProvider.load(symbol);
    const [financial, news] = await Promise.all([
      this.financialProvider.load(symbol, market.companyName),
      this.newsProvider.load(symbol, market.companyName, market.watchlistItem),
    ]);

    const technicalPromise = this.runStep(this.technicalTask, market);
    const financialPromise = financial.available
      ? financial.mode === "lite"
        ? this.runStep(this.financialLiteTask, financial)
        : this.runStep(this.financialTask, financial)
      : Promise.resolve(buildFinancialFallbackResult());
    const newsPromise = news.available
      ? this.runStep(this.newsTask, news)
      : Promise.resolve(buildNewsFallbackResult());

    const [technicalResult, financialResult, newsResult] = await Promise.all([
      technicalPromise,
      financialPromise,
      newsPromise,
    ]);

    return {
      market,
      financial,
      news,
      technicalResult,
      financialResult,
      newsResult,
    };
  }

  async analyze(symbol: string): Promise<CompositeAnalysisResult> {
    const input = await this.buildInput(symbol);
    return this.analyzeInput(input);
  }

  async analyzeInput(compositeInput: CompositeAnalysisInput): Promise<CompositeAnalysisResult> {
    const analysisDate = formatChinaDateTime().slice(0, 10);
    await Promise.all([
      this.technicalAnalysisRepository.append(
        buildTechnicalAnalysisEntry(compositeInput.market.symbol, analysisDate, compositeInput.technicalResult),
      ),
      this.financialAnalysisRepository.append(
        buildFinancialAnalysisEntry(analysisDate, compositeInput.financial, compositeInput.financialResult),
      ),
      this.newsAnalysisRepository.append(
        buildNewsAnalysisEntry(analysisDate, compositeInput.news, compositeInput.newsResult),
      ),
    ]);

    const result = await this.analysisService.runTask(this.compositeTask, compositeInput);

    await this.compositeAnalysisRepository.append(
      buildCompositeAnalysisEntry(analysisDate, compositeInput, result),
    );

    return result;
  }

  formatForUser(result: CompositeAnalysisResult): string {
    return this.compositeTask.formatForUser(result);
  }

  private async runStep<TInput, TResult>(
    task: AnalysisStepTask<TInput, TResult>,
    input: TInput,
  ): Promise<TResult> {
    const prepared = await task.prepare(input);
    const analysisText = await this.analysisService.generateText(
      prepared.systemPrompt,
      prepared.userPrompt,
    );
    return task.parseResult(analysisText, input);
  }
}

function buildTechnicalAnalysisEntry(
  symbol: string,
  analysisDate: string,
  result: TechnicalSignalResult,
): TechnicalAnalysisEntry {
  return {
    symbol,
    analysis_date: analysisDate,
    analysis_text: result.analysisText,
    structured_ok: result.levels != null,
    ...toLevelsSnapshot(result.levels),
  };
}

function buildFinancialAnalysisEntry(
  analysisDate: string,
  context: FinancialAnalysisContext,
  result: FinancialInsightResult,
): FinancialAnalysisEntry {
  const evidence = buildFinancialEvidence(context);
  return {
    symbol: context.symbol,
    analysis_date: analysisDate,
    analysis_text: result.analysisText,
    score: normalizeScore(result.score),
    bias: result.bias,
    strengths: result.strengths,
    risks: result.risks,
    watch_items: result.watchItems,
    evidence,
  };
}

function buildNewsAnalysisEntry(
  analysisDate: string,
  context: import("../types/composite-analysis.js").NewsAnalysisContext,
  result: NewsInsightResult,
): NewsAnalysisEntry {
  return {
    symbol: context.symbol,
    analysis_date: analysisDate,
    query: context.query,
    analysis_text: result.analysisText,
    score: normalizeScore(result.score),
    bias: result.bias,
    catalysts: result.catalysts,
    risks: result.risks,
    watch_items: result.watchItems,
    source_count: context.documents.length,
    evidence: {
      available: context.available,
      source_count: context.documents.length,
      documents: context.documents.slice(0, 5).map((document) => ({
        title: document.title,
        source: document.source,
        published_at: document.publishedAt,
        securities: document.secuList
          .map((security) => [security.secuCode, security.secuName].filter(Boolean).join(":"))
          .filter(Boolean),
      })),
    },
  };
}

function buildCompositeAnalysisEntry(
  analysisDate: string,
  input: import("../types/composite-analysis.js").CompositeAnalysisInput,
  result: CompositeAnalysisResult,
): CompositeAnalysisEntry {
  return {
    symbol: input.market.symbol,
    analysis_date: analysisDate,
    analysis_text: result.analysisText,
    structured_ok: result.levels != null,
    ...toLevelsSnapshot(result.levels),
    technical_score: normalizeScore(input.technicalResult.levels?.score ?? null),
    financial_score: normalizeScore(input.financialResult.score),
    news_score: normalizeScore(input.newsResult.score),
    financial_bias: input.financialResult.bias,
    news_bias: input.newsResult.bias,
    evidence: {
      technical_structured: input.technicalResult.levels != null,
      financial_available: input.financial.available,
      financial_mode: input.financial.mode,
      financial_source: input.financial.source,
      financial_latest_period_end: getLatestFinancialPeriodEnd(input.financial.snapshot),
      financial_lite_as_of: input.financial.liteSnapshot?.asOf ?? null,
      news_available: input.news.available,
      news_query: input.news.query,
      news_source_count: input.news.documents.length,
    },
  };
}

function buildFinancialEvidence(context: FinancialAnalysisContext) {
  const latest = getLatestFinancialMeta(context.snapshot);
  return {
    available: context.available,
    mode: context.mode,
    source: context.source,
    note: context.note,
    latest_period_end: latest.periodEnd,
    latest_announce_date: latest.announceDate,
    income_count: context.snapshot?.income.length ?? 0,
    metrics_count: context.snapshot?.metrics.length ?? 0,
    cash_flow_count: context.snapshot?.cashFlow.length ?? 0,
    balance_sheet_count: context.snapshot?.balanceSheet.length ?? 0,
    lite_as_of: context.liteSnapshot?.asOf ?? null,
    lite_query: context.liteSnapshot?.query ?? null,
    lite_metric_count: context.liteSnapshot?.metrics.length ?? 0,
    lite_metric_labels: buildLiteMetricLabels(context.liteSnapshot),
  };
}

function getLatestFinancialMeta(snapshot: FinancialSnapshot | null): {
  periodEnd: string | null;
  announceDate: string | null;
} {
  if (!snapshot) {
    return {
      periodEnd: null,
      announceDate: null,
    };
  }

  const records = [
    ...snapshot.metrics,
    ...snapshot.income,
    ...snapshot.cashFlow,
    ...snapshot.balanceSheet,
  ];
  const latest = records
    .filter((record) => Boolean(record.period_end))
    .sort((left, right) => right.period_end.localeCompare(left.period_end))[0];

  return {
    periodEnd: latest?.period_end ?? null,
    announceDate: latest?.announce_date ?? null,
  };
}

function getLatestFinancialPeriodEnd(snapshot: FinancialSnapshot | null): string | null {
  return getLatestFinancialMeta(snapshot).periodEnd;
}

function buildLiteMetricLabels(snapshot: FinancialLiteSnapshot | null): string[] {
  if (!snapshot) {
    return [];
  }
  return snapshot.metrics.map((metric) => metric.label).slice(0, 8);
}

function toLevelsSnapshot(
  levels: import("../../types/domain.js").KeyLevels | null,
): AnalysisLevelsSnapshot {
  return {
    current_price: toNullableNumber(levels?.current_price),
    stop_loss: toNullableNumber(levels?.stop_loss),
    breakthrough: toNullableNumber(levels?.breakthrough),
    support: toNullableNumber(levels?.support),
    cost_level: toNullableNumber(levels?.cost_level),
    resistance: toNullableNumber(levels?.resistance),
    take_profit: toNullableNumber(levels?.take_profit),
    gap: toNullableNumber(levels?.gap),
    target: toNullableNumber(levels?.target),
    round_number: toNullableNumber(levels?.round_number),
    score: normalizeScore(levels?.score ?? null),
  };
}

function toNullableNumber(value: number | null | undefined): number | null {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizeScore(value: number | null | undefined): number | null {
  if (!Number.isFinite(Number(value))) {
    return null;
  }
  return Math.trunc(Number(value));
}
