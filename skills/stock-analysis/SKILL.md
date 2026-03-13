---
name: stock_analysis
description: Analyze A-share watchlist symbols, update daily K-line data, run monitor, and report status through the TickFlow Assist plugin.
metadata:
  openclaw:
    skillKey: stock_analysis
    requires:
      config: true
---
# 股票分析与监控

这是 TickFlow Assist 插件内置的技能，用于通过插件工具完成 A 股自选股管理、日线更新、分钟K抓取、技术分析、实时监控、结果查看与告警测试。

此技能随插件加载，不需要手动复制到 workspace。

优先使用 TickFlow Assist 插件工具，不要改用 shell 命令，也不要在没有工具结果的前提下自行推断分析结论、监控状态或数据更新结果。

适用场景：
- 添加或删除自选股
- 查看自选列表
- 刷新自选股名称
- 拉取单只股票的 K 线数据
- 拉取单只股票的分钟 K 线数据
- 执行全部日更
- 分析单只股票
- 查看最近一次已保存的分析结果
- 开启或停止实时监控
- 查询监控状态
- 测试告警发送

中文意图与工具映射：
- “添加自选”、“加入观察”、“加股票” -> `add_stock`
- “删除自选”、“移除股票”、“删掉这只股票” -> `remove_stock`
- “查看自选”、“自选列表” -> `list_watchlist`
- “刷新股票名称”、“刷新名称” -> `refresh_watchlist_names`
- “拉 K 线”、“更新 K 线”、“获取日线” -> `fetch_klines`
- “获取分钟K”、“拉取分钟线”、“抓分时K” -> `fetch_intraday_klines`
- “全部更新”、“执行日更”、“更新全部股票” -> `update_all`
- “TickFlow日更状态”、“自选股日更状态”、“TickFlow定时更新状态”、“TickFlow定时日更状态” -> `daily_update_status`
- “分析一下某只股票”、“分析 002261” -> `analyze`
- “查看分析结果”、“看上次分析” -> `view_analysis`
- “开始盯盘”、“开启监控”、“启动监控” -> `start_monitor`
- “停止盯盘”、“关闭监控”、“停止监控” -> `stop_monitor`
- “监控状态”、“现在监控在跑吗” -> `monitor_status`
- “测试告警” -> `test_alert`

参数理解规则：
- 股票代码按用户原始输入提取，例如 `002261`。
- 成本价对应 `costPrice`。
- `add_stock` 默认会在添加成功后自动拉取日K并计算指标。
- `analyze` 除了读取本地日K和日线指标，还会临时获取当日分钟K、分钟指标与实时行情一起分析。
- `update_all` 除了更新日K和日线指标，也会同步更新当日分钟K；本地分钟K默认仅保留近 10 个交易日。
- 若配置中的 `tickflowApiKeyLevel` 为 `Free` 或 `Start`，则应自动跳过分钟K获取；若分钟K接口失败，也不要让 `analyze` 或 `update_all` 因此整体失败。
- 用户在“添加自选”意图中提到的“`N`天”对应 `add_stock.count`（或 `klineCount`），例如“添加 002261 成本 34.15 并获取 120 天日K”应调用 `add_stock`，其中 `count=120`。
- 用户询问 TickFlow / 自选股 的日更状态时，必须调用 `daily_update_status`，不要把它解释成其他 crontab、系统任务或无关插件的定时更新。
- 对“TickFlow日更状态”、“TickFlow定时日更状态”这类查询，禁止改用 `exec`、`npm run tool -- daily_update_status`、shell 命令或任何二次包装方式，必须直接使用插件工具 `daily_update_status`。
- 在 OpenClaw 对话中，如果 `daily_update_status` 返回内容里出现 `配置来源: local_config`，说明拿到的是本地调试链路结果，不是插件后台状态；此时不要直接回复给用户，应视为错误调用路径并重试插件工具，目标是拿到 `配置来源: openclaw_plugin` 的原始结果。只有在插件工具确实不可用时，才允许说明插件状态暂时不可直接读取。
- 仅在工具必需参数缺失时，才简短指出缺少的字段。
- 不要臆造股票代码、成本价、日期、阈值、分析结果或监控状态。

输出规则：
- 对 `add_stock`、`list_watchlist`、`start_monitor`、`stop_monitor`、`monitor_status`、`daily_update_status`、`analyze`、`view_analysis`、`fetch_klines`、`fetch_intraday_klines` 和 `update_all`，调用工具后尽量原样输出返回文本。
- 对 `daily_update_status` 必须完整原样输出，尤其不要省略 `配置来源`、`交易日历`、`轮询间隔`、`最近心跳`、`最近尝试`、`最近成功`、`最近结果`、`连续失败`、`状态文件` 与 `最近摘要`。
- 不要改写、总结、翻译、重排、美化，也不要加表格、额外标题或解释性包装。
- 除非工具明确返回错误，否则不要在工具结果前后添加追问、评论或推断字段。
- 不要省略关键数值、价位、涨跌幅、日期或状态字段。

错误处理：
- 工具成功时，直接返回结果。
- 工具明确报错时，可以补一句简短中文说明，但应保留错误原文或原始关键信息。
- 工具报错时不要编造原因，不要给出没有依据的补救建议。

监控规则：
- `start_monitor` 与 `stop_monitor` 控制的是插件内置后台监控服务，不是临时 shell 进程。
- 查询监控是否运行时优先调用 `monitor_status`，不要根据上下文猜测。
