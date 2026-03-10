#!/usr/bin/env python3
"""
发送一条测试告警，验证当前 channel 投递链路
用法: python scripts/test_alert.py
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.alert import send_alert, format_system_notification
from src.config import load_config, get_config, china_now


def main():
    parser = argparse.ArgumentParser(description="发送测试告警")
    parser.add_argument("--config", default=None, help="配置文件路径")
    args = parser.parse_args()

    load_config(args.config)
    cfg = get_config()

    alert_cfg = cfg.get("alert", {})
    message = format_system_notification(
        "🧪 TickFlow 测试告警",
        [
            f"时间: {china_now().strftime('%Y-%m-%d %H:%M:%S')}",
            f"通道: {alert_cfg.get('channel', '未配置')}",
            "说明: 这是一条手动触发的测试消息，用于验证 OpenClaw channel 投递链路正常。",
        ],
    )

    if send_alert(message):
        print("✅ 测试告警发送成功")
        return

    print("❌ 测试告警发送失败")
    sys.exit(1)


if __name__ == "__main__":
    main()
