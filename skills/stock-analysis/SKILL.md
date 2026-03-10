---
name: stock-analysis
description: 股票技术分析 - 通过 TickFlow 获取日K数据，计算技术指标，调用 LLM 分析关键价位，实时监控并发送告警
user-invocable: true
---

# 股票技术分析 Skill

本 Skill 提供完整的 A 股技术分析功能，包括添加关注、获取K线、计算指标、LLM分析和实时监控。

## 可用指令

### 1. 添加关注股票

当用户请求添加或关注某只股票时（如："添加 600000.SH 成本 10.5"、"关注 000001.SZ 成本价 15.2"），执行以下命令：

```
exec uv run python $TICKFLOW_ASSIST_ROOT/scripts/add_stock.py --symbol {股票代码} --cost {成本价}
```

- 股票代码格式为 `代码.交易所`，如 `600000.SH`（上海）、`000001.SZ`（深圳）、`300059.SZ`（创业板）
- 成本价为用户的实际买入成本（浮点数）
- 添加后自动写入 LanceDB 数据库

### 2. 删除关注股票

当用户请求删除或取消关注某只股票时（如："删除 600000.SH"、"取消关注 000001.SZ"），执行：

```
exec uv run python $TICKFLOW_ASSIST_ROOT/scripts/remove_stock.py --symbol {股票代码}
```

- 默认同时清除该股票的 K线、指标、关键价位等全部数据
- 如果用户要求保留数据仅取消关注，加 `--keep-data` 参数

### 3. 获取日K线并计算指标

当用户请求更新或获取某只股票的K线数据时（如："更新 600000.SH 数据"、"获取 000001.SZ K线"），执行：

```
exec uv run python $TICKFLOW_ASSIST_ROOT/scripts/fetch_klines.py --symbol {股票代码}
```

可选参数 `--days N` 指定获取天数（默认90天）。

功能：
- 从 TickFlow API 获取日K线数据（前复权）
- 如果在交易时段内，自动剔除当日未完成的K线
- 计算 MA/MACD/KDJ/RSI/CCI/BIAS/DMI/BOLL 等全部技术指标
- 数据写入 LanceDB

### 4. 查看当前关注列表

当用户请求查看已关注股票时（如："查看关注列表"、"当前关注了哪些股票"），执行：

```
exec uv run python $TICKFLOW_ASSIST_ROOT/scripts/list_watchlist.py
```

返回内容应包含：
- 当前关注股票数量
- 每只股票的代码
- 对应成本价

### 5. 分析关键价位（核心功能）

当用户请求分析某只股票时（如："分析 600000.SH"、"看看 000001.SZ 怎么样"），按顺序执行：

**步骤一** - 先获取最新数据：
```
exec uv run python $TICKFLOW_ASSIST_ROOT/scripts/fetch_klines.py --symbol {股票代码}
```

**步骤二** - 调用 LLM 分析：
```
exec uv run python $TICKFLOW_ASSIST_ROOT/scripts/analyze.py --symbol {股票代码}
```

分析结果包括：
- 趋势判断和技术形态分析
- 关键价位表格（止损位/突破位/支撑位/成本位/压力位/止盈位/缺口位/目标位/整数关）
- 技术面评分（1-10分）

**将分析结果和关键价位表格完整发送给用户。**

### 6. 查看最近一次分析结果

当用户请求回看或查看最近一次分析时（如："查看 600000.SH 上次分析"、"回看 600000.SH 分析"、"最近一次分析 600000.SH"），执行：

```
exec uv run python $TICKFLOW_ASSIST_ROOT/scripts/view_analysis.py --symbol {股票代码}
```

- 返回最近一次保存的分析文本
- 如果最近一次结构化解析成功，同时展示关键价位汇总
- 如果该股票尚无分析记录，明确提示用户先执行分析

### 7. 收盘后批量更新

每日收盘后（15:30）自动增量更新所有关注股票的 K 线和指标。已通过 Cron 自动运行，也可手动触发：

```
exec uv run python $TICKFLOW_ASSIST_ROOT/scripts/update_all.py
```

- 遍历关注列表中的所有股票
- 获取最新日K线数据并重新计算全部技术指标
- 非交易日自动跳过（加 `--force` 可强制运行）

### 8. 启动实时监控

当用户请求启动监控时（如："开始监控"、"启动实时行情"），执行：

```
exec uv run python $TICKFLOW_ASSIST_ROOT/scripts/start_monitor.py
```

监控功能：
- 仅在交易日的交易时段内运行（9:30-11:30, 13:00-15:00）
- 按 `config.yaml` 中 `tickflow.request_interval` 配置的秒数获取一次实时行情
- 自动对比数据库中的关键价位，触发以下告警：
  - 触及/跌破止损位
  - 突破关键压力位
  - 触及支撑位/压力位
  - 涨跌幅超过 5%
  - 成交量异常放大（超过近5日均量3倍）
- 告警通过 OpenClaw 发送到配置的通道（默认 Telegram）
- 同一规则在同一交易日内不会重复告警

### 9. 查看监控状态

当用户请求查看监控运行状态时（如："监控状态"、"当前监控怎么样"、"看看监控"、"运行状态"），执行：

```
exec uv run python $TICKFLOW_ASSIST_ROOT/scripts/monitor_status.py
```

返回内容包括：
- 📊 监控进程是否在运行（PID、运行时长）
- 📅 当前交易时段状态（交易日、盘前/交易中/午休/收盘）
- 📋 关注列表和股票数量
- 🎯 关键价位覆盖情况（哪些股票已分析/缺失）
- 🔔 今日已发送的告警记录
- ⚙️ 监控配置摘要（轮询间隔、告警通道、规则阈值）

将查询结果完整发送给用户，方便用户了解实时监控是否正常工作。

### 10. 停止实时监控

当用户请求停止监控时（如："停止监控"、"关闭监控"、"停止实时行情"），执行：

```
exec uv run python $TICKFLOW_ASSIST_ROOT/scripts/stop_monitor.py
```

- 默认发送 SIGTERM 信号，等待进程优雅退出
- 如果用户要求强制停止，加 `--force` 参数（使用 SIGKILL 强制终止）
- 停止后自动清理 PID 锁文件

## 注意事项

- 部署时先设置环境变量 `TICKFLOW_ASSIST_ROOT`，其值为项目根目录，例如 `/home/ocuser/projects/tickflow-assist`
- 部署环境需安装 [uv](https://docs.astral.sh/uv/)，首次部署后在项目目录执行 `uv sync` 安装依赖
- 所有脚本通过 `exec uv run python $TICKFLOW_ASSIST_ROOT/scripts/` 调用，确保使用 uv 管理的虚拟环境
- 配置文件位于 `$TICKFLOW_ASSIST_ROOT/config.yaml`
- 首次使用前需要在 config.yaml 中配置 TickFlow API Key 和 LLM 配置
- 数据存储在 `$TICKFLOW_ASSIST_ROOT/data/lancedb/`
