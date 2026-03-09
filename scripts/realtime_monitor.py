#!/usr/bin/env python3
"""
实时行情监控主循环
用法: python scripts/realtime_monitor.py
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config import load_config
from src.monitor import run_monitor_loop


def main():
    import argparse
    parser = argparse.ArgumentParser(description="实时行情监控")
    parser.add_argument("--config", default=None, help="配置文件路径")
    args = parser.parse_args()

    load_config(args.config)
    run_monitor_loop()


if __name__ == "__main__":
    main()
