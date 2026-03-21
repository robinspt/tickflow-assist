import { DEFAULT_MARKET_INDEXES } from "../constants/market-indexes.js";
import { formatTickflowApiKeyLevel, supportsIntradayKlines, type TickflowApiKeyLevel } from "../config/tickflow-access.js";
import { KlineService } from "./kline-service.js";
import { IndicatorService } from "./indicator-service.js";
import { KlinesRepository } from "../storage/repositories/klines-repo.js";
import { IndicatorsRepository } from "../storage/repositories/indicators-repo.js";
import { IntradayKlinesRepository } from "../storage/repositories/intraday-klines-repo.js";
import { WatchlistService } from "./watchlist-service.js";
import { TradingCalendarService } from "./trading-calendar-service.js";

const INTRADAY_PERIOD = "1m";
const INTRADAY_RETENTION_DAYS = 30;

interface UpdateTarget {
  symbol: string;
  name: string;
  kind: "index" | "stock";
}

export class UpdateService {
  constructor(
    private readonly klineService: KlineService,
    private readonly tickflowApiKeyLevel: TickflowApiKeyLevel,
    private readonly indicatorService: IndicatorService,
    private readonly klinesRepository: KlinesRepository,
    private readonly indicatorsRepository: IndicatorsRepository,
    private readonly intradayKlinesRepository: IntradayKlinesRepository,
    private readonly watchlistService: WatchlistService,
    private readonly tradingCalendarService: TradingCalendarService,
  ) {}

  async updateAll(force = false, days = 90, adjust = "forward"): Promise<string> {
    if (!force) {
      const check = await this.tradingCalendarService.canRunDailyUpdate();
      if (!check.ok) {
        return `🚫 ${check.reason}`;
      }
    }

    const watchlist = await this.watchlistService.list();
    const lines = [
      `📊 收盘更新: ${watchlist.length} 只股票 + ${DEFAULT_MARKET_INDEXES.length} 个指数, 获取 ${days} 天日K与当日分钟K (个股复权: ${adjust})`,
      `🔑 TickFlow API Key Level: ${formatTickflowApiKeyLevel(this.tickflowApiKeyLevel)}`,
      "",
      "📈 指数更新:",
    ];

    let indexSuccess = 0;
    let indexFailed = 0;
    for (const target of DEFAULT_MARKET_INDEXES) {
      const result = await this.updateTarget(
        {
          symbol: target.symbol,
          name: target.name,
          kind: "index",
        },
        days,
        "none",
      );
      lines.push(result.line);
      if (result.ok) {
        indexSuccess += 1;
      } else {
        indexFailed += 1;
      }
    }

    let success = 0;
    let failed = 0;
    if (watchlist.length === 0) {
      lines.push("", "📋 关注列表为空，已跳过个股更新");
    } else {
      lines.push("", "📋 个股更新:");
      for (const item of watchlist) {
        const result = await this.updateTarget(
          {
            symbol: item.symbol,
            name: item.name,
            kind: "stock",
          },
          days,
          adjust,
        );
        lines.push(result.line);
        if (result.ok) {
          success += 1;
        } else {
          failed += 1;
        }
      }
    }

    lines.push(
      `🏁 完成: 指数 ${indexSuccess} 成功, ${indexFailed} 失败 | 个股 ${success} 成功, ${failed} 失败 (共 ${watchlist.length} 只)`,
    );
    return lines.join("\n");
  }

  private async updateTarget(target: UpdateTarget, days: number, adjust: string): Promise<{
    ok: boolean;
    line: string;
  }> {
    try {
      const rows = await this.klineService.fetchKlines(target.symbol, {
        count: days,
        adjust,
      });
      if (rows.length === 0) {
        return {
          ok: false,
          line: `❌ ${target.name}（${target.symbol}）: 返回数据为空`,
        };
      }

      await this.klinesRepository.saveAll(target.symbol, rows);
      const indicators = await this.indicatorService.calculate(rows);
      await this.indicatorsRepository.saveAll(target.symbol, indicators);

      let intradaySummary = `分钟K 已跳过（API Key Level=${formatTickflowApiKeyLevel(this.tickflowApiKeyLevel)}）`;
      if (supportsIntradayKlines(this.tickflowApiKeyLevel)) {
        try {
          const intradayRows = await this.klineService.fetchIntradayKlines(target.symbol, {
            period: INTRADAY_PERIOD,
          });
          if (intradayRows.length > 0) {
            await this.intradayKlinesRepository.saveAll(target.symbol, INTRADAY_PERIOD, intradayRows);
            const keepTradeDates = await this.tradingCalendarService.getRecentTradingDays(
              INTRADAY_RETENTION_DAYS,
              new Date(intradayRows[intradayRows.length - 1].timestamp),
            );
            await this.intradayKlinesRepository.pruneToTradeDates(
              target.symbol,
              INTRADAY_PERIOD,
              keepTradeDates,
            );
            intradaySummary = `分钟K ${intradayRows.length} 根`;
          } else {
            intradaySummary = "分钟K 0 根";
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          intradaySummary = `分钟K 更新失败，已跳过（${message}）`;
        }
      }

      const latest = rows[rows.length - 1];
      const scope = target.kind === "index" ? "指数" : "个股";
      return {
        ok: true,
        line: `✅ ${target.name}（${target.symbol}）: ${scope}日K ${rows.length} 根, ${intradaySummary}, 最新 ${latest.trade_date} 收盘 ${latest.close.toFixed(2)}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        line: `❌ ${target.name}（${target.symbol}）: ${message}`,
      };
    }
  }
}
