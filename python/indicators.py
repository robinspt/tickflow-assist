#!/usr/bin/env python3
"""
Python indicator engine retained from the original project.

Only this module should remain on the Python side after migration.
"""

import numpy as np
import pandas as pd
import ta


def calculate_all_indicators(df: pd.DataFrame) -> pd.DataFrame:
    if len(df) == 0:
        raise ValueError("K-line data must contain at least 1 row")

    result = df.copy()
    sort_columns = [col for col in ["timestamp", "trade_date", "trade_time"] if col in result.columns]
    if sort_columns:
        result = result.sort_values(sort_columns, kind="stable").reset_index(drop=True)

    for col in ["open", "high", "low", "close"]:
        result[col] = result[col].astype(float)
    result["volume"] = result["volume"].astype(float)

    result["ma5"] = result["close"].rolling(window=5, min_periods=1).mean()
    result["ma10"] = result["close"].rolling(window=10, min_periods=1).mean()
    result["ma20"] = result["close"].rolling(window=20, min_periods=1).mean()
    result["ma60"] = result["close"].rolling(window=60, min_periods=1).mean()

    macd_indicator = ta.trend.MACD(
        close=result["close"],
        window_slow=26,
        window_fast=12,
        window_sign=9,
    )
    result["macd"] = macd_indicator.macd()
    result["macd_signal"] = macd_indicator.macd_signal()
    result["macd_hist"] = macd_indicator.macd_diff()

    kdj = calculate_china_kdj(
        high=result["high"],
        low=result["low"],
        close=result["close"],
        window=9,
        k_smooth=3,
        d_smooth=3,
    )
    result["kdj_k"] = kdj["kdj_k"]
    result["kdj_d"] = kdj["kdj_d"]
    result["kdj_j"] = kdj["kdj_j"]

    result["rsi_6"] = calculate_china_rsi(close=result["close"], window=6)
    result["rsi_12"] = calculate_china_rsi(close=result["close"], window=12)
    result["rsi_24"] = calculate_china_rsi(close=result["close"], window=24)

    result["cci"] = ta.trend.CCIIndicator(
        high=result["high"],
        low=result["low"],
        close=result["close"],
        window=14,
    ).cci()

    ma6 = result["close"].rolling(window=6, min_periods=1).mean()
    ma12 = result["close"].rolling(window=12, min_periods=1).mean()
    ma24 = result["close"].rolling(window=24, min_periods=1).mean()
    result["bias_6"] = (result["close"] - ma6) / ma6 * 100
    result["bias_12"] = (result["close"] - ma12) / ma12 * 100
    result["bias_24"] = (result["close"] - ma24) / ma24 * 100

    adx_indicator = ta.trend.ADXIndicator(
        high=result["high"],
        low=result["low"],
        close=result["close"],
        window=14,
    )
    result["plus_di"] = adx_indicator.adx_pos()
    result["minus_di"] = adx_indicator.adx_neg()
    result["adx"] = adx_indicator.adx()

    boll = ta.volatility.BollingerBands(
        close=result["close"],
        window=20,
        window_dev=2,
    )
    result["boll_upper"] = boll.bollinger_hband()
    result["boll_mid"] = boll.bollinger_mavg()
    result["boll_lower"] = boll.bollinger_lband()

    return result.where(pd.notnull(result), None)


def calculate_china_rsi(close: pd.Series, window: int) -> pd.Series:
    """Calculate RSI with the SMA-style smoothing commonly used by Chinese charting apps."""
    delta = close.diff().fillna(0.0)
    positive_move = delta.clip(lower=0.0)
    absolute_move = delta.abs()

    positive_avg = calculate_china_sma(positive_move, window)
    absolute_avg = calculate_china_sma(absolute_move, window)

    rsi = positive_avg.div(absolute_avg.replace(0.0, np.nan)) * 100.0
    return rsi.mask(absolute_avg.eq(0.0), 50.0)


def calculate_china_kdj(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    window: int,
    k_smooth: int,
    d_smooth: int,
) -> pd.DataFrame:
    """Calculate KDJ with the classic recursive smoothing used by Tongdaxin-style formulas."""
    lowest_low = low.rolling(window=window, min_periods=window).min()
    highest_high = high.rolling(window=window, min_periods=window).max()
    range_span = (highest_high - lowest_low).replace(0.0, np.nan)
    rsv = ((close - lowest_low) / range_span) * 100.0

    k_values = pd.Series(np.nan, index=close.index, dtype=float)
    d_values = pd.Series(np.nan, index=close.index, dtype=float)
    previous_k = 50.0
    previous_d = 50.0
    k_alpha = 1.0 / float(k_smooth)
    d_alpha = 1.0 / float(d_smooth)

    for index, rsv_value in enumerate(rsv):
        if np.isnan(rsv_value):
            continue
        previous_k = ((1.0 - k_alpha) * previous_k) + (k_alpha * float(rsv_value))
        previous_d = ((1.0 - d_alpha) * previous_d) + (d_alpha * previous_k)
        k_values.iat[index] = previous_k
        d_values.iat[index] = previous_d

    j_values = (3.0 * k_values) - (2.0 * d_values)
    return pd.DataFrame(
        {
            "kdj_k": k_values,
            "kdj_d": d_values,
            "kdj_j": j_values,
        }
    )


def calculate_china_sma(series: pd.Series, window: int, weight: int = 1) -> pd.Series:
    """Replicate SMA(X, N, M) with the recursive smoothing used by Chinese indicators."""
    alpha = float(weight) / float(window)
    return series.ewm(alpha=alpha, adjust=False).mean()
