# TickFlow Assist 使用指南

本文档聚焦于日常使用、调试入口与关键运行规则。安装与配置请参阅 [安装指南](installation.md)。项目概览请先看 [README](../README.md)。

## 1. 使用入口

| 入口 | 适合场景 | 说明 |
|---|---|---|
| OpenClaw 对话 | 日常使用 | 直接用自然语言操作自选、分析、监控和数据库查询 |
| `/ta_` Slash Command | 零歧义操作 | 插件直接处理，不经过 AI 推理 |
| `npm run tool -- ...` / loop | 本地调试、VPS 直连 | 读取 `local.config.json.plugin`，适合排障和脚本化调用 |

## 2. 对话常用指令

下面的说法是推荐示例，不要求逐字一致；表达清楚股票代码和动作即可。

### 自选管理

| 指令示例 | 功能 |
|---|---|
| `添加 002261` | 添加股票到关注列表，成本价可后续补充 |
| `添加 002261 成本 34.15` | 添加股票并记录成本价 |
| `查看关注列表` | 查看当前自选、名称与成本价 |
| `删除 002261` | 从关注列表移除股票 |
| `刷新自选股名称` | 批量刷新关注股票名称 |
| `查看东方财富自选` | 读取东方财富通行证账户下的自选股 |
| `同步东方财富自选到本地` | 将东方财富自选导入 TickFlow Assist 本地关注列表 |
| `把本地自选全部推送到东方财富` | 将本地关注列表添加到东方财富自选 |
| `从东方财富自选删除 002261` | 只删除东方财富自选，不删除本地关注 |

### 数据获取与检索

| 指令示例 | 功能 |
|---|---|
| `更新 002261 数据` | 抓取最新日 K 并重算日线指标 |
| `获取 002261 1m 分钟K` | 抓取分钟 K 并写入数据库 |
| `搜索立讯精密最新研报` | 搜索资讯、公告、研报或事件解读 |
| `找今日涨幅 2% 的股票` | 用自然语言条件执行智能选股 |

### 分析与复盘

| 指令示例 | 功能 |
|---|---|
| `分析 002261` | 执行综合分析，汇总技术面、财务面和资讯面 |
| `查看 002261 上次分析` | 回看最近一次综合分析 |
| `查看 002261 最近 3 次综合分析` | 回看最近几次综合分析 |
| `查看 002261 技术面分析` | 回看最近一次技术面结果 |
| `查看 002261 基本面分析` | 回看最近一次财务面结果 |
| `查看 002261 资讯面分析` | 回看最近一次资讯面结果 |
| `回测 002261 最近 5 次关键位快照` | 回测关键价位快照的命中情况 |

如需查看更多历史，也可以直接说“查看 002261 最近 3 次技术面分析”“查看 002261 最近 3 次资讯面分析”。

### 后台维护与排障

| 指令示例 | 功能 |
|---|---|
| `开始监控` | 启动实时监控 |
| `监控状态` | 查看监控状态、最新行情与关键价位覆盖情况 |
| `启动定时日更` | 启动项目自管的定时日更进程 |
| `TickFlow日更状态` | 查看日更进程状态与最近执行结果 |
| `停止定时日更` | 停止日更进程 |
| `停止监控` | 停止实时监控 |
| `测试告警` | 验证 OpenClaw channel 的文本与 PNG 告警卡投递链路 |
| `使用帮助` | 查看插件常用指令 |
| `数据库里有哪些表` | 查看 LanceDB 当前数据表 |
| `看技术指标表结构` | 查看数据库表字段结构 |
| `查 002261 最近 5 条技术指标` | 查询数据库中的最近记录 |

## 3. Slash Commands

插件当前注册了 18 个 `/ta_` 直达命令，适合“添加自选”“查状态”“发测试告警”这类不需要模型解释的操作。

### 自选管理

| 命令 | 说明 |
|---|---|
| `/ta_addstock <symbol> [costPrice] [count]` | 添加自选，并抓取默认 90 天日 K |
| `/ta_rmstock <symbol>` | 删除自选 |
| `/ta_watchlist` | 查看自选列表 |
| `/ta_refreshnames` | 刷新股票名称 |
| `/ta_refreshprofiles [symbol]` | 刷新行业分类与概念板块 |

### 分析与复盘

| 命令 | 说明 |
|---|---|
| `/ta_analyze <symbol>` | 直接执行综合分析 |
| `/ta_viewanalysis <symbol>` | 查看最近一次综合分析 |
| `/ta_backtest [symbol] [recentLimit]` | 回测活动关键价位快照，可按股票与最近次数过滤 |

### 后台维护与调试

| 命令 | 说明 |
|---|---|
| `/ta_startmonitor` | 启动实时监控 |
| `/ta_stopmonitor` | 停止实时监控 |
| `/ta_monitorstatus` | 查看价格实时监控状态 |
| `/ta_flashstatus` | 查看金十数据快讯监控状态 |
| `/ta_startdailyupdate` | 启动定时日更 |
| `/ta_stopdailyupdate` | 停止定时日更 |
| `/ta_updateall` | 立即执行一次完整日更 |
| `/ta_dailyupdatestatus` | 查看定时日更状态 |
| `/ta_testalert` | 发送一条文本 + PNG 测试告警 |
| `/ta_debug` | 查看插件进程当前看到的配置来源、数据库路径与 watchlist 快照 |

常用示例：

```text
/ta_addstock 601872
/ta_addstock 002261 34.15
/ta_watchlist
/ta_analyze 002261
/ta_viewanalysis 002261
/ta_backtest 002261 5
/ta_startmonitor
/ta_monitorstatus
/ta_flashstatus
/ta_dailyupdatestatus
/ta_testalert
```

使用提示：

- `/ta_addstock` 的第二个参数是 `costPrice`，第三个参数才是日 K 数量；如果只写两个参数，第二个数字会被当作成本价。
- `/ta_viewanalysis` 只看最近一次综合分析；如果你要看技术面、资讯面或最近 N 次历史，优先用自然语言或 CLI 的 `view_analysis`。
- `/ta_backtest` 不带参数时会输出整体回测概览，带 `symbol` 和 `recentLimit` 时会更聚焦。
- `/ta_debug` 适合排查“OpenClaw 对话能看到的状态”和“CLI 看到的状态”不一致的问题。

## 4. CLI 与本地直连调试

`npm run tool -- ...`、`npm run monitor-loop` 与 `npm run daily-update-loop` 读取的是项目根目录 `local.config.json` 的 `plugin` 字段，不会回退到 `~/.openclaw/openclaw.json`。其中，`npm run monitor-loop` 在本地调试模式下会同时驱动价格监控与金十数据快讯监控。

推荐配置结构：

```json
{
  "plugin": {
    "tickflowApiUrl": "https://api.tickflow.org",
    "tickflowApiKey": "sk-xxx",
    "mxSearchApiUrl": "https://mkapi2.dfcfs.com/finskillshub/api/claw",
    "mxSearchApiKey": "mkt_xxx",
    "jin10McpUrl": "https://mcp.jin10.com/mcp",
    "jin10ApiToken": "jin10_xxx",
    "jin10FlashPollInterval": 300,
    "jin10FlashRetentionDays": 7,
    "llmBaseUrl": "https://api.openai.com/v1",
    "llmApiKey": "sk-xxx",
    "llmModel": "gpt-4o",
    "databasePath": "./data/lancedb",
    "calendarFile": "./day_future.txt",
    "requestInterval": 30,
    "alertChannel": "telegram",
    "openclawCliBin": "openclaw",
    "alertAccount": "",
    "alertTarget": "YOUR_TARGET",
    "pythonBin": "uv",
    "pythonArgs": ["run", "python"],
    "pythonWorkdir": "./python"
  }
}
```

### 常用命令

基础验证：

```bash
npm run tool -- test_alert
npm run tool -- add_stock '{"symbol":"002261","costPrice":34.154}'
npm run tool -- fetch_klines '{"symbol":"002261","count":90}'
npm run tool -- fetch_intraday_klines '{"symbol":"002261","period":"1m","count":240}'
npm run tool -- analyze '{"symbol":"002261"}'
```

分析回看与检索：

```bash
npm run tool -- view_analysis '{"symbol":"002261"}'
npm run tool -- view_analysis '{"symbol":"002261","limit":3}'
npm run tool -- view_analysis '{"symbol":"002261","profile":"technical","limit":3}'
npm run tool -- backtest_key_levels '{"symbol":"002261","recentLimit":5}'
npm run tool -- mx_search '{"query":"立讯精密最新研报","limit":5}'
npm run tool -- mx_select_stock '{"keyword":"今日涨幅2%的股票","pageNo":1,"pageSize":20}'
npm run tool -- list_eastmoney_watchlist
npm run tool -- sync_eastmoney_watchlist
npm run tool -- push_eastmoney_watchlist '{"symbol":"002261"}'
npm run tool -- remove_eastmoney_watchlist '{"symbol":"002261"}'
```

后台与循环：

```bash
npm run tool -- start_monitor
npm run tool -- monitor_status
npm run tool -- flash_monitor_status
npm run tool -- stop_monitor
npm run tool -- start_daily_update
npm run tool -- daily_update_status
npm run tool -- stop_daily_update
npm run tool -- update_all
npm run monitor-loop
npm run daily-update-loop
```

## 5. 运行规则与关键机制

### 监控告警阈值

| 告警类型 | 触发条件 | 说明 |
|---|---|---|
| 止损告警 | `价格 <= 止损位` | 触及止损位 |
| 止损预警 | `价格 <= 止损位 × 1.005` | 接近止损位 |
| 突破告警 | `价格 >= 突破位` | 突破关键压力位 |
| 支撑告警 | `价格 <= 支撑位 × 1.005` | 接近支撑位 |
| 压力告警 | `价格 >= 压力位 × 0.995` | 接近压力位 |
| 止盈告警 | `价格 >= 止盈位` | 达到止盈位 |
| 涨跌幅异动 | `绝对涨跌幅 >= 5%` | 基于昨收计算 |
| 成交量异动 | `当前量 >= 5 日均量 × 3` | 放量异动 |

### 数据来源与降级逻辑

| 场景 | 当前行为 |
|---|---|
| `analyze` | 读取本地日 K、日线指标，并临时补充分钟 K、分钟指标、实时行情和历史复盘摘要 |
| 财务面（Expert） | 优先使用 TickFlow 完整财务快照 |
| 财务面（非 Expert / TickFlow 完整财务失败） | 回退到 `mx_select_stock` 的 lite 指标链路 |
| 财务面仍不可用 | 财务子任务返回降级结果，但综合分析继续执行 |
| 资讯面不可用 | 资讯子任务返回降级结果，但综合分析继续执行 |
| 分钟 K 保留策略 | `analyze` / `update_all` 会保留近 30 个交易日；单独执行 `fetch_intraday_klines` 会保留近 10 个交易日 |

### 后台运行规则

| 项目 | 说明 |
|---|---|
| 实时监控时段 | `09:30-11:30`、`13:00-15:00` |
| 阶段通知 | 上午开盘、上午收盘、下午开盘、当日收盘各发送一次 |
| `update_all` | 面向收盘后手动补跑流程，会先执行日更，再立即执行一次复盘 |
| 定时日更轮询 | 按 15 分钟对齐轮询，交易日 `15:25` 后最多执行一次 |
| 定时收盘复盘轮询 | 按 15 分钟对齐轮询，交易日 `20:00` 后最多执行一次 |
| `monitor_status` | 显示运行方式、最近心跳、最新行情与关键位覆盖情况 |
| `daily_update_status` | 显示运行方式、配置来源、最近心跳，以及日更/复盘两类最近执行结果 |

## 6. 主要数据表

| 表名 | 用途 |
|---|---|
| `watchlist` | 自选列表、成本价、行业分类、概念板块 |
| `klines_daily` | 日 K 数据 |
| `klines_intraday` | 分钟 K 数据 |
| `indicators` | 技术指标 |
| `key_levels` / `key_levels_history` | 当前关键价位与历史快照 |
| `technical_analysis` / `financial_analysis` / `news_analysis` / `composite_analysis` | 多维分析结果 |
| `analysis_log` / `alert_log` | 分析日志与告警留痕 |
| `jin10_flash` / `jin10_flash_delivery` | 金十数据原始快讯与快讯告警留痕 |

## 7. 高优先级注意事项

- 正式插件读取 `~/.openclaw/openclaw.json`；CLI 与本地 loop 读取 `local.config.json.plugin`，两者不会自动同步。
- 未配置 `mxSearchApiKey` 时，`mx_search` / `mx_select_stock` / 东方财富自选同步不可用，非 Expert 财务链路的 lite 回退也会失效。
- 东方财富自选管理接口每日额度 200 次：查看/从东方财富同步各消耗 1 次，推送本地自选按股票数量逐只消耗，删除每只消耗 1 次。
