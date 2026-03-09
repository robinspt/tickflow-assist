#!/usr/bin/env python3
"""
初始化/管理定时任务
用法:
  python scripts/init_scheduler.py             # 注册定时任务
  python scripts/init_scheduler.py --list       # 查看已注册任务
  python scripts/init_scheduler.py --remove     # 移除所有定时任务
"""

import argparse
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.scheduler import register_tasks, unregister_tasks, list_tasks


def main():
    parser = argparse.ArgumentParser(description="管理 TickFlow 插件定时任务")
    parser.add_argument("--list", action="store_true", help="查看已注册的定时任务")
    parser.add_argument("--remove", action="store_true", help="移除所有定时任务")
    args = parser.parse_args()

    if args.list:
        tasks = list_tasks()
        if tasks:
            print(f"📋 已注册 {len(tasks)} 个定时任务:")
            for t in tasks:
                print(f"  • {t['name']}  [{t['schedule']}]")
                print(f"    {t['command']}")
        else:
            print("📋 暂无已注册的定时任务")
        return

    if args.remove:
        removed = unregister_tasks()
        if removed:
            print(f"🗑️  已移除 {len(removed)} 个定时任务: {', '.join(removed)}")
        else:
            print("📋 暂无需要移除的定时任务")
        return

    # 默认: 注册任务
    registered = register_tasks()
    if registered:
        print(f"✅ 已注册 {len(registered)} 个定时任务: {', '.join(registered)}")
    else:
        print("📋 所有定时任务已存在，无需重复注册")

    # 显示当前状态
    tasks = list_tasks()
    print(f"\n📋 当前定时任务:")
    for t in tasks:
        print(f"  • {t['name']}  [{t['schedule']}]")


if __name__ == "__main__":
    main()
