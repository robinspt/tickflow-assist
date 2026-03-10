#!/usr/bin/env python3
"""
停止实时监控进程
用法: python scripts/stop_monitor.py [--force]

退出码语义（幂等）：
  0 — 监控已停止（无论是本次杀掉的、还是本来就没在跑）
  1 — 监控仍在运行，未能成功停止
"""

import argparse
import os
import signal
import sys
import time

LOCK_FILE = "/tmp/tickflow_monitor.pid"
MONITOR_SCRIPT = "realtime_monitor.py"


def _check_pid_alive(pid: int) -> bool:
    """检查 PID 对应的进程是否存在"""
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _is_monitor_process(pid: int) -> bool:
    """
    校验 PID 对应的进程确实是本项目的 realtime_monitor.py。

    通过 /proc/<pid>/cmdline 读取完整命令行参数，检查是否包含
    monitor 脚本的特征字符串，避免 PID 复用误杀无关进程。
    """
    try:
        cmdline_path = f"/proc/{pid}/cmdline"
        if not os.path.exists(cmdline_path):
            # 非 Linux 平台，回退到仅检查存活
            return _check_pid_alive(pid)
        with open(cmdline_path, "rb") as f:
            cmdline = f.read().decode("utf-8", errors="replace")
        # /proc/<pid>/cmdline 用 \x00 分隔参数
        return MONITOR_SCRIPT in cmdline
    except (OSError, IOError):
        return False


def _cleanup_lock():
    """清理锁文件"""
    try:
        if os.path.exists(LOCK_FILE):
            os.remove(LOCK_FILE)
    except OSError:
        pass


def stop_monitor(force: bool = False) -> bool:
    """
    停止监控进程（幂等语义）。

    Args:
        force: True 使用 SIGKILL 强制停止，False 使用 SIGTERM 优雅停止

    Returns:
        True  — 监控已停止（包括本来就没在运行的情况）
        False — 发送信号后进程仍未退出，停止失败
    """
    if not os.path.exists(LOCK_FILE):
        print("✅ 监控进程未在运行（无锁文件）")
        return True

    try:
        with open(LOCK_FILE, "r") as f:
            pid = int(f.read().strip())
    except (ValueError, IOError) as e:
        print(f"⚠️  读取锁文件失败: {e}")
        _cleanup_lock()
        print("🧹 已清理损坏的锁文件，监控视为已停止")
        return True

    if not _check_pid_alive(pid):
        print(f"✅ 监控进程已停止（PID={pid} 不存在）")
        _cleanup_lock()
        print("🧹 已清理残留锁文件")
        return True

    if not _is_monitor_process(pid):
        print(f"⚠️  PID={pid} 存活但不是监控进程（可能已被系统复用），跳过终止")
        _cleanup_lock()
        print("🧹 已清理过期锁文件，监控视为已停止")
        return True

    # 确认是监控进程，发送终止信号
    sig = signal.SIGKILL if force else signal.SIGTERM
    sig_name = "SIGKILL (强制)" if force else "SIGTERM (优雅)"

    print(f"📤 向监控进程 (PID={pid}) 发送 {sig_name} 信号...")

    try:
        os.kill(pid, sig)
    except ProcessLookupError:
        print(f"✅ 进程 (PID={pid}) 在发送信号前已退出")
        _cleanup_lock()
        return True
    except PermissionError:
        print(f"❌ 权限不足，无法终止进程 (PID={pid})")
        return False

    # 等待进程退出
    max_wait = 3 if force else 10
    for i in range(max_wait):
        time.sleep(1)
        if not _check_pid_alive(pid):
            print(f"✅ 监控进程已停止 (PID={pid})")
            _cleanup_lock()
            return True
        if not force:
            print(f"   等待进程退出... ({i + 1}/{max_wait}s)")

    if not force:
        print(f"⚠️  进程 {max_wait} 秒内未退出，尝试强制终止...")
        try:
            os.kill(pid, signal.SIGKILL)
            time.sleep(1)
            if not _check_pid_alive(pid):
                print(f"✅ 监控进程已强制停止 (PID={pid})")
                _cleanup_lock()
                return True
        except (ProcessLookupError, PermissionError):
            pass

    print(f"❌ 无法停止监控进程 (PID={pid})")
    return False


def main():
    parser = argparse.ArgumentParser(description="停止实时监控进程")
    parser.add_argument(
        "--force", action="store_true",
        help="强制停止（SIGKILL），不等待优雅退出",
    )
    args = parser.parse_args()

    success = stop_monitor(force=args.force)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
