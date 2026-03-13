import type { PluginConfig } from "./config/schema.js";
import { TickFlowClient } from "./services/tickflow-client.js";
import { InstrumentService } from "./services/instrument-service.js";
import { KlineService } from "./services/kline-service.js";
import { IndicatorService } from "./services/indicator-service.js";
import { Database } from "./storage/db.js";
import { WatchlistRepository } from "./storage/repositories/watchlist-repo.js";
import { KlinesRepository } from "./storage/repositories/klines-repo.js";
import { IntradayKlinesRepository } from "./storage/repositories/intraday-klines-repo.js";
import { IndicatorsRepository } from "./storage/repositories/indicators-repo.js";
import { KeyLevelsRepository } from "./storage/repositories/key-levels-repo.js";
import { AnalysisLogRepository } from "./storage/repositories/analysis-log-repo.js";
import { AlertLogRepository } from "./storage/repositories/alert-log-repo.js";
import { WatchlistService } from "./services/watchlist-service.js";
import { AnalysisService } from "./services/analysis-service.js";
import { KlineTechnicalAnalysisTask } from "./analysis/tasks/kline-technical.task.js";
import { QuoteService } from "./services/quote-service.js";
import { TradingCalendarService } from "./services/trading-calendar-service.js";
import { MonitorService } from "./services/monitor-service.js";
import { AlertService } from "./services/alert-service.js";
import { UpdateService } from "./services/update-service.js";
import { addStockTool } from "./tools/add-stock.tool.js";
import { analyzeTool } from "./tools/analyze.tool.js";
import { fetchKlinesTool } from "./tools/fetch-klines.tool.js";
import { fetchIntradayKlinesTool } from "./tools/fetch-intraday-klines.tool.js";
import { listWatchlistTool } from "./tools/list-watchlist.tool.js";
import { dailyUpdateStatusTool } from "./tools/daily-update-status.tool.js";
import { monitorStatusTool } from "./tools/monitor-status.tool.js";
import { refreshWatchlistNamesTool } from "./tools/refresh-watchlist-names.tool.js";
import { queryDatabaseTool } from "./tools/query-database.tool.js";
import { removeStockTool } from "./tools/remove-stock.tool.js";
import { startMonitorTool } from "./tools/start-monitor.tool.js";
import { stopMonitorTool } from "./tools/stop-monitor.tool.js";
import { testAlertTool } from "./tools/test-alert.tool.js";
import { updateAllTool } from "./tools/update-all.tool.js";
import { viewAnalysisTool } from "./tools/view-analysis.tool.js";
import type { RegisteredService, RegisteredTool } from "./runtime/plugin-api.js";
import { RealtimeMonitorWorker } from "./background/realtime-monitor.worker.js";
import { DailyUpdateWorker } from "./background/daily-update.worker.js";

export interface AppContext {
  config: PluginConfig;
  tools: RegisteredTool[];
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
  const analysisLogRepository = new AnalysisLogRepository(database);
  const alertLogRepository = new AlertLogRepository(database);
  const instrumentService = new InstrumentService(tickflowClient);
  const klineService = new KlineService(tickflowClient);
  const quoteService = new QuoteService(tickflowClient);
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
  const watchlistService = new WatchlistService(watchlistRepository, instrumentService);
  const analysisService = new AnalysisService(
    config.llmBaseUrl,
    config.llmApiKey,
    config.llmModel,
    analysisLogRepository,
  );
  const klineTechnicalAnalysisTask = new KlineTechnicalAnalysisTask(
    keyLevelsRepository,
    analysisLogRepository,
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
  const realtimeMonitorWorker = new RealtimeMonitorWorker(
    monitorService,
    config.requestInterval * 1000,
  );
  const dailyUpdateWorker = new DailyUpdateWorker(
    updateService,
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
      analyzeTool(
        analysisService,
        klineTechnicalAnalysisTask,
        config.tickflowApiKeyLevel,
        watchlistService,
        klineService,
        quoteService,
        indicatorService,
        tradingCalendarService,
        klinesRepository,
        intradayKlinesRepository,
        indicatorsRepository,
      ),
      dailyUpdateStatusTool(dailyUpdateWorker),
      fetchIntradayKlinesTool(
        config.tickflowApiKeyLevel,
        klineService,
        intradayKlinesRepository,
        tradingCalendarService,
      ),
      fetchKlinesTool(klineService, klinesRepository, indicatorService, indicatorsRepository),
      listWatchlistTool(watchlistService),
      monitorStatusTool(monitorService),
      queryDatabaseTool(database),
      refreshWatchlistNamesTool(watchlistService),
      removeStockTool(watchlistService),
      startMonitorTool(monitorService, runtime),
      stopMonitorTool(monitorService, runtime),
      testAlertTool(alertService),
      updateAllTool(updateService),
      viewAnalysisTool(analysisService),
    ],
    backgroundServices: [
      {
        id: "tickflow-assist.realtime-monitor",
        description: "Run realtime market checks on the configured interval while monitor state is enabled.",
        start: async ({ signal }) => {
          await monitorService.markRuntimeHost("plugin_service");
          await monitorService.setWorkerPid(null);
          await monitorService.setExpectedStop(false);
          await realtimeMonitorWorker.runLoop(signal);
        },
      },
      {
        id: "tickflow-assist.daily-update",
        description: "Poll for post-close daily K-line updates and execute at most once per natural trading day.",
        start: async ({ signal }) => {
          await dailyUpdateWorker.runLoop(signal);
        },
      },
    ],
    runtime,
    services: {
      alertService,
      monitorService,
      realtimeMonitorWorker,
      dailyUpdateWorker,
    },
  };
}
