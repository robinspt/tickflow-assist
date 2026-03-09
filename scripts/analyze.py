#!/usr/bin/env python3
"""
调用 LLM 分析股票，输出关键价位
用法: python scripts/analyze.py --symbol 600000.SH
"""

import argparse
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config import load_config
from src.analyzer import analyze_stock, format_analysis_for_user


def main():
    parser = argparse.ArgumentParser(description="LLM 技术分析")
    parser.add_argument("--symbol", required=True, help="股票代码 (如 600000.SH)")
    parser.add_argument("--cost", type=float, default=0, help="成本价 (可选，默认从数据库读取)")
    parser.add_argument("--config", default=None, help="配置文件路径")
    args = parser.parse_args()

    load_config(args.config)

    symbol = args.symbol.upper()
    print(f"🤖 正在分析 {symbol}...\n")

    try:
        analysis_text, levels = analyze_stock(symbol, args.cost)
    except ValueError as e:
        print(f"❌ {e}")
        sys.exit(1)

    # 输出格式化结果（简洁结论 + 关键价位表格，不含原始 JSON）
    print("=" * 60)
    print(format_analysis_for_user(analysis_text, levels))
    print("=" * 60)

    # 根据结构化解析结果给出不同提示
    if levels is not None:
        print(f"\n💾 关键价位已写入数据库")
    else:
        print(f"\n⚠️ 结构化解析失败，仅保留原始分析文本（未写入有效价位数据）")


if __name__ == "__main__":
    main()
