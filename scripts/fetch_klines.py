#!/usr/bin/env python3
"""
获取日K线数据 + 计算技术指标 + 写入数据库
用法: python scripts/fetch_klines.py --symbol 600000.SH [--days 90]
"""

import argparse
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config import load_config, get_config, china_now
from src.validators import validate_a_share_symbol, InvalidSymbolError
from src.tickflow_api import fetch_klines_as_dataframe, TickFlowAPIError
from src.indicators import calculate_all_indicators
from src.calendar import is_trading_time
from src.db import save_klines, save_indicators, get_watchlist

import pandas as pd


def main():
    parser = argparse.ArgumentParser(description="获取日K线并计算指标")
    parser.add_argument("--symbol", required=True, help="股票代码 (如 600000.SH)")
    parser.add_argument("--days", type=int, default=None, help="获取天数 (默认从配置文件读取)")
    parser.add_argument("--config", default=None, help="配置文件路径")
    args = parser.parse_args()

    load_config(args.config)
    cfg = get_config()

    # 校验股票代码
    try:
        symbol = validate_a_share_symbol(args.symbol)
    except InvalidSymbolError as e:
        print(f"❌ {e}")
        sys.exit(1)

    watchlist = get_watchlist()
    watchlist_match = watchlist[watchlist["symbol"] == symbol]
    stock_name = (
        watchlist_match.iloc[0].get("name") or symbol
        if len(watchlist_match) > 0 else symbol
    )
    stock_label = f"{stock_name}（{symbol}）" if stock_name != symbol else symbol

    days = args.days or cfg.get("kline", {}).get("days", 90)
    adjust = cfg.get("kline", {}).get("adjust", "forward")

    print(f"📊 获取 {stock_label} 日K线数据 (最近 {days} 天, 复权: {adjust})...")

    # 获取 K 线数据（通过适配层直接得到 DataFrame）
    try:
        df = fetch_klines_as_dataframe(symbol, period="1d", count=days, adjust=adjust)
    except TickFlowAPIError as e:
        print(f"❌ {e}")
        sys.exit(1)

    # 如果在交易时间段内，剔除当日数据（当日数据不完整）
    if is_trading_time():
        today = china_now().strftime("%Y-%m-%d")
        before_count = len(df)
        df = df[df["trade_date"] != today]
        if len(df) < before_count:
            print(f"⏰ 交易时段内，已剔除当日未完成数据")

    if len(df) == 0:
        print(f"❌ 有效K线数据为空")
        sys.exit(1)

    print(f"✅ 获取到 {len(df)} 根日K线 ({df['trade_date'].iloc[0]} ~ {df['trade_date'].iloc[-1]})")

    # 保存 K 线数据
    save_klines(symbol, df)
    print(f"💾 K线数据已写入数据库")

    # 计算技术指标
    print(f"🔧 计算技术指标...")
    ind_df = calculate_all_indicators(df)

    # 提取指标列，添加必要字段
    indicator_cols = [
        "trade_date", "ma5", "ma10", "ma20", "ma60",
        "macd", "macd_signal", "macd_hist",
        "kdj_k", "kdj_d", "kdj_j",
        "rsi_6", "rsi_12", "rsi_24",
        "cci", "bias_6", "bias_12", "bias_24",
        "plus_di", "minus_di", "adx",
        "boll_upper", "boll_mid", "boll_lower",
    ]
    ind_save = ind_df[indicator_cols].copy()

    save_indicators(symbol, ind_save)
    print(f"💾 技术指标已写入数据库")

    # 打印最新指标
    latest = ind_df.iloc[-1]
    print(f"\n📈 最新指标 ({latest['trade_date']}):")
    print(f"  收盘: {latest['close']:.2f}")
    print(f"  MA5: {latest['ma5']:.2f}  MA10: {latest['ma10']:.2f}  MA20: {latest['ma20']:.2f}")
    if pd.notna(latest.get('macd')):
        print(f"  MACD: {latest['macd']:.4f}  Signal: {latest['macd_signal']:.4f}")
    if pd.notna(latest.get('rsi_6')):
        print(f"  RSI6: {latest['rsi_6']:.2f}  RSI12: {latest['rsi_12']:.2f}")
    if pd.notna(latest.get('kdj_k')):
        print(f"  KDJ: K={latest['kdj_k']:.2f}  D={latest['kdj_d']:.2f}  J={latest['kdj_j']:.2f}")


if __name__ == "__main__":
    main()
