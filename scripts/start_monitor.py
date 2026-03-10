#!/usr/bin/env python3
"""
启动实时监控并输出摘要
用法: python scripts/start_monitor.py
"""

import argparse
import os
import subprocess
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config import load_config, get_config, china_now, CHINA_TZ
from src.db import get_watchlist
from src.alert import send_alert, format_system_notification
from src.tickflow_api import fetch_quotes, TickFlowAPIError

LOCK_FILE = "/tmp/tickflow_monitor.pid"
MONITOR_SCRIPT = "realtime_monitor.py"


def _check_pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _is_monitor_process(pid: int) -> bool:
    try:
        cmdline_path = f"/proc/{pid}/cmdline"
        if not os.path.exists(cmdline_path):
            return _check_pid_alive(pid)
        with open(cmdline_path, "rb") as f:
            cmdline = f.read().decode("utf-8", errors="replace")
        return MONITOR_SCRIPT in cmdline
    except (OSError, IOError):
        return False


def _get_running_pid() -> int | None:
    if not os.path.exists(LOCK_FILE):
        return None
    try:
        with open(LOCK_FILE, "r", encoding="utf-8") as f:
            pid = int(f.read().strip())
    except (OSError, ValueError):
        return None
    if _check_pid_alive(pid) and _is_monitor_process(pid):
        return pid
    return None


def _print_summary(pid: int | None) -> None:
    cfg = get_config()
    watchlist = get_watchlist()
    interval = cfg.get("tickflow", {}).get("request_interval", 30)

    if pid is None:
        print("❌ 实时监控启动失败")
        return

    print("✅ 实时监控已启动！")
    print(f"\n监控进程 PID: {pid}")
    print(
        f"\n监控进程正在后台运行，会在交易时段"
        f"（9:30-11:30, 13:00-15:00）每 {interval} 秒获取一次实时行情。"
    )

    if len(watchlist) > 0:
        print("\n当前监控列表：")
        for _, row in watchlist.iterrows():
            name = row.get("name") or row["symbol"]
            print(f"\n• {name}（{row['symbol']}） (成本: {row['cost_price']:.2f})")
    else:
        print("\n⚠️ 当前关注列表为空")


def _send_start_notification(pid: int) -> None:
    watchlist = get_watchlist()
    lines = [f"时间: {china_now().strftime('%Y-%m-%d %H:%M:%S')}", f"进程 PID: {pid}"]
    interval = get_config().get("tickflow", {}).get("request_interval", 30)
    lines.append(f"轮询间隔: {interval} 秒")

    if len(watchlist) > 0:
        symbols = watchlist["symbol"].tolist()
        try:
            quotes = fetch_quotes(symbols).get("data", [])
            quote_map = {quote.get("symbol"): quote for quote in quotes if quote.get("symbol")}
            for _, row in watchlist.iterrows():
                symbol = row["symbol"]
                name = row.get("name") or symbol
                cost = row["cost_price"]
                quote = quote_map.get(symbol, {})
                price = quote.get("last_price")
                quote_time = quote.get("timestamp")
                quote_time_text = "未知"
                if isinstance(quote_time, (int, float)):
                    ts = quote_time / 1000 if quote_time > 1_000_000_000_000 else quote_time
                    quote_time_text = datetime.fromtimestamp(ts, tz=CHINA_TZ).strftime("%H:%M:%S")
                if price:
                    lines.append(
                        f"监控标的: {name}（{symbol}） 成本 {cost:.2f} | 最新价 {price:.2f} | 行情时间 {quote_time_text}"
                    )
                else:
                    lines.append(f"监控标的: {name}（{symbol}） 成本 {cost:.2f}")
        except TickFlowAPIError:
            for _, row in watchlist.iterrows():
                name = row.get("name") or row["symbol"]
                lines.append(f"监控标的: {name}（{row['symbol']}） 成本 {row['cost_price']:.2f}")

    send_alert(format_system_notification("✅ TickFlow 监控已启动", lines))


def main():
    parser = argparse.ArgumentParser(description="启动实时监控")
    parser.add_argument("--config", default=None, help="配置文件路径")
    args = parser.parse_args()

    load_config(args.config)

    watchlist = get_watchlist()
    if len(watchlist) == 0:
        print("❌ 关注列表为空，无法启动监控")
        sys.exit(1)

    running_pid = _get_running_pid()
    if running_pid is not None:
        print("ℹ️ 实时监控已在运行，无需重复启动。")
        _print_summary(running_pid)
        return

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    log_path = "/tmp/tickflow_realtime_monitor.manual.log"
    with open(log_path, "a", encoding="utf-8") as log_file:
        subprocess.Popen(
            [sys.executable, os.path.join(project_root, "scripts", MONITOR_SCRIPT)],
            cwd=project_root,
            stdout=log_file,
            stderr=log_file,
            start_new_session=True,
        )

    for _ in range(10):
        time.sleep(0.5)
        running_pid = _get_running_pid()
        if running_pid is not None:
            _print_summary(running_pid)
            _send_start_notification(running_pid)
            return

    print("❌ 实时监控进程未能在预期时间内完成启动")
    sys.exit(1)


if __name__ == "__main__":
    main()
