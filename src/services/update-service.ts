import { KlineService } from "./kline-service.js";
import { IndicatorService } from "./indicator-service.js";
import { KlinesRepository } from "../storage/repositories/klines-repo.js";
import { IndicatorsRepository } from "../storage/repositories/indicators-repo.js";
import { WatchlistService } from "./watchlist-service.js";
import { TradingCalendarService } from "./trading-calendar-service.js";

export class UpdateService {
  constructor(
    private readonly klineService: KlineService,
    private readonly indicatorService: IndicatorService,
    private readonly klinesRepository: KlinesRepository,
    private readonly indicatorsRepository: IndicatorsRepository,
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
    if (watchlist.length === 0) {
      return "📋 关注列表为空，无需更新";
    }

    const lines = [
      `📊 收盘更新: ${watchlist.length} 只股票, 获取 ${days} 天 K 线 (复权: ${adjust})`,
    ];

    let success = 0;
    let failed = 0;
    for (const item of watchlist) {
      try {
        const rows = await this.klineService.fetchKlines(item.symbol, {
          count: days,
          adjust,
        });
        if (rows.length === 0) {
          failed += 1;
          lines.push(`❌ ${item.name}（${item.symbol}）: 返回数据为空`);
          continue;
        }

        await this.klinesRepository.saveAll(item.symbol, rows);
        const indicators = await this.indicatorService.calculate(rows);
        await this.indicatorsRepository.saveAll(item.symbol, indicators);

        const latest = rows[rows.length - 1];
        lines.push(
          `✅ ${item.name}（${item.symbol}）: ${rows.length} 根K线, 最新 ${latest.trade_date} 收盘 ${latest.close.toFixed(2)}`,
        );
        success += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        lines.push(`❌ ${item.name}（${item.symbol}）: ${message}`);
      }
    }

    lines.push(`🏁 完成: ${success} 成功, ${failed} 失败 (共 ${watchlist.length} 只)`);
    return lines.join("\n");
  }
}
