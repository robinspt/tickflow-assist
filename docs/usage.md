# TickFlow Assist 使用指南

本文档介绍插件的使用方式、支持的指令、调试方法以及数据表和运行规则。安装与配置请参阅 [安装指南](installation.md)。

## 1. 使用方式

### 对话常用指令

| 指令示例 | 功能 |
|---|---|
| `添加 002261 成本 34.154` | 添加股票到关注列表 |
| `查看关注列表` | 查看当前关注股票及成本价 |
| `删除 002202` | 从关注列表删除股票 |
| `更新 002261 数据` | 抓取最新日 K 并重算指标 |
| `获取 002261 1m 分钟K` | 抓取当日分钟 K 并写入数据库 |
| `分析 002261` | 执行 LLM 技术分析，并补充日内走势判断 |
| `查看 002261 上次分析` | 回看最近一次分析结论 |
| `开始监控` | 启动实时监控 |
| `监控状态` | 查看监控状态、行情、关键价位覆盖情况 |
| `启动定时日更` | 启动项目自管的定时日更进程 |
| `TickFlow日更状态` | 查看定时日更进程状态与最近一次执行情况 |
| `停止定时日更` | 停止项目自管的定时日更进程 |
| `停止监控` | 停止监控 |
| `测试告警` | 验证 OpenClaw channel 投递链路 |
| `使用帮助` | 查看插件常用指令与示例 |
| `数据库里有哪些表` | 查看 LanceDB 当前数据表 |
| `看技术指标表结构` | 查看技术指标表字段结构 |
| `查 002261 最近 5 条技术指标` | 查询数据库中的技术指标记录 |

### 免 AI 直达命令

如果你希望跳过模型决策，直接执行插件动作，可使用 TickFlow Assist 注册的 `ta_` 前缀 slash commands。

当前一共注册了 15 个直达命令：

- `/ta_addstock <symbol> <costPrice> [count]`
- `/ta_rmstock <symbol>`
- `/ta_analyze <symbol>`
- `/ta_viewanalysis <symbol>`
- `/ta_watchlist`
- `/ta_refreshnames`
- `/ta_startmonitor`
- `/ta_stopmonitor`
- `/ta_monitorstatus`
- `/ta_startdailyupdate`
- `/ta_stopdailyupdate`
- `/ta_updateall`
- `/ta_dailyupdatestatus`
- `/ta_testalert`
- `/ta_debug`

常用示例：

```text
/ta_addstock 601872 5.32
/ta_addstock 002261 34.15 120
/ta_rmstock 601872
/ta_analyze 002261
/ta_viewanalysis 002261
/ta_watchlist
/ta_refreshnames
/ta_startmonitor
/ta_stopmonitor
/ta_monitorstatus
/ta_startdailyupdate
/ta_stopdailyupdate
/ta_updateall
/ta_dailyupdatestatus
/ta_testalert
/ta_debug
```

这些命令由插件直接处理，优先于 AI agent，适合添加/删除自选、查看状态、测试告警这类零歧义操作。

注意：

- `/ta_addstock` 必须提供成本价，格式为 `/ta_addstock <symbol> <costPrice> [count]`
- 例如 `/ta_addstock 002558` 会失败，因为缺少 `costPrice`
- `/ta_debug` 会返回插件进程当前看到的数据库路径、配置来源和 watchlist 快照，适合排查“CLI 有数据但插件命令看不到”的问题

### 命令行直连调试

`npm run tool -- ...`、`npm run monitor-loop` 与 `npm run daily-update-loop` 读取的是项目根目录 `local.config.json`，不是 `~/.openclaw/openclaw.json`。

先准备本地调试配置：

```bash
cp local.config.example.json local.config.json
```

再填写其中的 `plugin` 配置，然后执行：

```json
{
  "plugin": {
    "tickflowApiUrl": "https://api.tickflow.org",
    "tickflowApiKey": "your-tickflow-key"
  }
}
```

这里要特别注意：

- CLI 工具读取的是 `local.config.json.plugin`
- 不是 `local.config.json` 顶层其它字段
- 也不会自动 fallback 到 `~/.openclaw/openclaw.json`

然后执行：

```bash
npm run tool -- test_alert
npm run tool -- add_stock '{"symbol":"002261","costPrice":34.154}'
npm run tool -- fetch_klines '{"symbol":"002261","count":90}'
npm run tool -- fetch_intraday_klines '{"symbol":"002261","period":"1m","count":240}'
npm run tool -- analyze '{"symbol":"002261"}'
npm run tool -- update_all
npm run tool -- start_daily_update
npm run tool -- daily_update_status
npm run tool -- stop_daily_update
npm run tool -- start_monitor
npm run tool -- monitor_status
npm run tool -- stop_monitor
npm run daily-update-loop
```

补充说明：

- `local.config.json` 只影响本地调试 / CLI 链路，不会反向修改 `~/.openclaw/openclaw.json`
- 如果你希望 OpenClaw 对话结果、`npm run tool -- ...`、后台 loop 状态完全一致，建议把两套配置保持同步
- `update_all` 在收盘后执行时，会同时更新日K、日线指标和当日 `1m` 分钟K
- `start_daily_update` 启动的是项目自管 detached 进程，如果运行环境未托管插件服务，则不再依赖 OpenClaw 的 `tickflow-assist.managed-loop` 后台服务
- `npm run daily-update-loop` 可用于手工前台运行日更轮询，便于配合 `tmux`、`systemd --user` 或其它进程管理器排查
- `analyze` 会读取本地日K和日线指标，并临时拉取当日全部分钟K、计算分钟指标、获取实时行情，再一起交给模型分析
- 本地 `klines_intraday` 默认仅保留近 10 个交易日，超过部分会自动清理
- `daily_update_status` 现在会显示 `定时进程`、`运行方式`、`进程配置来源`、`配置来源`、`最近心跳` 与最近执行结果，便于排查“后台进程没跑”还是“只是当天尚未触发更新”

## 2. 数据与运行说明

### 数据表

| 表名 | 说明 |
|---|---|
| `watchlist` | 关注列表、股票名称、成本价、添加时间 |
| `klines_daily` | 日 K 数据 |
| `klines_intraday` | 分钟 K 数据，包含 `period` 与 `trade_time`，默认仅保留近 10 个交易日 |
| `indicators` | 技术指标结果 |
| `key_levels` | 关键价位与评分 |
| `analysis_log` | 每次分析的文本和结构化结果 |
| `alert_log` | 告警去重与留痕 |

### 实时监控规则

| 规则 | 说明 | 触发条件 |
|---|---|---|
| 止损告警 | 跌破止损位 | `价格 <= 止损位` |
| 止损预警 | 接近止损位 | `价格 <= 止损位 × 1.005` |
| 突破告警 | 突破关键位 | `价格 >= 突破位` |
| 支撑告警 | 接近支撑位 | `价格 <= 支撑位 × 1.005` |
| 压力告警 | 接近压力位 | `价格 >= 压力位 × 0.995` |
| 止盈告警 | 达到止盈位 | `价格 >= 止盈位` |
| 涨跌幅异动 | 单日涨跌幅超阈值 | `绝对涨跌幅 >= 5%` |
| 成交量异动 | 成交量异常放大 | `当前量 >= 5日均量 × 3` |

运行约束：

- 非交易日不监控
- 交易时段：`09:30-11:30`、`13:00-15:00`
- 阶段通知：`09:30` 左右发送“开始上午盯盘”，`11:30` 左右发送“上午盯盘结束”，`13:00` 左右发送“开始下午盯盘”，`15:00` 左右发送“今日盯盘结束”
- 收盘后 `update_all` 才允许执行日更
- `monitor_status` 会显示当前运行方式与最近心跳；如果心跳超时，会直接提示后台监控疑似未实际轮询
- 如果后台轮询抛过异常，`monitor_status` 会显示最近一次异常时间和错误摘要
- `daily_update_status` 会显示当前日更运行方式：`project_scheduler`
