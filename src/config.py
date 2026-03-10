#!/usr/bin/env python3
"""
配置加载模块
从 config.yaml 加载全局配置，支持环境变量覆盖
"""

import os
from datetime import datetime, date, timezone, timedelta
import yaml
from pathlib import Path

# ============================================================
# 时区定义 — 所有模块统一使用东八区
# ============================================================

CHINA_TZ = timezone(timedelta(hours=8))


def china_now() -> datetime:
    """返回东八区当前时间（aware datetime）"""
    return datetime.now(CHINA_TZ)


def china_today() -> date:
    """返回东八区当前日期"""
    return china_now().date()


_config = None
_CONFIG_DIR = Path(__file__).resolve().parent.parent


def load_config(config_path: str | None = None) -> dict:
    """加载配置文件"""
    global _config
    if _config is not None and config_path is None:
        return _config

    if config_path is None:
        config_path = _CONFIG_DIR / "config.yaml"
    else:
        config_path = Path(config_path)

    if not config_path.exists():
        raise FileNotFoundError(f"配置文件不存在: {config_path}")

    with open(config_path, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    # 环境变量覆盖
    env_overrides = {
        "llm.api_key": "LLM_API_KEY",
        "llm.base_url": "LLM_BASE_URL",
        "llm.model": "LLM_MODEL",
        "tickflow.api_key": "TICKFLOW_API_KEY",
        "tickflow.api_url": "TICKFLOW_API_URL",
        "alert.channel": "ALERT_CHANNEL",
        "alert.account": "ALERT_ACCOUNT",
        "alert.target": "ALERT_TARGET",
    }

    for cfg_path, env_key in env_overrides.items():
        env_val = os.environ.get(env_key)
        if env_val:
            keys = cfg_path.split(".")
            d = cfg
            for k in keys[:-1]:
                d = d.setdefault(k, {})
            d[keys[-1]] = env_val

    # 将相对路径转换为绝对路径
    if not os.path.isabs(cfg.get("database", {}).get("path", "")):
        cfg["database"]["path"] = str(_CONFIG_DIR / cfg["database"]["path"])

    if not os.path.isabs(cfg.get("calendar", {}).get("file", "")):
        cfg["calendar"]["file"] = str(_CONFIG_DIR / cfg["calendar"]["file"])

    _config = cfg
    return cfg


def get_config() -> dict:
    """获取已加载的配置"""
    if _config is None:
        return load_config()
    return _config
