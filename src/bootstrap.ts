import path from "node:path";

import type { PluginConfig } from "./config/schema.js";
import { supportsUniverseAccess } from "./config/tickflow-access.js";
import { TickFlowClient } from "./services/tickflow-client.js";
import { InstrumentService } from "./services/instrument-service.js";
import { KlineService } from "./services/kline-service.js";
import { IndicatorService } from "./services/indicator-service.js";
import { FinancialService } from "./services/financial-service.js";
import { FinancialLiteService } from "./services/financial-lite-service.js";
import { MxApiService } from "./services/mx-search-service.js";
import { Jin10McpService } from "./services/jin10-mcp-service.js";
import { Database } from "./storage/db.js";
import { WatchlistRepository } from "./storage/repositories/watchlist-repo.js";
import { KlinesRepository } from "./storage/repositories/klines-repo.js";
import { IntradayKlinesRepository } from "./storage/repositories/intraday-klines-repo.js";
import { IndicatorsRepository } from "./storage/repositories/indicators-repo.js";
import { KeyLevelsRepository } from "./storage/repositories/key-levels-repo.js";
import { KeyLevelsHistoryRepository } from "./storage/repositories/key-levels-history-repo.js";
import { AnalysisLogRepository } from "./storage/repositories/analysis-log-repo.js";
import { AlertLogRepository } from "./storage/repositories/alert-log-repo.js";
import { TechnicalAnalysisRepository } from "./storage/repositories/technical-analysis-repo.js";
import { FinancialAnalysisRepository } from "./storage/repositories/financial-analysis-repo.js";
import { NewsAnalysisRepository } from "./storage/repositories/news-analysis-repo.js";
import { CompositeAnalysisRepository } from "./storage/repositories/composite-analysis-repo.js";
import { Jin10FlashRepository } from "./storage/repositories/jin10-flash-repo.js";
import { Jin10FlashDeliveryRepository } from "./storage/repositories/jin10-flash-delivery-repo.js";
import { UniverseRepository } from "./storage/repositories/universe-repo.js";
import { UniverseMembershipRepository } from "./storage/repositories/universe-membership-repo.js";
import { WatchlistService } from "./services/watchlist-service.js";
import { WatchlistProfileService } from "./services/watchlist-profile-service.js";
import { AnalysisService } from "./services/analysis-service.js";
import { AnalysisViewService } from "./services/analysis-view-service.js";
import { QuoteService } from "./services/quote-service.js";
import { TradingCalendarService } from "./services/trading-calendar-service.js";
import { MonitorService } from "./services/monitor-service.js";
import { Jin10FlashMonitorService } from "./services/jin10-flash-monitor-service.js";
import { AlertService } from "./services/alert-service.js";
import { AlertMediaService } from "./services/alert-media-service.js";
import { UpdateService } from "./services/update-service.js";
import { KeyLevelsBacktestService } from "./services/key-levels-backtest-service.js";
import { PostCloseReviewService } from "./services/post-close-review-service.js";
import { PreMarketBriefService } from "./services/pre-market-brief-service.js";
import { ReviewMemoryService } from "./services/review-memory-service.js";
import { TickFlowUniverseService } from "./services/tickflow-universe-service.js";
import { IndustryPeerService } from "./services/industry-peer-service.js";
import { CompositeAnalysisOrchestrator } from "./analysis/orchestrators/composite-analysis.orchestrator.js";
import { MarketAnalysisProvider } from "./analysis/providers/market-analysis.provider.js";
import { FinancialAnalysisProvider } from "./analysis/providers/financial-analysis.provider.js";
import { NewsAnalysisProvider } from "./analysis/providers/news-analysis.provider.js";
import { KlineTechnicalSignalTask } from "./analysis/tasks/kline-technical-signal.task.js";
import { FinancialFundamentalTask } from "./analysis/tasks/financial-fundamental.task.js";
import { FinancialFundamentalLiteTask } from "./analysis/tasks/financial-fundamental-lite.task.js";
import { NewsCatalystTask } from "./analysis/tasks/news-catalyst.task.js";
import { CompositeStockAnalysisTask } from "./analysis/tasks/composite-stock-analysis.task.js";
import { PostCloseReviewTask } from "./analysis/tasks/post-close-review.task.js";
import { addStockTool } from "./tools/add-stock.tool.js";
import { analyzeTool } from "./tools/analyze.tool.js";
import { fetchKlinesTool } from "./tools/fetch-klines.tool.js";
import { fetchIntradayKlinesTool } from "./tools/fetch-intraday-klines.tool.js";
import { fetchFinancialsTool } from "./tools/fetch-financials.tool.js";
import { flashMonitorStatusTool } from "./tools/flash-monitor-status.tool.js";
import { mxDataTool } from "./tools/mx-data.tool.js";
import { mxSearchTool } from "./tools/mx-search.tool.js";
import { mxSelectStockTool } from "./tools/mx-select-stock.tool.js";
import {
  listEastmoneyWatchlistTool,
  pushEastmoneyWatchlistTool,
  removeEastmoneyWatchlistTool,
  syncEastmoneyWatchlistTool,
} from "./tools/eastmoney-watchlist.tool.js";
import { listWatchlistTool } from "./tools/list-watchlist.tool.js";
import { dailyUpdateStatusTool } from "./tools/daily-update-status.tool.js";
import { monitorStatusTool } from "./tools/monitor-status.tool.js";
import { refreshWatchlistNamesTool } from "./tools/refresh-watchlist-names.tool.js";
import { refreshWatchlistProfilesTool } from "./tools/refresh-watchlist-profiles.tool.js";
import { queryDatabaseTool } from "./tools/query-database.tool.js";
import { removeStockTool } from "./tools/remove-stock.tool.js";
import { screenStockCandidatesTool } from "./tools/screen-stock-candidates.tool.js";
import { startDailyUpdateTool } from "./tools/start-daily-update.tool.js";
import { startMonitorTool } from "./tools/start-monitor.tool.js";
import { stopDailyUpdateTool } from "./tools/stop-daily-update.tool.js";
import { stopMonitorTool } from "./tools/stop-monitor.tool.js";
import { testAlertTool } from "./tools/test-alert.tool.js";
import { updateAllTool } from "./tools/update-all.tool.js";
import { viewAnalysisTool } from "./tools/view-analysis.tool.js";
import { backtestKeyLevelsTool } from "./tools/backtest-key-levels.tool.js";
import type {
  LocalTool,
  OpenClawPluginConfig,
  OpenClawPluginRuntime,
  RegisteredService,
} from "./runtime/plugin-api.js";
import { createCommandRunner } from "./runtime/command-runner.js";
import { resolvePreferredOpenClawTmpDir } from "./runtime/openclaw-temp-dir.js";
import { RealtimeMonitorWorker } from "./background/realtime-monitor.worker.js";
import { DailyUpdateWorker } from "./background/daily-update.worker.js";
import { Jin10FlashWorker } from "./background/jin10-flash.worker.js";
import type { WatchlistItem } from "./types/domain.js";
import { createAlertDiagnosticLogger } from "./utils/alert-diagnostic-log.js";

export interface AppContext {
  config: PluginConfig;
  tools: LocalTool[];
  backgroundServices: RegisteredService[];
  runtime: {
    configSource: "openclaw_plugin" | "local_config";
    pluginManagedServices: boolean;
    openclawConfig?: OpenClawPluginConfig;
    pluginRuntime?: OpenClawPluginRuntime;
  };
  services: {
    alertService: AlertService;
    alertMediaService: AlertMediaService;
    monitorService: MonitorService;
    jin10FlashMonitorService: Jin10FlashMonitorService;
    realtimeMonitorWorker: RealtimeMonitorWorker;
    jin10FlashWorker: Jin10FlashWorker;
    dailyUpdateWorker: DailyUpdateWorker;
    watchlistService: WatchlistService;
    database: Database;
  };
}

export function createAppContext(
  config: PluginConfig,
  options: {
    pluginManagedServices?: boolean;
    configSource?: "openclaw_plugin" | "local_config";
    openclawConfig?: OpenClawPluginConfig;
    pluginRuntime?: OpenClawPluginRuntime;
  } = {},
): AppContext {
  const runtime = {
    configSource: options.configSource ?? "local_config",
    pluginManagedServices: options.pluginManagedServices ?? false,
    openclawConfig: options.openclawConfig,
    pluginRuntime: options.pluginRuntime,
  };
  const runCommandWithTimeout = createCommandRunner(runtime.pluginRuntime);
  const tickflowClient = new TickFlowClient(config.tickflowApiUrl, config.tickflowApiKey);
  const database = new Database(config.databasePath);
  const watchlistRepository = new WatchlistRepository(database);
  const klinesRepository = new KlinesRepository(database);
  const intradayKlinesRepository = new IntradayKlinesRepository(database);
  const indicatorsRepository = new IndicatorsRepository(database);
  const keyLevelsRepository = new KeyLevelsRepository(database);
  const keyLevelsHistoryRepository = new KeyLevelsHistoryRepository(database);
  const analysisLogRepository = new AnalysisLogRepository(database);
  const alertLogRepository = new AlertLogRepository(database);
  const technicalAnalysisRepository = new TechnicalAnalysisRepository(database);
  const financialAnalysisRepository = new FinancialAnalysisRepository(database);
  const newsAnalysisRepository = new NewsAnalysisRepository(database);
  const compositeAnalysisRepository = new CompositeAnalysisRepository(database);
  const jin10FlashRepository = new Jin10FlashRepository(database);
  const jin10FlashDeliveryRepository = new Jin10FlashDeliveryRepository(database);
  const universeRepository = new UniverseRepository(database);
  const universeMembershipRepository = new UniverseMembershipRepository(database);
  const instrumentService = new InstrumentService(tickflowClient);
  const klineService = new KlineService(tickflowClient);
  const quoteService = new QuoteService(tickflowClient);
  const financialService = new FinancialService(tickflowClient);
  const mxApiService = new MxApiService(config.mxSearchApiUrl, config.mxSearchApiKey);
  const jin10McpService = new Jin10McpService(config.jin10McpUrl, config.jin10ApiToken);
  const financialLiteService = new FinancialLiteService(mxApiService);
  const analysisService = new AnalysisService(
    config.llmBaseUrl,
    config.llmApiKey,
    config.llmModel,
    analysisLogRepository,
  );
  const tickFlowUniverseService = supportsUniverseAccess(config.tickflowApiKeyLevel)
    ? new TickFlowUniverseService(
      tickflowClient,
      universeRepository,
      universeMembershipRepository,
    )
    : null;
  const watchlistProfileService = new WatchlistProfileService(
    tickFlowUniverseService,
    mxApiService,
    analysisService,
  );
  const tradingCalendarService = new TradingCalendarService(config.calendarFile);
  const alertDiagnosticLogger = createAlertDiagnosticLogger(config.databasePath);
  const alertService = new AlertService({
    openclawCliBin: config.openclawCliBin,
    channel: config.alertChannel,
    account: config.alertAccount,
    target: config.alertTarget,
    runtime:
      runtime.openclawConfig && runtime.pluginRuntime
        ? {
            config: runtime.openclawConfig,
            runtime: runtime.pluginRuntime,
          }
        : undefined,
    diagnosticLogger: alertDiagnosticLogger,
  });
  const alertMediaService = new AlertMediaService(
    config.databasePath,
    undefined,
    undefined,
    resolveAlertMediaTempRootDir(),
  );
  const indicatorService = new IndicatorService(
    config.pythonBin,
    config.pythonArgs,
    config.pythonWorkdir,
    runCommandWithTimeout,
  );
  const watchlistService = new WatchlistService(
    watchlistRepository,
    instrumentService,
    watchlistProfileService,
  );
  const keyLevelsBacktestService = new KeyLevelsBacktestService(
    keyLevelsHistoryRepository,
    klinesRepository,
    intradayKlinesRepository,
    watchlistService,
  );
  const reviewMemoryService = new ReviewMemoryService(keyLevelsBacktestService);
  const analysisViewService = new AnalysisViewService(
    analysisLogRepository,
    keyLevelsRepository,
    technicalAnalysisRepository,
    financialAnalysisRepository,
    newsAnalysisRepository,
    compositeAnalysisRepository,
  );
  const marketAnalysisProvider = new MarketAnalysisProvider(
    config.tickflowApiKeyLevel,
    watchlistService,
    klineService,
    quoteService,
    indicatorService,
    reviewMemoryService,
    tradingCalendarService,
    klinesRepository,
    intradayKlinesRepository,
    indicatorsRepository,
  );
  const financialAnalysisProvider = new FinancialAnalysisProvider(
    config.tickflowApiKeyLevel,
    financialService,
    financialLiteService,
  );
  const newsAnalysisProvider = new NewsAnalysisProvider(mxApiService);
  const klineTechnicalSignalTask = new KlineTechnicalSignalTask();
  const financialFundamentalTask = new FinancialFundamentalTask();
  const financialFundamentalLiteTask = new FinancialFundamentalLiteTask();
  const newsCatalystTask = new NewsCatalystTask();
  const postCloseReviewTask = new PostCloseReviewTask();
  const compositeStockAnalysisTask = new CompositeStockAnalysisTask(
    keyLevelsRepository,
    analysisLogRepository,
  );
  const compositeAnalysisOrchestrator = new CompositeAnalysisOrchestrator(
    analysisService,
    marketAnalysisProvider,
    financialAnalysisProvider,
    newsAnalysisProvider,
    klineTechnicalSignalTask,
    financialFundamentalTask,
    financialFundamentalLiteTask,
    newsCatalystTask,
    compositeStockAnalysisTask,
    technicalAnalysisRepository,
    financialAnalysisRepository,
    newsAnalysisRepository,
    compositeAnalysisRepository,
  );
  const monitorService = new MonitorService(
    config.databasePath,
    config.requestInterval,
    config.alertChannel,
    watchlistService,
    quoteService,
    tradingCalendarService,
    keyLevelsRepository,
    alertLogRepository,
    klinesRepository,
    intradayKlinesRepository,
    klineService,
    alertService,
    alertMediaService,
    alertDiagnosticLogger,
  );
  const jin10FlashMonitorService = new Jin10FlashMonitorService(
    config.databasePath,
    config.jin10FlashPollInterval,
    config.jin10FlashRetentionDays,
    config.jin10FlashNightAlert,
    watchlistService,
    jin10McpService,
    analysisService,
    alertService,
    jin10FlashRepository,
    jin10FlashDeliveryRepository,
  );
  const updateService = new UpdateService(
    klineService,
    config.tickflowApiKeyLevel,
    indicatorService,
    klinesRepository,
    indicatorsRepository,
    intradayKlinesRepository,
    watchlistService,
    tradingCalendarService,
  );
  const industryPeerService = new IndustryPeerService(
    tickFlowUniverseService,
    quoteService,
  );
  const postCloseReviewService = new PostCloseReviewService(
    watchlistService,
    compositeAnalysisOrchestrator,
    analysisService,
    postCloseReviewTask,
    keyLevelsRepository,
    keyLevelsHistoryRepository,
    klinesRepository,
    intradayKlinesRepository,
    jin10FlashDeliveryRepository,
    jin10FlashRepository,
    industryPeerService,
  );
  const preMarketBriefService = new PreMarketBriefService(
    watchlistService,
    jin10McpService,
    jin10FlashRepository,
    analysisService,
  );
  const realtimeMonitorWorker = new RealtimeMonitorWorker(
    monitorService,
    config.requestInterval * 1000,
  );
  const jin10FlashWorker = new Jin10FlashWorker(
    jin10FlashMonitorService,
    config.jin10FlashPollInterval * 1000,
  );
  const dailyUpdateWorker = new DailyUpdateWorker(
    updateService,
    preMarketBriefService,
    postCloseReviewService,
    tradingCalendarService,
    config.databasePath,
    alertService,
    config.dailyUpdateNotify,
    runtime.configSource,
  );
  let managedLoopAbortController: AbortController | null = null;
  let managedLoopPromise: Promise<void> | null = null;

  return {
    config,
    tools: [
      addStockTool(
        config.tickflowApiKeyLevel,
        watchlistService,
        klineService,
        klinesRepository,
        indicatorService,
        indicatorsRepository,
      ),
      analyzeTool(compositeAnalysisOrchestrator),
      backtestKeyLevelsTool(keyLevelsBacktestService),
      dailyUpdateStatusTool(dailyUpdateWorker, runtime.configSource),
      fetchIntradayKlinesTool(
        config.tickflowApiKeyLevel,
        klineService,
        intradayKlinesRepository,
        tradingCalendarService,
      ),
      fetchFinancialsTool(financialService),
      flashMonitorStatusTool(jin10FlashMonitorService),
      fetchKlinesTool(klineService, klinesRepository, indicatorService, indicatorsRepository),
      listWatchlistTool(watchlistService),
      listEastmoneyWatchlistTool(mxApiService),
      monitorStatusTool(monitorService),
      mxDataTool(mxApiService),
      mxSearchTool(mxApiService),
      mxSelectStockTool(mxApiService),
      pushEastmoneyWatchlistTool(mxApiService, watchlistService),
      queryDatabaseTool(database),
      refreshWatchlistNamesTool(watchlistService),
      refreshWatchlistProfilesTool(config.tickflowApiKeyLevel, watchlistService),
      removeEastmoneyWatchlistTool(mxApiService),
      removeStockTool(watchlistService),
      screenStockCandidatesTool(
        config.tickflowApiKeyLevel,
        mxApiService,
        quoteService,
        klineService,
        financialService,
        watchlistService,
        analysisService,
      ),
      startDailyUpdateTool(dailyUpdateWorker, config, runtime.configSource, runtime),
      startMonitorTool(monitorService, runtime),
      syncEastmoneyWatchlistTool(mxApiService, watchlistService),
      stopDailyUpdateTool(dailyUpdateWorker, runtime),
      stopMonitorTool(monitorService, runtime),
      testAlertTool(alertService, alertMediaService, runtime.configSource),
      updateAllTool(dailyUpdateWorker),
      viewAnalysisTool(analysisViewService),
    ],
    backgroundServices: [
      {
        id: "tickflow-assist.managed-loop",
        start: async () => {
          if (managedLoopAbortController) {
            return;
          }

          const abortController = new AbortController();
          managedLoopAbortController = abortController;

          await dailyUpdateWorker.bindManagedServiceRuntime(runtime.configSource);
          await monitorService.bindManagedServiceRuntime();

          managedLoopPromise = Promise.all([
            dailyUpdateWorker
              .runLoop(abortController.signal, "plugin_service", runtime.configSource)
              .catch(() => {}),
            jin10FlashWorker
              .runLoop(abortController.signal, "plugin_service")
              .catch(() => {}),
            realtimeMonitorWorker
              .runLoop(abortController.signal, "plugin_service")
              .catch(() => {}),
          ]).then(() => undefined);
        },
        stop: async () => {
          const abortController = managedLoopAbortController;
          const runPromise = managedLoopPromise;
          managedLoopAbortController = null;
          managedLoopPromise = null;

          if (!abortController) {
            return;
          }

          abortController.abort();
          await runPromise;
        },
      },
    ],
    runtime,
    services: {
      alertService,
      alertMediaService,
      monitorService,
      jin10FlashMonitorService,
      realtimeMonitorWorker,
      jin10FlashWorker,
      dailyUpdateWorker,
      watchlistService,
      database,
    },
  };
}

function resolveAlertMediaTempRootDir(): string {
  // OpenClaw 2026.3.31 no longer widens local media roots from tool-created files.
  // Keep PNG alerts under the shared OpenClaw temp root so both runtime sends and
  // `openclaw message send --media ...` can read them without extra allowlist config.
  return path.join(
    resolvePreferredOpenClawTmpDir(),
    "tickflow-assist",
    "alert-media",
    "tmp",
  );
}

export interface WatchlistDebugSnapshot {
  databasePath: string;
  calendarFile: string;
  requestInterval: number;
  configSource: "openclaw_plugin" | "local_config";
  pid: number;
  watchlistTableExists: boolean;
  watchlistCount: number;
  watchlistPreview: WatchlistItem[];
}

export async function buildWatchlistDebugSnapshot(app: AppContext): Promise<WatchlistDebugSnapshot> {
  const watchlistTableExists = await app.services.database.hasTable("watchlist");
  const watchlistPreview = await app.services.watchlistService.list();

  return {
    databasePath: app.config.databasePath,
    calendarFile: app.config.calendarFile,
    requestInterval: app.config.requestInterval,
    configSource: app.runtime.configSource,
    pid: process.pid,
    watchlistTableExists,
    watchlistCount: watchlistPreview.length,
    watchlistPreview: watchlistPreview.slice(0, 5),
  };
}
