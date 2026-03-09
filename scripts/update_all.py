#!/usr/bin/env python3
"""
收盘后批量更新：遍历关注列表，全量更新日K线并重新计算指标
用法: python scripts/update_all.py
适合通过 cron / OpenClaw Cron 在每日 15:35 触发

更新策略：
- 每次重新拉取最近 kline.days 天的 K 线，按股票维度整体替换
- 这样可以自动处理除权除息导致的历史数据变化
- 指标也全量重算

时间保护：
- 交易日 >= 15:30 才允许执行
- --force 跳过时间检查
- 盘中误执行时剔除当日未完成日线
"""

import sys
import os
import traceback
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd

from src.config import load_config, get_config
from src.tickflow_api import fetch_klines_batch_as_dataframes, TickFlowAPIError
from src.indicators import calculate_all_indicators
from src.calendar import can_run_daily_update, is_trading_time
from src.db import (
    get_watchlist,
    save_klines, save_indicators,
)


def update_symbols_batch(symbols: list[str], days: int, adjust: str) -> tuple[int, int]:
    """
    批量更新多只股票。

    使用批量接口一次请求多 symbols，返回后按 symbol 拆分入库。
    K 线和指标都按股票维度整体替换（滚动窗口，兼顾除权除息）。

    Returns:
        (success_count, fail_count)
    """
    success = 0
    failed = 0

    # 批量获取 K 线数据
    try:
        dataframes = fetch_klines_batch_as_dataframes(
            symbols, period="1d", count=days, adjust=adjust,
        )
    except TickFlowAPIError as e:
        print(f"  ❌ 批量请求失败: {e}")
        return 0, len(symbols)

    for symbol in symbols:
        try:
            df = dataframes.get(symbol)
            if df is None or len(df) == 0:
                print(f"  ❌ {symbol}: 返回数据为空")
                failed += 1
                continue

            # 盘中保护：剔除当日未完成日线
            if is_trading_time():
                today = datetime.now().strftime("%Y-%m-%d")
                before_count = len(df)
                df = df[df["trade_date"] != today]
                if len(df) < before_count:
                    print(f"  ⏰ {symbol}: 交易时段内，已剔除当日未完成数据")

            if len(df) == 0:
                print(f"  ❌ {symbol}: 过滤后有效数据为空")
                failed += 1
                continue

            # 全量覆盖该股票的 K 线
            save_klines(symbol, df)

            # 计算并保存指标（全量重算）
            if len(df) < 5:
                print(f"  ⚠️ {symbol}: K 线不足 5 根，跳过指标计算")
                success += 1
                continue

            ind_df = calculate_all_indicators(df)
            indicator_cols = [
                "trade_date", "ma5", "ma10", "ma20", "ma60",
                "macd", "macd_signal", "macd_hist",
                "kdj_k", "kdj_d", "kdj_j",
                "rsi_6", "rsi_12", "rsi_24",
                "cci", "bias_6", "bias_12", "bias_24",
                "plus_di", "minus_di", "adx",
                "boll_upper", "boll_mid", "boll_lower",
            ]
            save_indicators(symbol, ind_df[indicator_cols].copy())

            latest = df.iloc[-1]
            print(f"  ✅ {symbol}: {len(df)} 根K线, "
                  f"最新 {latest['trade_date']} 收盘 {latest['close']:.2f}")
            success += 1

        except Exception as e:
            print(f"  ❌ {symbol}: {e}")
            traceback.print_exc()
            failed += 1

    return success, failed


def main():
    import argparse
    parser = argparse.ArgumentParser(description="收盘后批量更新日K线和指标")
    parser.add_argument("--config", default=None, help="配置文件路径")
    parser.add_argument("--force", action="store_true", help="强制运行（忽略交易日和时间检查）")
    args = parser.parse_args()

    load_config(args.config)
    cfg = get_config()

    # 时间保护：交易日 >= 15:30 才允许
    can_run, reason = can_run_daily_update(force=args.force)
    if not can_run:
        print(f"🚫 {reason}")
        return

    print(f"📅 {reason}")

    wl = get_watchlist()
    if len(wl) == 0:
        print("📋 关注列表为空，无需更新")
        return

    days = cfg.get("kline", {}).get("days", 90)
    adjust = cfg.get("kline", {}).get("adjust", "forward")
    symbols = wl["symbol"].tolist()

    print(f"📊 收盘更新: {len(symbols)} 只股票, 获取 {days} 天 K 线 (复权: {adjust})")
    print("=" * 50)

    total_success, total_failed = update_symbols_batch(symbols, days, adjust)

    print("=" * 50)
    print(f"🏁 完成: {total_success} 成功, {total_failed} 失败 (共 {len(symbols)} 只)")


if __name__ == "__main__":
    main()
