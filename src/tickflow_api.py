#!/usr/bin/env python3
"""
TickFlow HTTP API 客户端
通过 HTTP 请求获取日K线和实时行情数据

所有接口细节和字段映射在此模块内封装，
外部只需使用高层函数和标准 DataFrame。
"""

import time
from typing import Optional

import requests
import pandas as pd

from .config import get_config


# ============================================================
# 异常
# ============================================================

class TickFlowAPIError(Exception):
    """TickFlow API 调用异常"""
    pass


# ============================================================
# 内部工具
# ============================================================

def _get_headers() -> dict:
    cfg = get_config()
    return {
        "x-api-key": cfg["tickflow"]["api_key"],
        "Content-Type": "application/json",
    }


def _get_base_url() -> str:
    """
    返回 API 根地址（不含版本号）。
    版本号在各接口函数内拼接。
    """
    return get_config()["tickflow"]["api_url"].rstrip("/")


def _request_with_retry(method: str, url: str, **kwargs) -> requests.Response:
    """发送请求，遇到 429 自动重试一次"""
    resp = requests.request(method, url, headers=_get_headers(), timeout=30, **kwargs)
    if resp.status_code == 429:
        retry_after = int(resp.headers.get("Retry-After", 5))
        time.sleep(retry_after)
        resp = requests.request(method, url, headers=_get_headers(), timeout=30, **kwargs)
    resp.raise_for_status()
    return resp


# ============================================================
# K 线数据必需字段（来自官方 CompactKlineData schema）
# ============================================================

KLINE_REQUIRED_FIELDS = {"timestamp", "open", "high", "low", "close", "volume", "amount"}


def _validate_kline_data(data: dict, symbol: str = "") -> None:
    """
    校验单只股票的 CompactKlineData 返回值。

    Raises:
        TickFlowAPIError: 缺少必需字段
    """
    missing = KLINE_REQUIRED_FIELDS - set(data.keys())
    if missing:
        label = f" [{symbol}]" if symbol else ""
        raise TickFlowAPIError(
            f"K线数据缺少必需字段{label}: {', '.join(sorted(missing))}"
        )


# ============================================================
# K 线适配层：API 返回 → 标准 DataFrame
# ============================================================

def kline_data_to_dataframe(data: dict, symbol: Optional[str] = None) -> pd.DataFrame:
    """
    将 CompactKlineData（列式）转为标准 DataFrame。

    输出列: symbol, trade_date, timestamp, open, high, low, close,
            volume, amount, prev_close

    Args:
        data: 单只股票的 CompactKlineData dict
        symbol: 可选，如果提供会填入 symbol 列

    Returns:
        排序后的 DataFrame
    """
    _validate_kline_data(data, symbol or "")

    df = pd.DataFrame({
        "timestamp": data["timestamp"],
        "open": data["open"],
        "high": data["high"],
        "low": data["low"],
        "close": data["close"],
        "volume": data["volume"],
        "amount": data["amount"],
        "prev_close": data.get("prev_close", [0.0] * len(data["timestamp"])),
    })

    df["trade_date"] = pd.to_datetime(df["timestamp"], unit="ms").dt.strftime("%Y-%m-%d")

    if symbol:
        df["symbol"] = symbol

    df = df.sort_values("trade_date").reset_index(drop=True)
    return df


# ============================================================
# 批量 K 线接口（主接口）
# ============================================================

MAX_BATCH_SIZE = 100  # API 最大每次 100 只


def fetch_klines_batch(
    symbols: list[str],
    period: str = "1d",
    count: int = 90,
    adjust: str = "forward",
    start_time: Optional[int] = None,
    end_time: Optional[int] = None,
) -> dict:
    """
    批量获取 K 线数据。

    GET /v1/klines/batch?symbols=600000.SH,000001.SZ&period=1d&count=90

    Args:
        symbols: 股票代码列表（最多 100 只）
        period: K 线周期
        count: 获取根数
        adjust: 复权类型
        start_time: 开始时间（毫秒时间戳），可选
        end_time: 结束时间（毫秒时间戳），可选

    Returns:
        原始 API 响应 dict:
        {"data": {"600000.SH": CompactKlineData, ...}}
    """
    if len(symbols) > MAX_BATCH_SIZE:
        raise ValueError(f"单次最多查询 {MAX_BATCH_SIZE} 只股票，当前 {len(symbols)} 只")

    url = f"{_get_base_url()}/v1/klines/batch"
    params: dict = {
        "symbols": ",".join(symbols),
        "period": period,
        "count": count,
        "adjust": adjust,
    }
    if start_time is not None:
        params["start_time"] = start_time
    if end_time is not None:
        params["end_time"] = end_time

    try:
        resp = _request_with_retry("GET", url, params=params)
        return resp.json()
    except requests.exceptions.RequestException as e:
        raise TickFlowAPIError(f"批量获取K线数据失败: {e}")


def fetch_klines(
    symbol: str,
    period: str = "1d",
    count: int = 90,
    adjust: str = "forward",
    start_time: Optional[int] = None,
    end_time: Optional[int] = None,
) -> dict:
    """
    获取单只股票 K 线数据（底层复用批量接口）。

    Returns:
        {"data": CompactKlineData}（与旧接口兼容的格式）
    """
    batch_resp = fetch_klines_batch(
        [symbol], period=period, count=count,
        adjust=adjust, start_time=start_time, end_time=end_time,
    )
    symbol_data = batch_resp.get("data", {}).get(symbol, {})
    return {"data": symbol_data}


def fetch_klines_as_dataframe(
    symbol: str,
    period: str = "1d",
    count: int = 90,
    adjust: str = "forward",
    start_time: Optional[int] = None,
    end_time: Optional[int] = None,
) -> pd.DataFrame:
    """
    获取单只股票 K 线并直接返回标准 DataFrame。

    方便脚本层使用的高层接口。
    """
    resp = fetch_klines(symbol, period, count, adjust, start_time, end_time)
    data = resp.get("data", {})
    if not data or "timestamp" not in data:
        raise TickFlowAPIError(f"获取K线数据失败 [{symbol}]: 返回数据为空")
    return kline_data_to_dataframe(data, symbol=symbol)


def fetch_klines_batch_as_dataframes(
    symbols: list[str],
    period: str = "1d",
    count: int = 90,
    adjust: str = "forward",
    start_time: Optional[int] = None,
    end_time: Optional[int] = None,
) -> dict[str, pd.DataFrame]:
    """
    批量获取 K 线并按 symbol 返回 DataFrame 字典。

    如果 symbols 超过 MAX_BATCH_SIZE，自动分批请求。

    Returns:
        {"600000.SH": DataFrame, "000001.SZ": DataFrame, ...}
    """
    result = {}
    chunks = [symbols[i:i + MAX_BATCH_SIZE] for i in range(0, len(symbols), MAX_BATCH_SIZE)]

    for chunk in chunks:
        resp = fetch_klines_batch(
            chunk, period=period, count=count,
            adjust=adjust, start_time=start_time, end_time=end_time,
        )
        stock_data_map = resp.get("data", {})
        for sym, data in stock_data_map.items():
            if data and "timestamp" in data and len(data["timestamp"]) > 0:
                try:
                    result[sym] = kline_data_to_dataframe(data, symbol=sym)
                except TickFlowAPIError as e:
                    print(f"  ⚠️ {sym}: 数据校验失败 - {e}")

    return result


# ============================================================
# 实时行情接口
# ============================================================

def fetch_quotes(symbols: list[str]) -> dict:
    """
    批量获取实时行情

    POST /v1/quotes
    Body: {"symbols": ["600000.SH", "000001.SZ"]}

    返回:
    {
        "data": [
            {
                "symbol": "600000.SH",
                "last_price": 10.5,
                "prev_close": 10.3,
                ...
            }
        ]
    }
    """
    url = f"{_get_base_url()}/v1/quotes"
    payload = {"symbols": symbols}

    try:
        resp = _request_with_retry("POST", url, json=payload)
        return resp.json()
    except requests.exceptions.RequestException as e:
        raise TickFlowAPIError(f"获取实时行情失败: {e}")
