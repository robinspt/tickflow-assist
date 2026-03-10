#!/usr/bin/env python3
"""
查看实时监控运行状态
用法: python scripts/monitor_status.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime

LOCK_FILE = "/tmp/tickflow_monitor.pid"
MONITOR_SCRIPT = "realtime_monitor.py"


def _check_pid_alive(pid: int) -> bool:
    """检查 PID 对应的进程是否存在"""
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _is_monitor_process(pid: int) -> bool:
    """
    校验 PID 对应的进程确实是本项目的 realtime_monitor.py。

    通过 /proc/<pid>/cmdline 读取完整命令行参数，检查是否包含
    monitor 脚本的特征字符串，避免 PID 复用误判。
    """
    try:
        cmdline_path = f"/proc/{pid}/cmdline"
        if not os.path.exists(cmdline_path):
            # 非 Linux 平台，回退到仅检查存活
            return _check_pid_alive(pid)
        with open(cmdline_path, "rb") as f:
            cmdline = f.read().decode("utf-8", errors="replace")
        # /proc/<pid>/cmdline 用 \x00 分隔参数
        return MONITOR_SCRIPT in cmdline
    except (OSError, IOError):
        return False


def _get_process_uptime(pid: int) -> str:
    """获取进程运行时长（仅 Linux）"""
    try:
        stat_path = f"/proc/{pid}/stat"
        if os.path.exists(stat_path):
            with open("/proc/uptime", "r") as f:
                system_uptime = float(f.read().split()[0])
            with open(stat_path, "r") as f:
                fields = f.read().split()
                # 第 22 个字段是 starttime（以 clock ticks 为单位）
                starttime = int(fields[21])
                clk_tck = os.sysconf(os.sysconf_names["SC_CLK_TCK"])
                process_start_sec = starttime / clk_tck
                elapsed = system_uptime - process_start_sec
                hours = int(elapsed // 3600)
                minutes = int((elapsed % 3600) // 60)
                seconds = int(elapsed % 60)
                return f"{hours}h {minutes}m {seconds}s"
    except Exception:
        pass
    return "未知"


def main():
    from src.config import load_config
    from src.calendar import is_trading_day, is_trading_time
    from src.db import get_watchlist, get_all_key_levels

    load_config()
    from src.config import get_config
    cfg = get_config()

    now = datetime.now()
    print("=" * 52)
    print("  📊 TickFlow 实时监控状态报告")
    print("=" * 52)
    print(f"\n⏰ 查询时间: {now.strftime('%Y-%m-%d %H:%M:%S')}")

    # ---- 1. 监控进程状态 ----
    print("\n--- 🔍 监控进程 ---")
    if os.path.exists(LOCK_FILE):
        try:
            with open(LOCK_FILE, "r") as f:
                pid = int(f.read().strip())
            if not _check_pid_alive(pid):
                print(f"  ❌ 监控进程已停止（PID={pid} 不存在）")
                print(f"  ⚠️  锁文件残留: {LOCK_FILE}")
            elif not _is_monitor_process(pid):
                print(f"  ❌ PID={pid} 存活但不是监控进程（可能已被系统复用）")
                print(f"  ⚠️  锁文件残留: {LOCK_FILE}")
            else:
                uptime = _get_process_uptime(pid)
                print(f"  ✅ 监控进程运行中  PID={pid}")
                print(f"  ⏱️  已运行: {uptime}")
        except (ValueError, IOError) as e:
            print(f"  ❌ 锁文件损坏: {e}")
    else:
        print("  ⭕ 监控进程未启动（无锁文件）")

    # ---- 2. 交易时段状态 ----
    print("\n--- 📅 交易时段 ---")
    trading_day = is_trading_day()
    trading_time = is_trading_time()

    print(f"  今日 ({now.strftime('%Y-%m-%d')}): {'✅ 交易日' if trading_day else '❌ 非交易日'}")
    if trading_day:
        hours = cfg.get("trading_hours", {})
        morning = f"{hours.get('morning_start', '09:30')}-{hours.get('morning_end', '11:30')}"
        afternoon = f"{hours.get('afternoon_start', '13:00')}-{hours.get('afternoon_end', '15:00')}"
        print(f"  交易时段: {morning}, {afternoon}")
        if trading_time:
            print(f"  当前状态: 🟢 交易中")
        else:
            current_time = now.strftime("%H:%M")
            if current_time < hours.get("morning_start", "09:30"):
                print(f"  当前状态: 🟡 盘前等待")
            elif current_time > hours.get("afternoon_end", "15:00"):
                print(f"  当前状态: 🔴 已收盘")
            else:
                print(f"  当前状态: 🟡 午间休市")

    # ---- 3. 关注列表 ----
    print("\n--- 📋 关注列表 ---")
    watchlist = get_watchlist()
    if len(watchlist) > 0:
        print(f"  关注股票数: {len(watchlist)}")
        for _, row in watchlist.iterrows():
            symbol = row["symbol"]
            cost = row["cost_price"]
            print(f"    • {symbol}  成本: {cost:.2f}")
    else:
        print("  ⚠️  关注列表为空（监控无目标）")

    # ---- 4. 关键价位覆盖 ----
    print("\n--- 🎯 关键价位 ---")
    try:
        all_levels = get_all_key_levels()
        if len(all_levels) > 0:
            symbols_with_levels = all_levels["symbol"].unique()
            watchlist_symbols = set(watchlist["symbol"].tolist()) if len(watchlist) > 0 else set()
            covered = watchlist_symbols & set(symbols_with_levels)
            missing = watchlist_symbols - set(symbols_with_levels)
            print(f"  已有价位: {len(covered)}/{len(watchlist_symbols)} 只股票")
            if missing:
                print(f"  ⚠️  缺少价位: {', '.join(sorted(missing))}")
                print(f"     请运行分析以生成关键价位")
            for _, row in all_levels.iterrows():
                sym = row["symbol"]
                date = row.get("analysis_date", "未知")
                score = row.get("score", 0)
                print(f"    • {sym}  分析日期: {date}  评分: {score}/10")
        else:
            print("  ⚠️  暂无关键价位数据")
    except Exception:
        print("  ⚠️  暂无关键价位数据")

    # ---- 5. 今日告警记录 ----
    print("\n--- 🔔 今日告警 ---")
    try:
        from src.db import _get_or_create_table, ALERT_LOG_SCHEMA
        table = _get_or_create_table("alert_log", ALERT_LOG_SCHEMA)
        today = now.strftime("%Y-%m-%d")
        df = table.search().where(f"alert_date = '{today}'").to_pandas()
        if len(df) > 0:
            print(f"  今日已发送 {len(df)} 条告警:")
            for _, row in df.iterrows():
                sym = row["symbol"]
                rule = row["rule_name"]
                time_str = row.get("triggered_at", "")
                if time_str:
                    try:
                        t = datetime.fromisoformat(time_str)
                        time_str = t.strftime("%H:%M:%S")
                    except Exception:
                        pass
                print(f"    • [{time_str}] {sym} - {rule}")
        else:
            print("  📭 今日暂无告警")
    except Exception:
        print("  📭 今日暂无告警")

    # ---- 6. 配置摘要 ----
    print("\n--- ⚙️  监控配置 ---")
    interval = cfg.get("tickflow", {}).get("request_interval", 10)
    alert_cfg = cfg.get("alert", {})
    channel = alert_cfg.get("channel", "未配置")
    rules = cfg.get("alert_rules", {})
    print(f"  轮询间隔: {interval} 秒")
    print(f"  告警通道: {channel}")
    print(f"  止损缓冲: {rules.get('stop_loss_buffer', 0.005) * 100:.1f}%")
    print(f"  涨跌幅阈值: {rules.get('change_pct_threshold', 0.05) * 100:.0f}%")
    print(f"  量比阈值: {rules.get('volume_ratio_threshold', 3.0):.1f} 倍")

    print("\n" + "=" * 52)


if __name__ == "__main__":
    main()
