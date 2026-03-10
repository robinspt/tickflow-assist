#!/usr/bin/env python3
"""
交易日历模块
加载交易日历，判断交易日和交易时间

所有涉及交易时段判断的逻辑统一在此模块，
其他模块不应自行解释时间规则。
"""

from datetime import datetime, time, date
from pathlib import Path
from typing import Optional

from .config import get_config, china_now, china_today

_trading_days: set[str] | None = None


def _load_trading_days() -> set[str]:
    """从 day_future.txt 加载交易日历"""
    global _trading_days
    if _trading_days is not None:
        return _trading_days

    cfg = get_config()
    cal_file = Path(cfg["calendar"]["file"])

    if not cal_file.exists():
        raise FileNotFoundError(f"交易日历文件不存在: {cal_file}")

    days = set()
    with open(cal_file, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                days.add(line)

    _trading_days = days
    return days


def _get_trading_hours() -> dict:
    """获取交易时段配置"""
    cfg = get_config()
    hours = cfg["trading_hours"]
    return {
        "morning_start": time.fromisoformat(hours["morning_start"]),
        "morning_end": time.fromisoformat(hours["morning_end"]),
        "afternoon_start": time.fromisoformat(hours["afternoon_start"]),
        "afternoon_end": time.fromisoformat(hours["afternoon_end"]),
    }


# ============================================================
# 交易日判断
# ============================================================

def is_trading_day(d: Optional[date] = None) -> bool:
    """判断是否为交易日"""
    if d is None:
        d = china_today()
    days = _load_trading_days()
    return d.strftime("%Y-%m-%d") in days


# ============================================================
# 交易时段判断（统一入口）
# ============================================================

def is_trading_time(dt: Optional[datetime] = None) -> bool:
    """判断是否在交易时段内（同时满足交易日 + 交易时间）"""
    if dt is None:
        dt = china_now()

    if not is_trading_day(dt.date()):
        return False

    hours = _get_trading_hours()
    current_time = dt.time()

    in_morning = hours["morning_start"] <= current_time <= hours["morning_end"]
    in_afternoon = hours["afternoon_start"] <= current_time <= hours["afternoon_end"]

    return in_morning or in_afternoon


def is_after_market_close(dt: Optional[datetime] = None) -> bool:
    """
    判断当天是否已收盘（交易日 + 已过收盘时间）。

    注意：非交易日返回 False（收盘概念仅对交易日有效）。
    """
    if dt is None:
        dt = china_now()

    if not is_trading_day(dt.date()):
        return False

    hours = _get_trading_hours()
    return dt.time() >= hours["afternoon_end"]


def is_before_market_open(dt: Optional[datetime] = None) -> bool:
    """判断当天交易日是否还未开盘"""
    if dt is None:
        dt = china_now()

    if not is_trading_day(dt.date()):
        return False

    hours = _get_trading_hours()
    return dt.time() < hours["morning_start"]


def can_run_daily_update(force: bool = False, dt: Optional[datetime] = None) -> tuple[bool, str]:
    """
    判断能否执行收盘后日更新。

    条件：交易日 + 当前时间 >= 15:30（留30分钟缓冲给收盘集合竞价后的数据刷新）。

    Args:
        force: 强制执行，跳过时间检查
        dt: 判断时间点，默认当前

    Returns:
        (can_run, reason) — 是否可执行 + 原因说明
    """
    if force:
        return True, "强制执行模式"

    if dt is None:
        dt = china_now()

    if not is_trading_day(dt.date()):
        return False, f"{dt.strftime('%Y-%m-%d')} 非交易日"

    # 收盘后至少等 30 分钟（15:00 + 30min = 15:30）
    update_allowed_time = time(15, 30)
    if dt.time() < update_allowed_time:
        return False, f"当前 {dt.strftime('%H:%M')}，须等到 15:30 后执行（或使用 --force）"

    return True, "交易日已收盘"


# ============================================================
# 交易日查询
# ============================================================

def get_latest_trading_day(before: Optional[date] = None) -> str:
    """获取最近一个已完成的交易日（不含当日，如果当日交易尚未结束）"""
    days = _load_trading_days()
    sorted_days = sorted(days, reverse=True)

    if before is None:
        before = china_today()

    before_str = before.strftime("%Y-%m-%d")
    hours = _get_trading_hours()

    now = china_now()
    for d in sorted_days:
        if d < before_str:
            return d
        elif d == before_str and now.time() > hours["afternoon_end"]:
            return d

    raise ValueError("找不到可用的交易日")


def get_recent_trading_days(n: int, before: Optional[date] = None) -> list[str]:
    """获取最近 n 个已完成的交易日列表（日期降序）"""
    days = _load_trading_days()
    sorted_days = sorted(days, reverse=True)

    if before is None:
        before = china_today()

    before_str = before.strftime("%Y-%m-%d")
    now = china_now()
    hours = _get_trading_hours()

    result = []
    for d in sorted_days:
        if len(result) >= n:
            break
        if d < before_str:
            result.append(d)
        elif d == before_str and now.time() > hours["afternoon_end"]:
            result.append(d)

    return result
