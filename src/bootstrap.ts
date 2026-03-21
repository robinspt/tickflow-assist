import type { PluginConfig } from "./config/schema.js";
import { TickFlowClient } from "./services/tickflow-client.js";
import { InstrumentService } from "./services/instrument-service.js";
import { KlineService } from "./services/kline-service.js";
import { IndicatorService } from "./services/indicator-service.js";
import { FinancialService } from "./services/financial-service.js";
import { FinancialLiteService } from "./services/financial-lite-service.js";
import { MxApiService } from "./services/mx-search-service.js";
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
import { WatchlistService } from "./services/watchlist-service.js";
import { WatchlistProfileService } from "./services/watchlist-profile-service.js";
import { AnalysisService } from "./services/analysis-service.js";
import { AnalysisViewService } from "./services/analysis-view-service.js";
import { QuoteService } from "./services/quote-service.js";
import { TradingCalendarService } from "./services/trading-calendar-service.js";
import { MonitorService } from "./services/monitor-service.js";
import { AlertService } from "./services/alert-service.js";
import { UpdateService } from "./services/update-service.js";
import { KeyLevelsBacktestService } from "./services/key-levels-backtest-service.js";
import { PostCloseReviewService } from "./services/post-close-review-service.js";
import { ReviewMemoryService } from "./services/review-memory-service.js";
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
import { mxSearchTool } from "./tools/mx-search.tool.js";
import { mxSelectStockTool } from "./tools/mx-select-stock.tool.js";
import { listWatchlistTool } from "./tools/list-watchlist.tool.js";
import { dailyUpdateStatusTool } from "./tools/daily-update-status.tool.js";
import { monitorStatusTool } from "./tools/monitor-status.tool.js";
import { refreshWatchlistNamesTool } from "./tools/refresh-watchlist-names.tool.js";
import { refreshWatchlistProfilesTool } from "./tools/refresh-watchlist-profiles.tool.js";
import { queryDatabaseTool } from "./tools/query-database.tool.js";
import { removeStockTool } from "./tools/remove-stock.tool.js";
import { startDailyUpdateTool } from "./tools/start-daily-update.tool.js";
import { startMonitorTool } from "./tools/start-monitor.tool.js";
import { stopDailyUpdateTool } from "./tools/stop-daily-update.tool.js";
import { stopMonitorTool } from "./tools/stop-monitor.tool.js";
import { testAlertTool } from "./tools/test-alert.tool.js";
import { updateAllTool } from "./tools/update-all.tool.js";
import { viewAnalysisTool } from "./tools/view-analysis.tool.js";
import { backtestKeyLevelsTool } from "./tools/backtest-key-levels.tool.js";
import type { LocalTool, RegisteredService } from "./runtime/plugin-api.js";
import { RealtimeMonitorWorker } from "./background/realtime-monitor.worker.js";
import { DailyUpdateWorker } from "./background/daily-update.worker.js";
import type { WatchlistItem } from "./types/domain.js";

export interface AppContext {
  config: PluginConfig;
  tools: LocalTool[];
  backgroundServices: RegisteredService[];
  runtime: {
    configSource: "openclaw_plugin" | "local_config";
    pluginManagedServices: boolean;
  };
  services: {
    alertService: AlertService;
    monitorService: MonitorService;
    realtimeMonitorWorker: RealtimeMonitorWorker;
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
  } = {},
): AppContext {
  const runtime = {
    configSource: options.configSource ?? "local_config",
    pluginManagedServices: options.pluginManagedServices ?? false,
  };
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
  const instrumentService = new InstrumentService(tickflowClient);
  const klineService = new KlineService(tickflowClient);
  const quoteService = new QuoteService(tickflowClient);
  const financialService = new FinancialService(tickflowClient);
  const mxApiService = new MxApiService(config.mxSearchApiUrl, config.mxSearchApiKey);
  const financialLiteService = new FinancialLiteService(mxApiService);
  const watchlistProfileService = new WatchlistProfileService(mxApiService);
  const tradingCalendarService = new TradingCalendarService(config.calendarFile);
  const alertService = new AlertService(
    config.openclawCliBin,
    config.alertChannel,
    config.alertAccount,
    config.alertTarget,
  );
  const indicatorService = new IndicatorService(
    config.pythonBin,
    config.pythonArgs,
    config.pythonWorkdir,
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
  const analysisService = new AnalysisService(
    config.llmBaseUrl,
    config.llmApiKey,
    config.llmModel,
    analysisLogRepository,
  );
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
    alertService,
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
  const postCloseReviewService = new PostCloseReviewService(
    watchlistService,
    compositeAnalysisOrchestrator,
    analysisService,
    postCloseReviewTask,
    keyLevelsRepository,
    keyLevelsHistoryRepository,
    klinesRepository,
    intradayKlinesRepository,
  );
  const realtimeMonitorWorker = new RealtimeMonitorWorker(
    monitorService,
    config.requestInterval * 1000,
  );
  const dailyUpdateWorker = new DailyUpdateWorker(
    updateService,
    postCloseReviewService,
    config.databasePath,
    alertService,
    config.dailyUpdateNotify,
    runtime.configSource,
    config.calendarFile,
  );

  return {
    config,
    tools: [
      addStockTool(
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
      fetchKlinesTool(klineService, klinesRepository, indicatorService, indicatorsRepository),
      listWatchlistTool(watchlistService),
      monitorStatusTool(monitorService),
      mxSearchTool(mxApiService),
      mxSelectStockTool(mxApiService),
      queryDatabaseTool(database),
      refreshWatchlistNamesTool(watchlistService),
      refreshWatchlistProfilesTool(watchlistService),
      removeStockTool(watchlistService),
      startDailyUpdateTool(dailyUpdateWorker, config, runtime.configSource, runtime),
      startMonitorTool(monitorService, runtime),
      stopDailyUpdateTool(dailyUpdateWorker, runtime),
      stopMonitorTool(monitorService, runtime),
      testAlertTool(alertService),
      updateAllTool(dailyUpdateWorker),
      viewAnalysisTool(analysisViewService),
    ],
    backgroundServices: [
      {
        id: "tickflow-assist.managed-loop",
        description: "Run TickFlow daily-update scheduler and realtime monitor concurrently.",
        start: async ({ signal }) => {
          await dailyUpdateWorker.bindManagedServiceRuntime(runtime.configSource);
          await monitorService.bindManagedServiceRuntime();

          await Promise.all([
            dailyUpdateWorker
              .runLoop(signal, "plugin_service", runtime.configSource)
              .catch(() => {}),
            realtimeMonitorWorker
              .runLoop(signal, "plugin_service")
              .catch(() => {}),
          ]);
        },
      },
    ],
    runtime,
    services: {
      alertService,
      monitorService,
      realtimeMonitorWorker,
      dailyUpdateWorker,
      watchlistService,
      database,
    },
  };
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
