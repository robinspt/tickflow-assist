#!/usr/bin/env python3
"""
添加/更新关注股票
用法: python scripts/add_stock.py --symbol 600000.SH --cost 10.5
"""

import argparse
import sys
import os

# 添加项目根目录到 path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config import load_config
from src.tickflow_api import fetch_instrument, TickFlowAPIError
from src.validators import validate_a_share_symbol, InvalidSymbolError
from src.db import add_to_watchlist, get_watchlist


def main():
    parser = argparse.ArgumentParser(description="添加股票到关注列表")
    parser.add_argument("--symbol", required=True, help="股票代码 (如 600000.SH)")
    parser.add_argument("--cost", type=float, required=True, help="成本价")
    parser.add_argument("--config", default=None, help="配置文件路径")
    args = parser.parse_args()

    load_config(args.config)

    # 校验股票代码合法性
    try:
        symbol = validate_a_share_symbol(args.symbol)
    except InvalidSymbolError as e:
        print(f"❌ {e}")
        sys.exit(1)

    try:
        instrument = fetch_instrument(symbol)
    except TickFlowAPIError as e:
        print(f"❌ 获取股票元数据失败: {e}")
        sys.exit(1)

    stock_name = instrument.get("name") or symbol

    add_to_watchlist(symbol, args.cost, stock_name)

    print(f"✅ 已添加: {stock_name}（{symbol}），成本价: {args.cost:.2f}")

    # 显示当前关注列表
    wl = get_watchlist()
    print(f"\n📋 当前关注列表 ({len(wl)} 只):")
    for _, row in wl.iterrows():
        label = f"{row['name']}（{row['symbol']}）" if row.get("name") else row["symbol"]
        print(f"  • {label}  成本: {row['cost_price']:.2f}")


if __name__ == "__main__":
    main()
