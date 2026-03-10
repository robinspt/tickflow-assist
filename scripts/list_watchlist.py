#!/usr/bin/env python3
"""
查看当前关注列表
用法: python scripts/list_watchlist.py
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config import load_config
from src.db import get_watchlist


def main():
    parser = argparse.ArgumentParser(description="查看当前关注列表")
    parser.add_argument("--config", default=None, help="配置文件路径")
    args = parser.parse_args()

    load_config(args.config)

    watchlist = get_watchlist()
    if len(watchlist) == 0:
        print("📋 关注列表为空")
        return

    if "added_at" in watchlist.columns:
        watchlist = watchlist.sort_values("added_at").reset_index(drop=True)

    print(f"📋 当前关注列表 ({len(watchlist)} 只):")
    for _, row in watchlist.iterrows():
        label = f"{row['name']}（{row['symbol']}）" if row.get("name") else row["symbol"]
        print(f"  • {label}  成本: {row['cost_price']:.2f}")


if __name__ == "__main__":
    main()
