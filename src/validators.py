#!/usr/bin/env python3
"""
A 股代码校验模块
统一校验股票代码合法性，所有入口共用
"""

import re

# A 股合法交易所后缀
VALID_EXCHANGES = {"SH", "SZ", "BJ"}

# 各交易所允许的代码前缀
EXCHANGE_PREFIX_RULES = {
    "SH": {
        "60": "主板",
        "68": "科创板",
    },
    "SZ": {
        "00": "主板",
        "30": "创业板",
    },
    "BJ": {
        "8": "北交所",
        "4": "北交所",
    },
}


class InvalidSymbolError(ValueError):
    """非法股票代码异常"""
    pass


def validate_a_share_symbol(symbol: str) -> str:
    """
    校验 A 股代码合法性，返回标准化后的代码。

    校验规则：
    1. 格式: XXXXXX.XX（6位数字 + 交易所后缀）
    2. 交易所后缀: SH / SZ / BJ
    3. 代码前缀: 匹配对应交易所的合法前缀

    Args:
        symbol: 股票代码，如 "600000.SH"

    Returns:
        标准化后的股票代码（大写）

    Raises:
        InvalidSymbolError: 代码不合法
    """
    symbol = symbol.strip().upper()

    # 格式校验
    pattern = re.compile(r"^(\d{6})\.([A-Z]{2})$")
    match = pattern.match(symbol)
    if not match:
        raise InvalidSymbolError(
            f"代码格式错误: '{symbol}'，应为 6 位数字 + 交易所后缀（如 600000.SH）"
        )

    code, exchange = match.group(1), match.group(2)

    # 交易所校验
    if exchange not in VALID_EXCHANGES:
        raise InvalidSymbolError(
            f"不支持的交易所后缀: '{exchange}'，仅支持 {', '.join(sorted(VALID_EXCHANGES))}"
        )

    # 前缀校验
    prefix_rules = EXCHANGE_PREFIX_RULES.get(exchange, {})
    matched_prefix = False
    for prefix in prefix_rules:
        if code.startswith(prefix):
            matched_prefix = True
            break

    if not matched_prefix:
        allowed = ", ".join(f"{p}x ({desc})" for p, desc in prefix_rules.items())
        raise InvalidSymbolError(
            f"代码前缀不合法: '{code}' 不属于 {exchange} 交易所允许的范围 [{allowed}]"
        )

    return symbol
