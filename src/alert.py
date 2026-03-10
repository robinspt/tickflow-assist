#!/usr/bin/env python3
"""
告警发送模块
通过 OpenClaw Webhook 向指定通道发送告警消息
"""

import requests
from .config import get_config


def send_alert(message: str) -> bool:
    """
    通过 OpenClaw Webhook 发送告警消息

    使用 POST /hooks/agent 接口，让 OpenClaw Agent 将消息发送到目标通道
    """
    cfg = get_config()
    alert_cfg = cfg.get("alert", {})

    gateway_url = alert_cfg.get("openclaw_gateway", "http://127.0.0.1:18789")
    token = alert_cfg.get("openclaw_token", "")
    channel = alert_cfg.get("channel", "telegram")
    account = alert_cfg.get("account", "")
    target = alert_cfg.get("target", "")

    url = f"{gateway_url.rstrip('/')}/hooks/agent"
    headers = {
        "Content-Type": "application/json",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    payload = {
        "message": message,
        "delivery": {
            "channel": channel,
        },
    }
    if target:
        payload["delivery"]["to"] = target
    if account:
        payload["delivery"]["account"] = account

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=10)
        if resp.status_code == 200:
            return True
        else:
            print(f"[告警] 发送失败: HTTP {resp.status_code} - {resp.text}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"[告警] 发送异常: {e}")
        return False


def format_system_notification(title: str, lines: list[str]) -> str:
    """格式化系统通知/生命周期通知。"""
    body = "\n".join(lines)
    return f"{title}\n\n{body}".strip()


def format_price_alert(
    symbol: str,
    name: str,
    current_price: float,
    rule_name: str,
    rule_desc: str,
    level_price: float,
    cost_price: float = 0,
) -> str:
    """格式化价格告警消息"""
    profit_pct = ""
    if cost_price > 0:
        pct = (current_price - cost_price) / cost_price * 100
        profit_pct = f"\n💰 持仓盈亏: {pct:+.2f}%（成本 {cost_price:.2f}）"

    msg = (
        f"🚨 **{rule_name}告警** 🚨\n\n"
        f"📌 {name}（{symbol}）\n"
        f"💹 当前价: {current_price:.2f}\n"
        f"📊 触发价位: {level_price:.2f}\n"
        f"📝 {rule_desc}"
        f"{profit_pct}\n"
        f"\n⏰ 请及时关注！"
    )
    return msg


def format_volume_alert(
    symbol: str,
    name: str,
    current_price: float,
    current_volume: int,
    avg_volume: float,
    ratio: float,
) -> str:
    """格式化成交量异常告警"""
    msg = (
        f"📊 **成交量异动** 📊\n\n"
        f"📌 {name}（{symbol}）\n"
        f"💹 当前价: {current_price:.2f}\n"
        f"📈 当前成交量: {current_volume:,}\n"
        f"📉 近5日均量: {avg_volume:,.0f}\n"
        f"⚡ 量比: {ratio:.1f}倍\n"
        f"\n⚠️ 成交量显著放大，请关注盘面变化！"
    )
    return msg
