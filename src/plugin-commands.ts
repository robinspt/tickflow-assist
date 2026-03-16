import { buildWatchlistDebugSnapshot, type AppContext } from "./bootstrap.js";
import type { LocalTool, PluginApi, RegisteredCommand } from "./runtime/plugin-api.js";

function getTool(tools: LocalTool[], name: string): LocalTool {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`tool not found: ${name}`);
  }
  return tool;
}

function parseAddStockArgs(args: string | undefined): {
  symbol: string;
  costPrice: number;
  count?: number;
} {
  const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    throw new Error("用法: /ta_addstock <symbol> <costPrice> [count]");
  }

  const symbol = parts[0];
  const costPrice = Number(parts[1]);
  const count = parts[2] ? Number(parts[2]) : undefined;
  if (!symbol || !Number.isFinite(costPrice) || costPrice <= 0) {
    throw new Error("用法: /ta_addstock <symbol> <costPrice> [count]");
  }
  if (count != null && (!Number.isFinite(count) || count <= 0)) {
    throw new Error("count 必须大于 0");
  }

  return { symbol, costPrice, count };
}

function parseRequiredSymbol(args: string | undefined, usage: string): string {
  const symbol = (args ?? "").trim();
  if (!symbol) {
    throw new Error(`用法: ${usage}`);
  }
  return symbol;
}

async function runToolText(tool: LocalTool, rawInput?: unknown): Promise<string> {
  return tool.run({ rawInput });
}

async function renderWatchlistDebug(app: AppContext): Promise<string> {
  const snapshot = await buildWatchlistDebugSnapshot(app);
  const lines = [
    "🛠 TickFlow 调试信息",
    `PID: ${snapshot.pid}`,
    `配置来源: ${snapshot.configSource}`,
    `数据库路径: ${snapshot.databasePath}`,
    `交易日历: ${snapshot.calendarFile}`,
    `轮询间隔: ${snapshot.requestInterval}`,
    `watchlist 表存在: ${snapshot.watchlistTableExists ? "是" : "否"}`,
    `watchlist 记录数: ${snapshot.watchlistCount}`,
  ];

  if (snapshot.watchlistPreview.length > 0) {
    lines.push("", "watchlist 预览:");
    for (const item of snapshot.watchlistPreview) {
      lines.push(`• ${item.name}（${item.symbol}） 成本: ${item.costPrice.toFixed(2)}`);
    }
  }

  return lines.join("\n");
}

export function registerPluginCommands(api: PluginApi, tools: LocalTool[], app: AppContext): void {
  const addStock = getTool(tools, "add_stock");
  const analyze = getTool(tools, "analyze");
  const viewAnalysis = getTool(tools, "view_analysis");
  const removeStock = getTool(tools, "remove_stock");
  const listWatchlist = getTool(tools, "list_watchlist");
  const refreshWatchlistNames = getTool(tools, "refresh_watchlist_names");
  const startMonitor = getTool(tools, "start_monitor");
  const stopMonitor = getTool(tools, "stop_monitor");
  const monitorStatus = getTool(tools, "monitor_status");
  const startDailyUpdate = getTool(tools, "start_daily_update");
  const stopDailyUpdate = getTool(tools, "stop_daily_update");
  const updateAll = getTool(tools, "update_all");
  const dailyUpdateStatus = getTool(tools, "daily_update_status");
  const testAlert = getTool(tools, "test_alert");

  const commands: RegisteredCommand[] = [
    {
      name: "ta_addstock",
      description:
        "添加自选股，不经过 AI 对话。用法: /ta_addstock <symbol> <costPrice> [count]",
      acceptsArgs: true,
      requireAuth: true,
      handler: async ({ args }) => ({
        text: await runToolText(addStock, parseAddStockArgs(args)),
      }),
    },
    {
      name: "ta_rmstock",
      description:
        "删除自选股，不经过 AI 对话。用法: /ta_rmstock <symbol>",
      acceptsArgs: true,
      requireAuth: true,
      handler: async ({ args }) => ({
        text: await runToolText(removeStock, {
          symbol: parseRequiredSymbol(args, "/ta_rmstock <symbol>"),
        }),
      }),
    },
    {
      name: "ta_analyze",
      description:
        "分析单只股票，不经过 AI 对话。用法: /ta_analyze <symbol>",
      acceptsArgs: true,
      requireAuth: true,
      handler: async ({ args }) => ({
        text: await runToolText(analyze, {
          symbol: parseRequiredSymbol(args, "/ta_analyze <symbol>"),
        }),
      }),
    },
    {
      name: "ta_viewanalysis",
      description:
        "查看单只股票最近一次保存的分析结果，不经过 AI 对话。用法: /ta_viewanalysis <symbol>",
      acceptsArgs: true,
      requireAuth: true,
      handler: async ({ args }) => ({
        text: await runToolText(viewAnalysis, {
          symbol: parseRequiredSymbol(args, "/ta_viewanalysis <symbol>"),
        }),
      }),
    },
    {
      name: "ta_watchlist",
      description: "查看当前自选列表，不经过 AI 对话。",
      requireAuth: true,
      handler: async () => ({
        text: await runToolText(listWatchlist),
      }),
    },
    {
      name: "ta_refreshnames",
      description: "刷新自选股名称，不经过 AI 对话。",
      requireAuth: true,
      handler: async () => ({
        text: await runToolText(refreshWatchlistNames),
      }),
    },
    {
      name: "ta_startmonitor",
      description: "启动实时监控，不经过 AI 对话。",
      requireAuth: true,
      handler: async () => ({
        text: await runToolText(startMonitor),
      }),
    },
    {
      name: "ta_stopmonitor",
      description: "停止实时监控，不经过 AI 对话。",
      requireAuth: true,
      handler: async () => ({
        text: await runToolText(stopMonitor),
      }),
    },
    {
      name: "ta_monitorstatus",
      description: "查看实时监控状态，不经过 AI 对话。",
      requireAuth: true,
      handler: async () => ({
        text: await runToolText(monitorStatus),
      }),
    },
    {
      name: "ta_startdailyupdate",
      description: "启动定时日更任务，不经过 AI 对话。",
      requireAuth: true,
      handler: async () => ({
        text: await runToolText(startDailyUpdate),
      }),
    },
    {
      name: "ta_stopdailyupdate",
      description: "停止定时日更任务，不经过 AI 对话。",
      requireAuth: true,
      handler: async () => ({
        text: await runToolText(stopDailyUpdate),
      }),
    },
    {
      name: "ta_updateall",
      description: "立即执行一次完整日更，不经过 AI 对话。",
      requireAuth: true,
      handler: async () => ({
        text: await runToolText(updateAll),
      }),
    },
    {
      name: "ta_dailyupdatestatus",
      description: "查看定时日更状态，不经过 AI 对话。",
      requireAuth: true,
      handler: async () => ({
        text: await runToolText(dailyUpdateStatus),
      }),
    },
    {
      name: "ta_testalert",
      description: "发送一条测试告警，不经过 AI 对话。",
      requireAuth: true,
      handler: async () => ({
        text: await runToolText(testAlert),
      }),
    },
    {
      name: "ta_debug",
      description: "查看 TickFlow 插件运行时调试信息。",
      requireAuth: true,
      handler: async () => ({
        text: await renderWatchlistDebug(app),
      }),
    },
  ];

  for (const command of commands) {
    api.registerCommand?.(command);
  }
}
