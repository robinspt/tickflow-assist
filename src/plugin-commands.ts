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
    throw new Error("用法: /addstock <symbol> <costPrice> [count]");
  }

  const symbol = parts[0];
  const costPrice = Number(parts[1]);
  const count = parts[2] ? Number(parts[2]) : undefined;
  if (!symbol || !Number.isFinite(costPrice) || costPrice <= 0) {
    throw new Error("用法: /addstock <symbol> <costPrice> [count]");
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
  const removeStock = getTool(tools, "remove_stock");
  const listWatchlist = getTool(tools, "list_watchlist");
  const monitorStatus = getTool(tools, "monitor_status");
  const dailyUpdateStatus = getTool(tools, "daily_update_status");
  const testAlert = getTool(tools, "test_alert");

  const commands: RegisteredCommand[] = [
    {
      name: "addstock",
      description: "Add a watchlist symbol without invoking the AI agent. Usage: /addstock <symbol> <costPrice> [count]",
      acceptsArgs: true,
      requireAuth: true,
      handler: async ({ args }) => ({
        text: await runToolText(addStock, parseAddStockArgs(args)),
      }),
    },
    {
      name: "rmstock",
      description: "Remove a watchlist symbol without invoking the AI agent. Usage: /rmstock <symbol>",
      acceptsArgs: true,
      requireAuth: true,
      handler: async ({ args }) => ({
        text: await runToolText(removeStock, {
          symbol: parseRequiredSymbol(args, "/rmstock <symbol>"),
        }),
      }),
    },
    {
      name: "watchlist",
      description: "Show the current watchlist without invoking the AI agent.",
      requireAuth: true,
      handler: async () => ({
        text: await runToolText(listWatchlist),
      }),
    },
    {
      name: "monitorstatus",
      description: "Show monitor status without invoking the AI agent.",
      requireAuth: true,
      handler: async () => ({
        text: await runToolText(monitorStatus),
      }),
    },
    {
      name: "dailyupdatestatus",
      description: "Show daily update status without invoking the AI agent.",
      requireAuth: true,
      handler: async () => ({
        text: await runToolText(dailyUpdateStatus),
      }),
    },
    {
      name: "testalert",
      description: "Send a test alert without invoking the AI agent.",
      requireAuth: true,
      handler: async () => ({
        text: await runToolText(testAlert),
      }),
    },
    {
      name: "tickflowdebug",
      description: "Show TickFlow plugin runtime config and watchlist snapshot for debugging.",
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
