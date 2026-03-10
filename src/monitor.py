#!/usr/bin/env python3
"""
实时行情监控模块
定时获取实时行情，对比关键价位，按规则发送告警
"""

import time
import traceback

import pandas as pd

from .config import get_config, china_now
from .calendar import is_trading_day, is_trading_time
from .tickflow_api import fetch_quotes
from .db import (
    get_watchlist,
    get_key_levels,
    get_klines,
    is_alert_sent_this_session,
    log_alert,
)
from .alert import send_alert, format_price_alert, format_volume_alert


def _check_price_rules(
    symbol: str,
    name: str,
    current_price: float,
    levels: dict,
    cost_price: float,
    cfg: dict,
) -> list[tuple[str, str]]:
    """
    检查价格规则，返回需要触发的告警列表

    返回: [(rule_name, formatted_message), ...]
    """
    alerts = []
    rules = cfg.get("alert_rules", {})
    buffer = rules.get("stop_loss_buffer", 0.005)

    # 规则 1: 止损位
    stop_loss = levels.get("stop_loss", 0)
    if stop_loss > 0:
        # 价格触及或跌破止损位
        if current_price <= stop_loss:
            alerts.append((
                "stop_loss_hit",
                format_price_alert(
                    symbol, name, current_price,
                    "⛔ 触及止损", "价格已触及止损位，建议立即执行止损",
                    stop_loss, cost_price,
                ),
            ))
        # 接近止损位预警
        elif current_price <= stop_loss * (1 + buffer):
            alerts.append((
                "stop_loss_near",
                format_price_alert(
                    symbol, name, current_price,
                    "⚠️ 接近止损", "价格接近止损位，请保持警惕",
                    stop_loss, cost_price,
                ),
            ))

    # 规则 2: 突破位
    breakthrough = levels.get("breakthrough", 0)
    if breakthrough > 0 and current_price >= breakthrough:
        alerts.append((
            "breakthrough_hit",
            format_price_alert(
                symbol, name, current_price,
                "🚀 突破", "价格已突破关键压力位，可能开启新行情",
                breakthrough, cost_price,
            ),
        ))

    # 规则 3: 支撑位
    support = levels.get("support", 0)
    if support > 0 and current_price <= support * (1 + buffer):
        alerts.append((
            "support_near",
            format_price_alert(
                symbol, name, current_price,
                "📉 触及支撑", "价格接近支撑位，关注是否企稳",
                support, cost_price,
            ),
        ))

    # 规则 4: 压力位
    resistance = levels.get("resistance", 0)
    if resistance > 0:
        if current_price >= resistance * (1 - buffer):
            alerts.append((
                "resistance_near",
                format_price_alert(
                    symbol, name, current_price,
                    "📈 接近压力", "价格接近压力位，关注能否突破",
                    resistance, cost_price,
                ),
            ))

    # 规则 5: 止盈位
    take_profit = levels.get("take_profit", 0)
    if take_profit > 0 and current_price >= take_profit:
        alerts.append((
            "take_profit_hit",
            format_price_alert(
                symbol, name, current_price,
                "💰 触及止盈", "价格已达止盈位，建议分批止盈",
                take_profit, cost_price,
            ),
        ))

    return alerts


def _check_change_pct(
    symbol: str,
    name: str,
    current_price: float,
    prev_close: float,
    cost_price: float,
    cfg: dict,
) -> list[tuple[str, str]]:
    """检查涨跌幅异动"""
    alerts = []
    threshold = cfg.get("alert_rules", {}).get("change_pct_threshold", 0.05)

    if prev_close > 0:
        change_pct = (current_price - prev_close) / prev_close
        if abs(change_pct) >= threshold:
            direction = "涨" if change_pct > 0 else "跌"
            alerts.append((
                f"change_pct_{direction}",
                format_price_alert(
                    symbol, name, current_price,
                    f"📊 {direction}幅异动",
                    f"当日{direction}幅 {change_pct*100:+.2f}%，超过 {threshold*100:.0f}% 阈值",
                    prev_close, cost_price,
                ),
            ))

    return alerts


def run_monitor_once() -> int:
    """
    执行一次监控检查

    返回: 发送的告警数量
    """
    cfg = get_config()
    alert_count = 0

    # 获取关注列表
    watchlist = get_watchlist()
    if len(watchlist) == 0:
        return 0

    symbols = watchlist["symbol"].tolist()

    # 批量获取实时行情
    try:
        quotes_resp = fetch_quotes(symbols)
    except Exception as e:
        print(f"[监控] 获取行情失败: {e}")
        return 0

    quotes = quotes_resp.get("data", [])

    for quote in quotes:
        symbol = quote.get("symbol", "")
        current_price = quote.get("last_price", 0)
        prev_close = quote.get("prev_close", 0)
        volume = quote.get("volume", 0)
        name = quote.get("ext", {}).get("name", symbol)

        if current_price <= 0:
            continue

        # 获取该股票的成本价
        wl_match = watchlist[watchlist["symbol"] == symbol]
        cost_price = wl_match.iloc[0]["cost_price"] if len(wl_match) > 0 else 0
        watchlist_name = wl_match.iloc[0].get("name", "") if len(wl_match) > 0 else ""

        # 获取关键价位
        levels = get_key_levels(symbol)
        name = watchlist_name or quote.get("ext", {}).get("name", symbol)

        if levels:
            # 检查价格规则
            price_alerts = _check_price_rules(
                symbol, name, current_price, levels, cost_price, cfg
            )
            for rule_name, message in price_alerts:
                if not is_alert_sent_this_session(symbol, rule_name):
                    if send_alert(message):
                        log_alert(symbol, rule_name, message)
                        alert_count += 1
                        print(f"[告警] {symbol} - {rule_name}")

        # 检查涨跌幅
        change_alerts = _check_change_pct(
            symbol, name, current_price, prev_close, cost_price, cfg
        )
        for rule_name, message in change_alerts:
            if not is_alert_sent_this_session(symbol, rule_name):
                if send_alert(message):
                    log_alert(symbol, rule_name, message)
                    alert_count += 1

        # 检查成交量异动
        vol_threshold = cfg.get("alert_rules", {}).get("volume_ratio_threshold", 3.0)
        klines = get_klines(symbol)
        if len(klines) >= 5 and volume > 0:
            avg_vol = klines["volume"].tail(5).astype(float).mean()
            if avg_vol > 0:
                ratio = volume / avg_vol
                if ratio >= vol_threshold:
                    rule_name = "volume_spike"
                    if not is_alert_sent_this_session(symbol, rule_name):
                        msg = format_volume_alert(
                            symbol, name, current_price,
                            volume, avg_vol, ratio,
                        )
                        if send_alert(msg):
                            log_alert(symbol, rule_name, msg)
                            alert_count += 1

    return alert_count


def run_monitor_loop():
    """主监控循环（含单实例锁，防止 cron 重复启动）"""
    import os
    import signal

    LOCK_FILE = "/tmp/tickflow_monitor.pid"

    def _check_pid_alive(pid: int) -> bool:
        """检查 PID 对应的进程是否存在"""
        try:
            os.kill(pid, 0)
            return True
        except (OSError, ProcessLookupError):
            return False

    def _acquire_lock() -> bool:
        """获取单实例锁，返回是否成功"""
        if os.path.exists(LOCK_FILE):
            try:
                with open(LOCK_FILE, "r") as f:
                    old_pid = int(f.read().strip())
                if _check_pid_alive(old_pid):
                    print(f"[监控] 已有运行中的监控进程 (PID={old_pid})，退出")
                    return False
                else:
                    print(f"[监控] 发现过期锁文件 (PID={old_pid})，清理后继续")
            except (ValueError, IOError):
                pass

        with open(LOCK_FILE, "w") as f:
            f.write(str(os.getpid()))
        return True

    def _release_lock():
        """释放锁"""
        try:
            if os.path.exists(LOCK_FILE):
                with open(LOCK_FILE, "r") as f:
                    pid = int(f.read().strip())
                if pid == os.getpid():
                    os.remove(LOCK_FILE)
        except (ValueError, IOError, OSError):
            pass

    def _signal_handler(signum, frame):
        """信号处理：优雅退出"""
        print(f"\n[监控] 收到信号 {signum}，正在退出...")
        _release_lock()
        raise SystemExit(0)

    # 注册信号处理
    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)

    # 获取锁
    if not _acquire_lock():
        return

    cfg = get_config()
    interval = cfg.get("tickflow", {}).get("request_interval", 30)

    print(f"[监控] 启动实时监控 (PID={os.getpid()})，间隔 {interval} 秒")
    print(f"[监控] 交易时段: "
          f"{cfg['trading_hours']['morning_start']}-{cfg['trading_hours']['morning_end']}, "
          f"{cfg['trading_hours']['afternoon_start']}-{cfg['trading_hours']['afternoon_end']}")

    try:
        while True:
            try:
                now = china_now()

                if not is_trading_day():
                    # 非交易日，每分钟检查一次
                    print(f"[监控] {now.strftime('%Y-%m-%d')} 非交易日，等待中...")
                    time.sleep(60)
                    continue

                if not is_trading_time():
                    # 非交易时段，每 30 秒检查一次
                    print(f"[监控] {now.strftime('%H:%M:%S')} 非交易时段，等待中...")
                    time.sleep(30)
                    continue

                # 交易中，执行监控
                alert_count = run_monitor_once()
                if alert_count > 0:
                    print(f"[监控] {now.strftime('%H:%M:%S')} 发送 {alert_count} 条告警")

                time.sleep(interval)

            except KeyboardInterrupt:
                print("\n[监控] 已停止")
                break
            except Exception as e:
                print(f"[监控] 异常: {e}")
                traceback.print_exc()
                time.sleep(interval)
    finally:
        _release_lock()
