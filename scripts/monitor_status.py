#!/usr/bin/env python3
"""
查看实时监控运行状态
用法: python scripts/monitor_status.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime
from src.config import china_now

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


def _format_quote_time(quote: dict, fallback_dt: datetime) -> str:
    """格式化行情时间，优先使用 quotes.data.timestamp，缺失时回退到查询时间。"""
    raw = quote.get("timestamp")
    if raw in (None, ""):
        return fallback_dt.strftime("%H:%M:%S")

    try:
        if isinstance(raw, (int, float)):
            # TickFlow quotes.data.timestamp 为 Unix 时间戳；兼容秒/毫秒两种精度。
            ts = raw / 1000 if raw > 1_000_000_000_000 else raw
            return datetime.fromtimestamp(ts, tz=fallback_dt.tzinfo).strftime("%H:%M:%S")
        if isinstance(raw, str):
            try:
                return datetime.fromisoformat(raw).strftime("%H:%M:%S")
            except ValueError:
                return raw
    except Exception:
        pass

    return fallback_dt.strftime("%H:%M:%S")


def main():
    from src.config import load_config
    from src.calendar import is_trading_day, is_trading_time
    from src.db import get_watchlist, get_all_key_levels
    from src.tickflow_api import fetch_quotes, TickFlowAPIError

    load_config()
    from src.config import get_config
    cfg = get_config()

    now = china_now()
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
            name = row.get("name") or symbol
            cost = row["cost_price"]
            print(f"    • {name}（{symbol}）  成本: {cost:.2f}")
    else:
        print("  ⚠️  关注列表为空（监控无目标）")

    # ---- 4. 最新行情快照 ----
    print("\n--- 💹 最新行情 ---")
    if len(watchlist) > 0:
        symbols = watchlist["symbol"].tolist()
        name_map = {
            row["symbol"]: (row.get("name") or row["symbol"])
            for _, row in watchlist.iterrows()
        }
        try:
            quotes = fetch_quotes(symbols).get("data", [])
            quote_map = {quote.get("symbol"): quote for quote in quotes if quote.get("symbol")}
            for symbol in symbols:
                quote = quote_map.get(symbol)
                name = name_map.get(symbol, symbol)
                if not quote:
                    print(f"    • {name}（{symbol}）  ⚠️ 未获取到最新行情")
                    continue

                last_price = quote.get("last_price", 0)
                prev_close = quote.get("prev_close", 0)
                ext = quote.get("ext", {}) or {}
                if ext.get("change_pct") is not None:
                    change_pct = float(ext["change_pct"]) * 100
                    change_text = f"{change_pct:+.2f}%"
                elif prev_close and last_price:
                    change_pct = (last_price - prev_close) / prev_close * 100
                    change_text = f"{change_pct:+.2f}%"
                else:
                    change_text = "未知"
                quote_time = _format_quote_time(quote, now)
                print(
                    f"    • {name}（{symbol}）  最新价: {last_price:.2f}  "
                    f"涨跌幅: {change_text}  时间: {quote_time}"
                )
        except TickFlowAPIError as e:
            print(f"  ⚠️  获取最新行情失败: {e}")
    else:
        print("  ⚠️  无关注股票，未查询实时行情")

    # ---- 5. 关键价位覆盖 ----
    print("\n--- 🎯 关键价位 ---")
    try:
        all_levels = get_all_key_levels()
        if len(all_levels) > 0:
            name_map = {
                row["symbol"]: (row.get("name") or row["symbol"])
                for _, row in watchlist.iterrows()
            }
            symbols_with_levels = all_levels["symbol"].unique()
            watchlist_symbols = set(watchlist["symbol"].tolist()) if len(watchlist) > 0 else set()
            covered = watchlist_symbols & set(symbols_with_levels)
            missing = watchlist_symbols - set(symbols_with_levels)
            print(f"  已有价位: {len(covered)}/{len(watchlist_symbols)} 只股票")
            if missing:
                missing_labels = [f"{name_map.get(sym, sym)}（{sym}）" for sym in sorted(missing)]
                print(f"  ⚠️  缺少价位: {', '.join(missing_labels)}")
                print(f"     请运行分析以生成关键价位")
            for _, row in all_levels.iterrows():
                sym = row["symbol"]
                name = name_map.get(sym, sym)
                date = row.get("analysis_date", "未知")
                score = row.get("score", 0)
                print(f"    • {name}（{sym}）  分析日期: {date}  评分: {score}/10")
        else:
            print("  ⚠️  暂无关键价位数据")
    except Exception:
        print("  ⚠️  暂无关键价位数据")

    # ---- 6. 今日告警记录 ----
    print("\n--- 🔔 今日告警 ---")
    try:
        from src.db import _get_or_create_table, ALERT_LOG_SCHEMA
        table = _get_or_create_table("alert_log", ALERT_LOG_SCHEMA)
        today = now.strftime("%Y-%m-%d")
        today_am = f"{today}_AM"
        today_pm = f"{today}_PM"
        df = table.search().where(
            f"alert_date IN ('{today_am}', '{today_pm}')"
        ).to_pandas()
        if len(df) > 0:
            name_map = {
                row["symbol"]: (row.get("name") or row["symbol"])
                for _, row in watchlist.iterrows()
            }
            print(f"  今日已发送 {len(df)} 条告警:")
            for _, row in df.iterrows():
                sym = row["symbol"]
                name = name_map.get(sym, sym)
                rule = row["rule_name"]
                time_str = row.get("triggered_at", "")
                if time_str:
                    try:
                        t = datetime.fromisoformat(time_str)
                        time_str = t.strftime("%H:%M:%S")
                    except Exception:
                        pass
                print(f"    • [{time_str}] {name}（{sym}） - {rule}")
        else:
            print("  📭 今日暂无告警")
    except Exception:
        print("  📭 今日暂无告警")

    # ---- 7. 配置摘要 ----
    print("\n--- ⚙️  监控配置 ---")
    interval = cfg.get("tickflow", {}).get("request_interval", 30)
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
