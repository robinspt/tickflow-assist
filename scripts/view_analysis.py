#!/usr/bin/env python3
"""
查看最近一次分析结果
用法: python scripts/view_analysis.py --symbol 600000.SH
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config import load_config
from src.analyzer import format_analysis_for_user
from src.db import get_key_levels, get_latest_analysis, get_watchlist
from src.validators import validate_a_share_symbol, InvalidSymbolError


def main():
    parser = argparse.ArgumentParser(description="查看最近一次分析结果")
    parser.add_argument("--symbol", required=True, help="股票代码 (如 600000.SH)")
    parser.add_argument("--config", default=None, help="配置文件路径")
    args = parser.parse_args()

    load_config(args.config)

    try:
        symbol = validate_a_share_symbol(args.symbol)
    except InvalidSymbolError as e:
        print(f"❌ {e}")
        sys.exit(1)

    latest = get_latest_analysis(symbol)
    if latest is None:
        print(f"⚠️ {symbol} 暂无历史分析记录")
        sys.exit(1)

    levels = get_key_levels(symbol)
    analysis_text = latest.get("analysis_text", "")
    analysis_date = latest.get("analysis_date", "未知")
    structured_ok = latest.get("structured_ok", False)

    watchlist = get_watchlist()
    match = watchlist[watchlist["symbol"] == symbol]
    stock_name = match.iloc[0].get("name", symbol) if len(match) > 0 else symbol

    print(f"📄 最近一次分析: {stock_name}（{symbol}）")
    print(f"🗓️ 分析日期: {analysis_date}")
    print(f"✅ 结构化结果: {'成功' if structured_ok else '失败'}")
    print("=" * 60)
    print(format_analysis_for_user(analysis_text, levels if structured_ok else None))
    print("=" * 60)


if __name__ == "__main__":
    main()
