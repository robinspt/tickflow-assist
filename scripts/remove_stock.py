#!/usr/bin/env python3
"""
删除关注股票（同时清除其 K线、指标、关键价位数据）
用法: python scripts/remove_stock.py --symbol 600000.SH
"""

import argparse
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config import load_config
from src.db import remove_from_watchlist, get_watchlist, delete_symbol_data


def main():
    parser = argparse.ArgumentParser(description="从关注列表移除股票")
    parser.add_argument("--symbol", required=True, help="股票代码 (如 600000.SH)")
    parser.add_argument("--keep-data", action="store_true", help="保留 K线和指标数据，仅从关注列表移除")
    parser.add_argument("--config", default=None, help="配置文件路径")
    args = parser.parse_args()

    load_config(args.config)

    symbol = args.symbol.upper()

    # 检查是否存在
    wl = get_watchlist()
    if len(wl[wl["symbol"] == symbol]) == 0:
        print(f"⚠️  {symbol} 不在关注列表中")
        sys.exit(1)

    # 从关注列表移除
    remove_from_watchlist(symbol)
    print(f"✅ 已从关注列表移除: {symbol}")

    # 清除关联数据（通过公开接口）
    cleaned = delete_symbol_data(symbol, keep_data=args.keep_data)
    if cleaned:
        print(f"🗑️  已清除关联数据: {', '.join(cleaned)}")
    elif not args.keep_data:
        print(f"📌 无需清理关联数据")
    else:
        print(f"📌 已保留 K线和指标数据")

    # 显示剩余关注列表
    wl = get_watchlist()
    if len(wl) > 0:
        print(f"\n📋 当前关注列表 ({len(wl)} 只):")
        for _, row in wl.iterrows():
            print(f"  • {row['symbol']}  成本: {row['cost_price']:.2f}")
    else:
        print(f"\n📋 关注列表为空")


if __name__ == "__main__":
    main()
