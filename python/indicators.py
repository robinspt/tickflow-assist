#!/usr/bin/env python3
"""
Python indicator engine retained from the original project.

Only this module should remain on the Python side after migration.
"""

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

    stoch = ta.momentum.StochasticOscillator(
        high=result["high"],
        low=result["low"],
        close=result["close"],
        window=9,
        smooth_window=3,
    )
    result["kdj_k"] = stoch.stoch()
    result["kdj_d"] = stoch.stoch_signal()
    result["kdj_j"] = 3 * result["kdj_k"] - 2 * result["kdj_d"]

    result["rsi_6"] = ta.momentum.RSIIndicator(close=result["close"], window=6).rsi()
    result["rsi_12"] = ta.momentum.RSIIndicator(close=result["close"], window=12).rsi()
    result["rsi_24"] = ta.momentum.RSIIndicator(close=result["close"], window=24).rsi()

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
