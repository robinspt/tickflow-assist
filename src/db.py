#!/usr/bin/env python3
"""
LanceDB 数据库操作模块
管理 watchlist, klines_daily, indicators, key_levels, alert_log 五张表

对外只暴露公开方法，脚本层不应直接调用 _get_or_create_table 等私有函数。
"""

import os
from datetime import datetime
from typing import Optional

import lancedb
import pyarrow as pa
import pandas as pd

from .config import get_config

_db = None


# ============================================================
# Schema 定义
# ============================================================

WATCHLIST_SCHEMA = pa.schema([
    pa.field("symbol", pa.utf8()),
    pa.field("cost_price", pa.float64()),
    pa.field("added_at", pa.utf8()),
])

KLINES_DAILY_SCHEMA = pa.schema([
    pa.field("symbol", pa.utf8()),
    pa.field("trade_date", pa.utf8()),
    pa.field("timestamp", pa.int64()),
    pa.field("open", pa.float64()),
    pa.field("high", pa.float64()),
    pa.field("low", pa.float64()),
    pa.field("close", pa.float64()),
    pa.field("volume", pa.int64()),
    pa.field("amount", pa.float64()),
    pa.field("prev_close", pa.float64()),
])

INDICATORS_SCHEMA = pa.schema([
    pa.field("symbol", pa.utf8()),
    pa.field("trade_date", pa.utf8()),
    # 均线
    pa.field("ma5", pa.float64()),
    pa.field("ma10", pa.float64()),
    pa.field("ma20", pa.float64()),
    pa.field("ma60", pa.float64()),
    # MACD
    pa.field("macd", pa.float64()),
    pa.field("macd_signal", pa.float64()),
    pa.field("macd_hist", pa.float64()),
    # KDJ
    pa.field("kdj_k", pa.float64()),
    pa.field("kdj_d", pa.float64()),
    pa.field("kdj_j", pa.float64()),
    # RSI
    pa.field("rsi_6", pa.float64()),
    pa.field("rsi_12", pa.float64()),
    pa.field("rsi_24", pa.float64()),
    # CCI
    pa.field("cci", pa.float64()),
    # BIAS
    pa.field("bias_6", pa.float64()),
    pa.field("bias_12", pa.float64()),
    pa.field("bias_24", pa.float64()),
    # DMI
    pa.field("plus_di", pa.float64()),
    pa.field("minus_di", pa.float64()),
    pa.field("adx", pa.float64()),
    # BOLL
    pa.field("boll_upper", pa.float64()),
    pa.field("boll_mid", pa.float64()),
    pa.field("boll_lower", pa.float64()),
])

KEY_LEVELS_SCHEMA = pa.schema([
    pa.field("symbol", pa.utf8()),
    pa.field("analysis_date", pa.utf8()),
    pa.field("current_price", pa.float64()),
    pa.field("stop_loss", pa.float64()),
    pa.field("breakthrough", pa.float64()),
    pa.field("support", pa.float64()),
    pa.field("cost_level", pa.float64()),
    pa.field("resistance", pa.float64()),
    pa.field("take_profit", pa.float64()),
    pa.field("gap", pa.float64()),
    pa.field("target", pa.float64()),
    pa.field("round_number", pa.float64()),
    pa.field("analysis_text", pa.utf8()),
    pa.field("score", pa.int64()),
])

ANALYSIS_LOG_SCHEMA = pa.schema([
    pa.field("symbol", pa.utf8()),
    pa.field("analysis_date", pa.utf8()),
    pa.field("analysis_text", pa.utf8()),
    pa.field("structured_ok", pa.bool_()),
])

ALERT_LOG_SCHEMA = pa.schema([
    pa.field("symbol", pa.utf8()),
    pa.field("alert_date", pa.utf8()),
    pa.field("rule_name", pa.utf8()),
    pa.field("message", pa.utf8()),
    pa.field("triggered_at", pa.utf8()),
])


# ============================================================
# DB 连接
# ============================================================

def get_db() -> lancedb.DBConnection:
    """获取 LanceDB 连接"""
    global _db
    if _db is not None:
        return _db

    cfg = get_config()
    db_path = cfg["database"]["path"]
    os.makedirs(db_path, exist_ok=True)
    _db = lancedb.connect(db_path)
    return _db


def _get_or_create_table(name: str, schema: pa.Schema):
    """获取或创建表（内部方法，脚本层不应直接调用）"""
    db = get_db()
    tables = db.list_tables()
    table_names = tables.tables if hasattr(tables, "tables") else tables
    if name in table_names:
        return db.open_table(name)
    else:
        return db.create_table(name, schema=schema)


# ============================================================
# Watchlist 操作
# ============================================================

def add_to_watchlist(symbol: str, cost_price: float) -> None:
    """添加股票到关注列表"""
    table = _get_or_create_table("watchlist", WATCHLIST_SCHEMA)

    # 检查是否已存在，如存在则更新
    existing = table.search().where(f"symbol = '{symbol}'").to_pandas()
    if len(existing) > 0:
        table.delete(f"symbol = '{symbol}'")

    data = pa.table({
        "symbol": [symbol],
        "cost_price": [cost_price],
        "added_at": [datetime.now().isoformat()],
    })
    table.add(data)


def remove_from_watchlist(symbol: str) -> None:
    """从关注列表移除"""
    table = _get_or_create_table("watchlist", WATCHLIST_SCHEMA)
    table.delete(f"symbol = '{symbol}'")


def get_watchlist() -> pd.DataFrame:
    """获取关注列表"""
    table = _get_or_create_table("watchlist", WATCHLIST_SCHEMA)
    return table.to_pandas()


# ============================================================
# K 线数据操作
# ============================================================

def save_klines(symbol: str, df: pd.DataFrame) -> None:
    """保存日K线数据（全量覆盖该股票的数据）"""
    table = _get_or_create_table("klines_daily", KLINES_DAILY_SCHEMA)

    # 删除该股票旧数据
    try:
        table.delete(f"symbol = '{symbol}'")
    except Exception:
        pass

    # 确保列类型正确
    df = df.copy()
    df["symbol"] = symbol
    required_cols = [f.name for f in KLINES_DAILY_SCHEMA]
    for col in required_cols:
        if col not in df.columns:
            df[col] = None

    data = pa.Table.from_pandas(df[required_cols], schema=KLINES_DAILY_SCHEMA)
    table.add(data)




def get_klines(symbol: str) -> pd.DataFrame:
    """获取日K线数据"""
    table = _get_or_create_table("klines_daily", KLINES_DAILY_SCHEMA)
    df = table.search().where(f"symbol = '{symbol}'").to_pandas()
    if len(df) > 0:
        df = df.sort_values("trade_date").reset_index(drop=True)
    return df


# ============================================================
# 技术指标操作
# ============================================================

def save_indicators(symbol: str, df: pd.DataFrame) -> None:
    """保存技术指标（全量覆盖该股票的数据）"""
    table = _get_or_create_table("indicators", INDICATORS_SCHEMA)

    try:
        table.delete(f"symbol = '{symbol}'")
    except Exception:
        pass

    df = df.copy()
    df["symbol"] = symbol
    required_cols = [f.name for f in INDICATORS_SCHEMA]
    for col in required_cols:
        if col not in df.columns:
            df[col] = None

    data = pa.Table.from_pandas(df[required_cols], schema=INDICATORS_SCHEMA)
    table.add(data)


def get_indicators(symbol: str) -> pd.DataFrame:
    """获取技术指标"""
    table = _get_or_create_table("indicators", INDICATORS_SCHEMA)
    df = table.search().where(f"symbol = '{symbol}'").to_pandas()
    if len(df) > 0:
        df = df.sort_values("trade_date").reset_index(drop=True)
    return df


# ============================================================
# 关键价位操作
# ============================================================

class KeyLevelsValidationError(ValueError):
    """关键价位校验异常"""
    pass


def _validate_key_levels(levels: dict) -> None:
    """
    校验关键价位数据完整性（fail-close）。

    Raises:
        KeyLevelsValidationError: 校验失败
    """
    # current_price 必须 > 0
    current_price = levels.get("current_price")
    if current_price is None or not isinstance(current_price, (int, float)) or current_price <= 0:
        raise KeyLevelsValidationError(
            f"current_price 必须为正数，当前值: {current_price}"
        )

    # score 必须 1-10
    score = levels.get("score")
    if score is None or not isinstance(score, (int, float)) or not (1 <= int(score) <= 10):
        raise KeyLevelsValidationError(
            f"score 必须为 1-10 的整数，当前值: {score}"
        )

    # 所有价位字段必须 >= 0
    price_fields = [
        "stop_loss", "breakthrough", "support", "cost_level",
        "resistance", "take_profit", "gap", "target", "round_number",
    ]
    for field in price_fields:
        val = levels.get(field, 0)
        if val is not None and isinstance(val, (int, float)) and val < 0:
            raise KeyLevelsValidationError(
                f"{field} 不能为负数，当前值: {val}"
            )


def save_key_levels(symbol: str, levels: dict) -> None:
    """
    保存关键价位数据（仅用于结构化解析成功的情况）。

    解析失败时不要调用此方法，改用 log_analysis()。
    这样不会覆盖已有的有效关键价位记录。

    Raises:
        KeyLevelsValidationError: 校验失败
    """
    _validate_key_levels(levels)

    table = _get_or_create_table("key_levels", KEY_LEVELS_SCHEMA)

    # 删除该股票旧数据
    try:
        table.delete(f"symbol = '{symbol}'")
    except Exception:
        pass

    data = pa.table({
        "symbol": [symbol],
        "analysis_date": [levels.get("analysis_date", datetime.now().strftime("%Y-%m-%d"))],
        "current_price": [float(levels.get("current_price", 0.0))],
        "stop_loss": [float(levels.get("stop_loss", 0.0))],
        "breakthrough": [float(levels.get("breakthrough", 0.0))],
        "support": [float(levels.get("support", 0.0))],
        "cost_level": [float(levels.get("cost_level", 0.0))],
        "resistance": [float(levels.get("resistance", 0.0))],
        "take_profit": [float(levels.get("take_profit", 0.0))],
        "gap": [float(levels.get("gap", 0.0))],
        "target": [float(levels.get("target", 0.0))],
        "round_number": [float(levels.get("round_number", 0.0))],
        "analysis_text": [levels.get("analysis_text", "")],
        "score": [int(levels.get("score", 0))],
    })
    table.add(data)


def log_analysis(symbol: str, analysis_text: str, structured_ok: bool) -> None:
    """
    记录分析日志（无论成功或失败都可记录）。

    独立于 key_levels 表，不会覆盖有效关键价位。
    """
    table = _get_or_create_table("analysis_log", ANALYSIS_LOG_SCHEMA)
    data = pa.table({
        "symbol": [symbol],
        "analysis_date": [datetime.now().strftime("%Y-%m-%d")],
        "analysis_text": [analysis_text],
        "structured_ok": [structured_ok],
    })
    table.add(data)


def get_key_levels(symbol: str) -> Optional[dict]:
    """获取关键价位数据（key_levels 表中只有校验通过的有效记录）"""
    table = _get_or_create_table("key_levels", KEY_LEVELS_SCHEMA)
    df = table.search().where(f"symbol = '{symbol}'").to_pandas()
    if len(df) == 0:
        return None
    row = df.iloc[-1]
    return row.to_dict()


def get_all_key_levels() -> pd.DataFrame:
    """获取所有股票的关键价位"""
    table = _get_or_create_table("key_levels", KEY_LEVELS_SCHEMA)
    return table.to_pandas()


# ============================================================
# 告警日志操作
# ============================================================

def _get_session_key() -> str:
    """
    获取当前交易时段标识，用于告警去重。

    上午盘(09:30-11:30) -> "YYYY-MM-DD_AM"
    下午盘(13:00-15:00) -> "YYYY-MM-DD_PM"
    其他时段归入最近的时段。
    """
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    # 13:00 之前算上午盘，13:00 及之后算下午盘
    if now.hour < 13:
        return f"{date_str}_AM"
    else:
        return f"{date_str}_PM"


def log_alert(symbol: str, rule_name: str, message: str) -> None:
    """记录告警日志（用于去重，按交易时段区分）"""
    table = _get_or_create_table("alert_log", ALERT_LOG_SCHEMA)
    data = pa.table({
        "symbol": [symbol],
        "alert_date": [_get_session_key()],
        "rule_name": [rule_name],
        "message": [message],
        "triggered_at": [datetime.now().isoformat()],
    })
    table.add(data)


def is_alert_sent_this_session(symbol: str, rule_name: str) -> bool:
    """检查当前交易时段是否已发送过同类告警（上午盘/下午盘各自独立）"""
    table = _get_or_create_table("alert_log", ALERT_LOG_SCHEMA)
    session_key = _get_session_key()
    df = table.search().where(
        f"symbol = '{symbol}' AND rule_name = '{rule_name}' AND alert_date = '{session_key}'"
    ).to_pandas()
    return len(df) > 0


# ============================================================
# 公开删除方法（供脚本层使用）
# ============================================================

def delete_symbol_data(symbol: str, keep_data: bool = False) -> list[str]:
    """
    删除指定股票的所有关联数据。

    Args:
        symbol: 股票代码
        keep_data: True 则仅删除 watchlist，保留 K 线/指标/价位数据

    Returns:
        已清理的表名列表
    """
    cleaned = []

    if not keep_data:
        tables_to_clean = [
            ("klines_daily", KLINES_DAILY_SCHEMA),
            ("indicators", INDICATORS_SCHEMA),
            ("key_levels", KEY_LEVELS_SCHEMA),
            ("analysis_log", ANALYSIS_LOG_SCHEMA),
            ("alert_log", ALERT_LOG_SCHEMA),
        ]
        for table_name, schema in tables_to_clean:
            try:
                table = _get_or_create_table(table_name, schema)
                table.delete(f"symbol = '{symbol}'")
                cleaned.append(table_name)
            except Exception:
                pass

    return cleaned
