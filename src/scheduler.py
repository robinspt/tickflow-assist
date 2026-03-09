#!/usr/bin/env python3
"""
任务管理模块
统一管理 daily_update 和 realtime_monitor 两类定时任务

使用系统 crontab 注册定时任务：
- daily_update: 交易日 15:35 执行收盘更新（单次执行后退出）
- realtime_monitor: 交易日 09:25 启动实时监控（常驻进程，内置 PID 锁防重复）

注意：如果 OpenClaw 插件体系有自己的调度能力，
可替换此模块的实现，但接口保持不变。
"""

import os
import sys
import subprocess
from pathlib import Path

# 任务标识（用于 crontab 注释标记）
TASK_TAG = "# tickflow_plugin"

# 项目根目录
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Python 解释器
PYTHON_BIN = sys.executable


def _get_crontab_entries() -> list[dict]:
    """
    定义所有定时任务条目。

    Returns:
        [{"name": ..., "schedule": ..., "command": ...}, ...]
    """
    return [
        {
            "name": "daily_update",
            "schedule": "35 15 * * 1-5",  # 周一到周五 15:35
            "command": f"cd {PROJECT_ROOT} && {PYTHON_BIN} scripts/update_all.py >> /tmp/tickflow_daily_update.log 2>&1",
        },
        {
            "name": "realtime_monitor",
            "schedule": "25 9 * * 1-5",  # 周一到周五 09:25
            "command": f"cd {PROJECT_ROOT} && {PYTHON_BIN} scripts/realtime_monitor.py >> /tmp/tickflow_realtime_monitor.log 2>&1",
        },
    ]


def _read_crontab() -> str:
    """读取当前用户 crontab 内容"""
    try:
        result = subprocess.run(
            ["crontab", "-l"],
            capture_output=True, text=True, check=False,
        )
        if result.returncode == 0:
            return result.stdout
        return ""
    except FileNotFoundError:
        return ""


def _write_crontab(content: str) -> None:
    """写入 crontab 内容"""
    proc = subprocess.Popen(
        ["crontab", "-"],
        stdin=subprocess.PIPE, text=True,
    )
    proc.communicate(input=content)
    if proc.returncode != 0:
        raise RuntimeError("写入 crontab 失败")


def register_tasks() -> list[str]:
    """
    注册定时任务到 crontab。

    已存在的同名条目会被跳过。

    Returns:
        新注册的任务名列表
    """
    current = _read_crontab()
    entries = _get_crontab_entries()
    registered = []

    lines = current.rstrip("\n").split("\n") if current.strip() else []

    for entry in entries:
        tag_line = f"{TASK_TAG}:{entry['name']}"
        cron_line = f"{entry['schedule']}  {entry['command']}"

        # 检查是否已存在
        if tag_line in current:
            continue

        lines.append(tag_line)
        lines.append(cron_line)
        registered.append(entry["name"])

    if registered:
        _write_crontab("\n".join(lines) + "\n")

    return registered


def unregister_tasks() -> list[str]:
    """
    从 crontab 移除所有 tickflow_plugin 任务。

    Returns:
        已移除的任务名列表
    """
    current = _read_crontab()
    if not current.strip():
        return []

    lines = current.split("\n")
    new_lines = []
    removed = []
    skip_next = False

    for line in lines:
        if line.startswith(TASK_TAG):
            name = line.split(":", 1)[1] if ":" in line else "unknown"
            removed.append(name)
            skip_next = True
            continue
        if skip_next:
            skip_next = False
            continue
        new_lines.append(line)

    if removed:
        _write_crontab("\n".join(new_lines) + "\n" if new_lines else "")

    return removed


def list_tasks() -> list[dict]:
    """
    列出已注册的 tickflow_plugin 定时任务。

    Returns:
        [{"name": ..., "schedule": ..., "command": ...}, ...]
    """
    current = _read_crontab()
    if not current.strip():
        return []

    lines = current.split("\n")
    tasks = []
    for i, line in enumerate(lines):
        if line.startswith(TASK_TAG):
            name = line.split(":", 1)[1] if ":" in line else "unknown"
            command_line = lines[i + 1] if i + 1 < len(lines) else ""
            # 解析 schedule 和 command
            parts = command_line.strip().split(None, 5)
            if len(parts) >= 6:
                schedule = " ".join(parts[:5])
                command = parts[5]
            else:
                schedule = command_line
                command = ""
            tasks.append({"name": name, "schedule": schedule, "command": command})

    return tasks
