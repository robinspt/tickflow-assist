---
name: stock-analysis
description: 股票技术分析 - 通过 TickFlow 获取日K数据，计算技术指标，调用 LLM 分析关键价位，实时监控并发送告警
---

# 股票技术分析 Skill

本 Skill 提供完整的 A 股技术分析功能，包括添加关注、获取K线、计算指标、LLM分析和实时监控。

## 可用指令

### 1. 添加关注股票

当用户请求添加或关注某只股票时（如："添加 600000.SH 成本 10.5"、"关注 000001.SZ 成本价 15.2"），执行以下命令：

```
exec python /home/x/githubxm/tickflow_plugin/scripts/add_stock.py --symbol {股票代码} --cost {成本价}
```

- 股票代码格式为 `代码.交易所`，如 `600000.SH`（上海）、`000001.SZ`（深圳）、`300059.SZ`（创业板）
- 成本价为用户的实际买入成本（浮点数）
- 添加后自动写入 LanceDB 数据库

### 2. 删除关注股票

当用户请求删除或取消关注某只股票时（如："删除 600000.SH"、"取消关注 000001.SZ"），执行：

```
exec python /home/x/githubxm/tickflow_plugin/scripts/remove_stock.py --symbol {股票代码}
```

- 默认同时清除该股票的 K线、指标、关键价位等全部数据
- 如果用户要求保留数据仅取消关注，加 `--keep-data` 参数

### 3. 获取日K线并计算指标

当用户请求更新或获取某只股票的K线数据时（如："更新 600000.SH 数据"、"获取 000001.SZ K线"），执行：

```
exec python /home/x/githubxm/tickflow_plugin/scripts/fetch_klines.py --symbol {股票代码}
```

可选参数 `--days N` 指定获取天数（默认90天）。

功能：
- 从 TickFlow API 获取日K线数据（前复权）
- 如果在交易时段内，自动剔除当日未完成的K线
- 计算 MA/MACD/KDJ/RSI/CCI/BIAS/DMI/BOLL 等全部技术指标
- 数据写入 LanceDB

### 4. 分析关键价位（核心功能）

当用户请求分析某只股票时（如："分析 600000.SH"、"看看 000001.SZ 怎么样"），按顺序执行：

**步骤一** - 先获取最新数据：
```
exec python /home/x/githubxm/tickflow_plugin/scripts/fetch_klines.py --symbol {股票代码}
```

**步骤二** - 调用 LLM 分析：
```
exec python /home/x/githubxm/tickflow_plugin/scripts/analyze.py --symbol {股票代码}
```

分析结果包括：
- 趋势判断和技术形态分析
- 关键价位表格（止损位/突破位/支撑位/成本位/压力位/止盈位/缺口位/目标位/整数关）
- 技术面评分（1-10分）

**将分析结果和关键价位表格完整发送给用户。**

### 5. 收盘后批量更新

每日收盘后（15:30）自动增量更新所有关注股票的 K 线和指标。已通过 Cron 自动运行，也可手动触发：

```
exec python /home/x/githubxm/tickflow_plugin/scripts/update_all.py
```

- 遍历关注列表中的所有股票
- 获取最新日K线数据并重新计算全部技术指标
- 非交易日自动跳过（加 `--force` 可强制运行）

### 6. 启动实时监控

当用户请求启动监控时（如："开始监控"、"启动实时行情"），执行：

```
exec python /home/x/githubxm/tickflow_plugin/scripts/realtime_monitor.py &
```

监控功能：
- 仅在交易日的交易时段内运行（9:30-11:30, 13:00-15:00）
- 每10秒获取一次实时行情（间隔可在 config.yaml 修改）
- 自动对比数据库中的关键价位，触发以下告警：
  - 触及/跌破止损位
  - 突破关键压力位
  - 触及支撑位/压力位
  - 涨跌幅超过 5%
  - 成交量异常放大（超过近5日均量3倍）
- 告警通过 OpenClaw 发送到配置的通道（默认 Telegram）
- 同一规则在同一交易日内不会重复告警

## 注意事项

- 所有脚本的工作目录为 `/home/x/githubxm/tickflow_plugin/`
- 配置文件位于 `/home/x/githubxm/tickflow_plugin/config.yaml`
- 首次使用前需要在 config.yaml 中配置 TickFlow API Key 和 LLM 配置
- 数据存储在 `/home/x/githubxm/tickflow_plugin/data/lancedb/`
