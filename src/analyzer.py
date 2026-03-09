#!/usr/bin/env python3
"""
LLM 分析模块
调用模型进行技术分析，提取关键价位数据

核心逻辑：
- 模型产出 JSON 供程序解析
- 结构化解析失败 → fail-close，不写入无效价位
- 对用户展示简洁结论 + 关键价位表格，不回显原始 JSON
"""

import re
import json
from datetime import datetime
from typing import Optional

from openai import OpenAI
import pandas as pd

from .config import get_config
from .db import (
    get_klines, get_indicators, save_key_levels, log_analysis,
    KeyLevelsValidationError,
)


# ============================================================
# 异常
# ============================================================

class AnalysisParseError(RuntimeError):
    """LLM 返回结构化解析失败"""
    pass


# ============================================================
# 系统提示词
# ============================================================

SYSTEM_PROMPT = """你是一位专业的技术分析师，擅长通过K线形态、均线系统、成交量分析股票走势。

## 你的职责
1. 分析K线形态：识别头肩顶/底、双重顶/底、旗形、楔形等经典形态
2. 判断趋势方向：通过均线系统（MA5/10/20/60）判断多空趋势
3. 识别关键价格位置：根据下表依次分析各个关键位
4. 评估成交量：量价配合情况，放量突破还是缩量调整
5. 利用预计算技术指标：使用系统提供的 MACD、KDJ、RSI、CCI、BIAS、DMI 等指标辅助判断

## 核心技术指标（按优先级排序：生存 > 确认 > 进场 > 获利）

| 排名 | 名称 | 类别 | 核心含义 | 实战操作/关注点 |
| :--- | :--- | :--- | :--- | :--- |
| **NO.1** | **止损位** | **保命** | 交易的底线，错了必须认赔离场的红线 | 最重要！买入前必须先设好 |
| **NO.2** | **突破位** | **趋势** | 压力位被有效突破的点，意味着趋势反转或加速 | 最强买点，放量站上时建仓/加仓 |
| **NO.3** | **支撑位** | **结构** | 股价回落时的防守线（前低、均线等） | 高性价比买点，需配合止损位使用 |
| **NO.4** | **成本位** | **筹码** | 筹码密集峰的核心价格，代表主力或大众的持仓成本 | 股价在成本位之上为强势 |
| **NO.5** | **压力位** | **结构** | 股价上涨时的阻力线（前高、套牢区） | 潜在卖点 |
| **NO.6** | **止盈位** | **落袋** | 保护利润的卖出线 | 保住胜利果实 |
| **NO.7** | **缺口位** | **形态** | K线图上没有交易的真空区 | 强力参考 |
| **NO.8** | **目标位** | **预测** | 理论上的上涨终点 | 仅供参考 |
| **NO.9** | **整数关** | **心理** | 如10.00、100.00等整数价格 | 辅助判断 |

## 输出要求

**先输出简洁的分析结论（3-5 句话），包括趋势判断和操作建议，不要在正文中包含 JSON。**

**然后在最后用 ```json 块输出以下结构化数据（仅供程序解析，用户不会直接看到）：**

```json
{
  "current_price": 0.0,
  "stop_loss": 0.0,
  "breakthrough": 0.0,
  "support": 0.0,
  "cost_level": 0.0,
  "resistance": 0.0,
  "take_profit": 0.0,
  "gap": 0.0,
  "target": 0.0,
  "round_number": 0.0,
  "score": 5
}
```

其中 score 为技术面评分（1-10分，10分最看多）。无法判断的填 0。
所有价格字段必须填写真实数值，current_price 必须与最新收盘价一致。
"""


def _build_user_prompt(symbol: str, cost_price: float,
                       klines_df: pd.DataFrame,
                       indicators_df: pd.DataFrame) -> str:
    """构建用户提示词，包含K线数据和指标数据"""

    # 取最近30天的数据展示给 LLM
    recent_k = klines_df.tail(30)
    recent_ind = indicators_df.tail(30)

    # 构建 K 线数据文本
    kline_text = "## 日K线数据（最近30个交易日）\n\n"
    kline_text += "| 日期 | 开盘 | 最高 | 最低 | 收盘 | 成交量 | 成交额 |\n"
    kline_text += "| --- | --- | --- | --- | --- | --- | --- |\n"
    for _, row in recent_k.iterrows():
        kline_text += (
            f"| {row['trade_date']} | {row['open']:.2f} | {row['high']:.2f} | "
            f"{row['low']:.2f} | {row['close']:.2f} | {int(row['volume'])} | "
            f"{row.get('amount', 0):.0f} |\n"
        )

    # 构建指标数据文本
    ind_text = "\n## 技术指标（最近10个交易日）\n\n"
    recent_ind_10 = indicators_df.tail(10)

    def _fmt(v, decimals=2):
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return "-"
        return f"{v:.{decimals}f}"

    ind_text += "| 日期 | MA5 | MA10 | MA20 | MA60 | MACD | Signal | RSI6 | RSI12 | KDJ_K | KDJ_D | KDJ_J | CCI | ADX |\n"
    ind_text += "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n"
    for _, row in recent_ind_10.iterrows():
        ind_text += (
            f"| {row['trade_date']} | {_fmt(row.get('ma5'))} | {_fmt(row.get('ma10'))} | "
            f"{_fmt(row.get('ma20'))} | {_fmt(row.get('ma60'))} | {_fmt(row.get('macd'), 4)} | "
            f"{_fmt(row.get('macd_signal'), 4)} | {_fmt(row.get('rsi_6'))} | "
            f"{_fmt(row.get('rsi_12'))} | {_fmt(row.get('kdj_k'))} | "
            f"{_fmt(row.get('kdj_d'))} | {_fmt(row.get('kdj_j'))} | "
            f"{_fmt(row.get('cci'))} | {_fmt(row.get('adx'))} |\n"
        )

    # 最新指标状态
    latest = indicators_df.iloc[-1] if len(indicators_df) > 0 else None
    status_text = ""
    if latest is not None:
        status_text = "\n## 最新指标状态\n\n"
        status_text += f"- MACD: DIF={_fmt(latest.get('macd'), 4)}, DEA={_fmt(latest.get('macd_signal'), 4)}, 柱状={_fmt(latest.get('macd_hist'), 4)}\n"
        status_text += f"- KDJ: K={_fmt(latest.get('kdj_k'))}, D={_fmt(latest.get('kdj_d'))}, J={_fmt(latest.get('kdj_j'))}\n"
        status_text += f"- RSI: RSI6={_fmt(latest.get('rsi_6'))}, RSI12={_fmt(latest.get('rsi_12'))}, RSI24={_fmt(latest.get('rsi_24'))}\n"
        status_text += f"- CCI: {_fmt(latest.get('cci'))}\n"
        status_text += f"- BIAS: 6日={_fmt(latest.get('bias_6'))}, 12日={_fmt(latest.get('bias_12'))}, 24日={_fmt(latest.get('bias_24'))}\n"
        status_text += f"- DMI: +DI={_fmt(latest.get('plus_di'))}, -DI={_fmt(latest.get('minus_di'))}, ADX={_fmt(latest.get('adx'))}\n"
        status_text += f"- BOLL: 上轨={_fmt(latest.get('boll_upper'))}, 中轨={_fmt(latest.get('boll_mid'))}, 下轨={_fmt(latest.get('boll_lower'))}\n"

    latest_close = klines_df.iloc[-1]["close"] if len(klines_df) > 0 else 0

    prompt = f"""请分析以下股票的技术面，给出关键价位。

**股票代码**: {symbol}
**用户成本价**: {cost_price:.2f} 元
**最新收盘价**: {latest_close:.2f} 元

{kline_text}
{ind_text}
{status_text}

请给出简洁的技术分析结论和完整的关键价位数据。"""

    return prompt


def _parse_key_levels(response_text: str) -> Optional[dict]:
    """
    从 LLM 返回的文本中解析 JSON 格式的关键价位。

    Returns:
        解析成功返回 dict，失败返回 None（fail-close）
    """
    # 尝试提取 ```json ... ``` 块
    json_match = re.search(r"```json\s*\n(.*?)\n\s*```", response_text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass

    # 尝试直接查找 JSON 对象
    json_match = re.search(r"\{[^{}]*\"current_price\"[^{}]*\}", response_text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(0))
        except json.JSONDecodeError:
            pass

    # 解析失败，返回 None（不再返回空 dict）
    return None


def _extract_conclusion(analysis_text: str) -> str:
    """
    从分析文本中提取简洁结论（去掉 JSON 块）。

    用于对用户展示时不包含原始 JSON。
    """
    # 移除 ```json ... ``` 块
    cleaned = re.sub(r"```json\s*\n.*?\n\s*```", "", analysis_text, flags=re.DOTALL)
    # 清理多余空行
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned.strip())
    return cleaned


def format_analysis_for_user(analysis_text: str, levels: Optional[dict]) -> str:
    """
    格式化分析结果供用户查看。

    模型的 JSON 输出不对用户展示，改为程序渲染的简洁格式。
    """
    conclusion = _extract_conclusion(analysis_text)

    output_parts = [conclusion]

    if levels:
        output_parts.append("\n📊 关键价位汇总:")
        output_parts.append("-" * 45)

        price_fields = [
            ("当前价格", "current_price"),
            ("止损位", "stop_loss"),
            ("突破位", "breakthrough"),
            ("支撑位", "support"),
            ("成本位", "cost_level"),
            ("压力位", "resistance"),
            ("止盈位", "take_profit"),
            ("缺口位", "gap"),
            ("目标位", "target"),
            ("整数关", "round_number"),
        ]
        for label, key in price_fields:
            val = levels.get(key, 0)
            if val and val > 0:
                output_parts.append(f"  {label}: {val:.2f}")
            else:
                output_parts.append(f"  {label}: 暂无")

        score = levels.get("score", 0)
        output_parts.append(f"\n  技术面评分: {score}/10")
        output_parts.append("-" * 45)

    return "\n".join(output_parts)


def analyze_stock(symbol: str, cost_price: float = 0.0) -> tuple[str, Optional[dict]]:
    """
    对股票进行 LLM 技术分析。

    返回: (分析文本, 关键价位字典 or None)
        - 结构化解析成功 + 校验通过 → 写库，返回 (text, levels)
        - 结构化解析失败或校验失败 → 不写库，返回 (text, None)
    """
    cfg = get_config()

    # 获取数据
    klines_df = get_klines(symbol)
    indicators_df = get_indicators(symbol)

    if len(klines_df) == 0:
        raise ValueError(f"没有找到 {symbol} 的K线数据，请先执行 fetch_klines")
    if len(indicators_df) == 0:
        raise ValueError(f"没有找到 {symbol} 的指标数据，请先执行 fetch_klines")

    # 如果没有传入成本价，尝试从 watchlist 获取
    if cost_price <= 0:
        from .db import get_watchlist
        wl = get_watchlist()
        match = wl[wl["symbol"] == symbol]
        if len(match) > 0:
            cost_price = match.iloc[0]["cost_price"]

    # 构建提示词
    user_prompt = _build_user_prompt(symbol, cost_price, klines_df, indicators_df)

    # 调用 LLM
    client = OpenAI(
        base_url=cfg["llm"]["base_url"],
        api_key=cfg["llm"]["api_key"],
    )

    response = client.chat.completions.create(
        model=cfg["llm"]["model"],
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=cfg["llm"].get("max_tokens", 4096),
        temperature=cfg["llm"].get("temperature", 0.3),
    )

    analysis_text = response.choices[0].message.content

    # 解析关键价位
    levels = _parse_key_levels(analysis_text)

    if levels is None:
        # 结构化解析失败 → 仅记录分析日志，不动 key_levels（保护已有有效价位）
        log_analysis(symbol, analysis_text, structured_ok=False)
        return analysis_text, None

    # 补充元信息
    levels["analysis_text"] = analysis_text
    levels["analysis_date"] = datetime.now().strftime("%Y-%m-%d")

    # 校验并写库
    try:
        save_key_levels(symbol, levels)
        log_analysis(symbol, analysis_text, structured_ok=True)
    except KeyLevelsValidationError as e:
        # 校验失败 → 仅记录日志，不覆盖已有有效价位
        log_analysis(symbol, analysis_text, structured_ok=False)
        return analysis_text, None

    return analysis_text, levels
