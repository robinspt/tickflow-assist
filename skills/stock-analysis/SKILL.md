---
name: stock_analysis
description: Analyze A-share watchlist symbols, update daily K-line data, run monitor, and report status through the TickFlow Assist plugin.
metadata: {"openclaw":{"skillKey":"stock_analysis","always":true,"primaryEnv":"TICKFLOW_ASSIST_TICKFLOW_API_KEY","requires":{"config":["plugins.entries.tickflow-assist.enabled"],"env":["TICKFLOW_ASSIST_TICKFLOW_API_KEY","TICKFLOW_ASSIST_LLM_API_KEY","TICKFLOW_ASSIST_LLM_BASE_URL","TICKFLOW_ASSIST_LLM_MODEL"]}}}
---
# 股票分析与监控

这是 TickFlow Assist 插件内置的技能，用于通过插件工具完成 A 股自选股管理、东方财富自选同步、日线更新、分钟K抓取、技术分析、关键价位回测、实时监控、定时日更、结果查看与告警测试。
运行前需要提供 TickFlow / LLM 等凭证；这些值既可以来自 `plugins.entries["tickflow-assist"].config`，也可以来自文档约定的环境变量 fallback，不要求必须明文写在插件配置里。

此技能随插件加载，不需要手动复制到 workspace。

优先通过 TickFlow Assist 插件工具完成相关任务，并以工具返回结果为准。

适用场景：
- 添加或删除自选股
- 查看自选列表
- 查看东方财富自选股列表
- 从东方财富同步自选股到本地关注列表
- 将本地关注列表推送到东方财富自选
- 从东方财富自选中删除股票
- 刷新自选股名称
- 拉取单只股票的 K 线数据
- 拉取单只股票的分钟 K 线数据
- 搜索个股 / 板块 / 宏观相关资讯、公告、研报、政策、事件解读
- 按自然语言条件做智能选股
- 执行全部日更
- 分析单只股票
- 回测活动价位 / 回测股票
- 查看最近一次已保存的分析结果
- 开启或停止实时监控
- 查询监控状态
- 测试告警发送

中文意图与工具映射：
- “添加自选”、“加入观察”、“加股票” -> `add_stock`
- “删除自选”、“移除股票”、“删掉这只股票” -> `remove_stock`
- “查看自选”、“自选列表” -> `list_watchlist`
- “查看东方财富自选”、“妙想自选列表”、“东财自选列表” -> `list_eastmoney_watchlist`
- “从东方财富同步自选”、“导入东财自选”、“同步妙想自选到本地” -> `sync_eastmoney_watchlist`
- “把本地自选添加到东方财富”、“推送本地自选到东财”、“同步本插件自选到东方财富” -> `push_eastmoney_watchlist`
- “删除东方财富自选”、“从东财自选删除”、“移除妙想自选” -> `remove_eastmoney_watchlist`
- “刷新股票名称”、“刷新名称” -> `refresh_watchlist_names`
- “拉 K 线”、“更新 K 线”、“获取日线” -> `fetch_klines`
- “获取分钟K”、“拉取分钟线”、“抓分时K” -> `fetch_intraday_klines`
- “搜资讯”、“查公告”、“看研报”、“政策解读”、“事件解读” -> `mx_search`
- “选股”、“筛股票”、“找满足条件的股票”、“推荐板块成分股” -> `mx_select_stock`
- “全部更新”、“执行日更”、“更新全部股票” -> `update_all`
- “启动定时日更”、“开始定时日更”、“开启 TickFlow 日更计划” -> `start_daily_update`
- “停止定时日更”、“关闭 TickFlow 日更计划” -> `stop_daily_update`
- “TickFlow日更状态”、“自选股日更状态”、“TickFlow定时更新状态”、“TickFlow定时日更状态” -> `daily_update_status`
- “分析一下某只股票”、“分析 002261” -> `analyze`
- “回测股票”、“开始回测”、“回测关键价位”、“回测 002261”、“看回测结果” -> `backtest_key_levels`
- “查看分析结果”、“看上次分析” -> `view_analysis`
- “看技术面分析”、“看基本面分析”、“看资讯面分析” -> `view_analysis`
- “看最近3次分析”、“回看历史分析”、“看最近几次技术面/基本面/资讯面分析” -> `view_analysis`
- “开始盯盘”、“开启监控”、“启动监控” -> `start_monitor`
- “停止盯盘”、“关闭监控”、“停止监控” -> `stop_monitor`
- “监控状态”、“现在监控在跑吗” -> `monitor_status`
- “测试告警” -> `test_alert`

参数理解规则：
- 对“添加自选 / 删除自选 / 查看自选 / 监控状态 / 日更状态”这类直接型意图，如果用户已经给出足够参数，应直接调用对应插件工具。
- 普通“添加自选 / 删除自选 / 查看自选”默认指 TickFlow Assist 本地关注列表；只有用户明确提到“东方财富 / 东财 / 妙想 / MX”时，才调用 `list_eastmoney_watchlist`、`sync_eastmoney_watchlist`、`push_eastmoney_watchlist` 或 `remove_eastmoney_watchlist`。
- 当用户消息中已经包含足够参数时，不要额外补充假设：
  - “添加自选 601872” -> 直接调用 `add_stock`
  - “添加自选 601872 成本 5.32” -> 直接调用 `add_stock`
  - “删除自选 601872” -> 直接调用 `remove_stock`
  - “自选列表” -> 直接调用 `list_watchlist`
  - “查看东方财富自选” -> 直接调用 `list_eastmoney_watchlist`
  - “同步东方财富自选到本地” -> 直接调用 `sync_eastmoney_watchlist`
  - “把本地自选全部推送到东方财富” -> 直接调用 `push_eastmoney_watchlist`
  - “从东方财富自选删除 601872” -> 直接调用 `remove_eastmoney_watchlist`
  - “查立讯精密最新研报” -> 直接调用 `mx_search`
  - “找今天涨幅 2% 的股票” -> 直接调用 `mx_select_stock`
- 如果工具必需参数缺失，只补充缺失项本身。
- 股票代码按用户原始输入提取，例如 `002261`。
- 成本价对应 `costPrice`；若用户未提供成本价，可以省略该字段。
- `add_stock` 默认会在添加成功后自动拉取日K并计算指标。
- `list_eastmoney_watchlist`、`sync_eastmoney_watchlist`、`push_eastmoney_watchlist`、`remove_eastmoney_watchlist` 使用东方财富妙想自选管理接口，复用 `mxSearchApiKey` / `MX_APIKEY`，每日额度为 200 次。
- `list_eastmoney_watchlist` 和 `sync_eastmoney_watchlist` 各消耗 1 次妙想自选额度；`remove_eastmoney_watchlist` 每只股票消耗 1 次；`push_eastmoney_watchlist` 每推送 1 只本地关注股消耗 1 次。
- `sync_eastmoney_watchlist` 默认只把东方财富自选导入本地关注列表，不拉取日K，也不刷新行业/概念；如需要行业/概念，后续调用 `refresh_watchlist_profiles`。
- `push_eastmoney_watchlist` 只把本地已有关注股添加到东方财富自选；如果用户指定股票但本地关注列表里没有，应先用 `add_stock` 加入本地，再推送。
- `remove_eastmoney_watchlist` 只删除东方财富自选，不删除 TickFlow Assist 本地关注；如果用户同时要求本地也删除，应再调用 `remove_stock`。
- `analyze` 会读取本地日K和日线指标，临时补充当日分钟K、分钟指标、实时行情、最新财务数据与资讯检索结果，再走固定流水线综合分析；其中基本面部分在 `Expert` 级别下优先使用 TickFlow 完整财报，在非 `Expert` 级别下回退为 `mx_select_stock` 的 lite 指标拖底模式。
- `view_analysis` 默认查看最近一次综合分析；如用户明确提到“技术面 / 基本面 / 资讯面 / 全部分析”，应传入 `profile=technical|financial|news|all`；如用户提到“最近 N 次”或“历史”，应同时传入 `limit=N`（或 `count=N`）。
- `update_all` 除了更新日K和日线指标，也会同步更新当日分钟K；本地分钟K默认仅保留近 30 个交易日。
- `update_all` 是立即执行一次日更；`start_daily_update` / `stop_daily_update` 控制的是后台定时日更进程，两者不要混淆。
- `backtest_key_levels` 默认回测全部关注股的活动价位；如果用户提到股票代码，应传入 `symbol`；如果用户提到“最近 N 次”，应传入 `recentLimit=N`。
- 若配置中的 `tickflowApiKeyLevel` 为 `Free` 或 `Starter`，则应自动跳过分钟K获取；若分钟K接口失败，也不要让 `analyze` 或 `update_all` 因此整体失败。
- 对新闻、公告、研报、政策、交易规则、具体事件、时效性影响分析等外部检索类问题，优先使用 `mx_search`，不要直接凭常识回答，也不要先读仓库文件再决定是否搜索。
- 对自然语言选股、板块成分股、条件筛选、候选池推荐等任务，优先使用 `mx_select_stock`；若问题本质是“找哪些标的符合条件”，不要误用 `mx_search`。
- 用户在“添加自选”意图中提到的“`N`天”对应 `add_stock.count`（或 `klineCount`），例如“添加 002261 成本 34.15 并获取 120 天日K”应调用 `add_stock`，其中 `count=120`。若用户未提供成本价但明确要求拉取 `N` 天日K，可只传 `symbol` 与 `count`。
- 用户询问 TickFlow / 自选股 的日更状态时，必须调用 `daily_update_status`，不要把它解释成其他 crontab、系统任务或无关插件的定时更新。
- 如果当前会话没有暴露对应插件工具，应直接说明当前技能暂不可用。
- 当用户追问“这个任务怎么执行的”“刚才是怎么做的”时，如果任务是通过插件工具完成的，应只说明实际调用的工具名与关键参数；只有用户明确要求命令行等价命令时，再给出 CLI 示例。
- 对 `daily_update_status` 的返回结果，不要额外追加“当前是 local_config”“插件配置问题”“已重试但结果相同”这类解释性警告。先完整原样输出工具结果；只有用户继续追问原因时，才再解释调用链路差异。
- 仅在工具必需参数缺失时，才简短指出缺少的字段。
- 不要臆造股票代码、成本价、日期、阈值、分析结果或监控状态。

输出规则：
- 对 `add_stock`、`list_watchlist`、`list_eastmoney_watchlist`、`sync_eastmoney_watchlist`、`push_eastmoney_watchlist`、`remove_eastmoney_watchlist`、`start_monitor`、`stop_monitor`、`monitor_status`、`start_daily_update`、`stop_daily_update`、`daily_update_status`、`analyze`、`backtest_key_levels`、`view_analysis`、`fetch_klines`、`fetch_intraday_klines`、`mx_search`、`mx_select_stock` 和 `update_all`，调用工具后尽量原样输出返回文本。
- 对 `daily_update_status` 必须完整原样输出，尤其不要省略 `状态`、`运行方式`、`配置来源`、`调度`、`执行情况` 与 `最近摘要`。
- 不要改写、总结、翻译、重排、美化，也不要加表格、额外标题或解释性包装。
- 除非工具明确返回错误，否则不要在工具结果前后添加追问、评论或推断字段。
- 不要省略关键数值、价位、涨跌幅、日期或状态字段。

错误处理：
- 工具成功时，直接返回结果。
- 工具明确报错时，可以补一句简短中文说明，但应保留错误原文或原始关键信息。
- 工具报错时不要编造原因，不要给出没有依据的补救建议。

监控规则：
- `start_monitor` 与 `stop_monitor` 在 OpenClaw 插件模式下默认控制的是托管后台服务，状态里通常显示为 `plugin_service`；本地调试模式下才会回退到项目自管 detached 进程，状态通常显示为 `fallback_process`。
- `start_daily_update` 与 `stop_daily_update` 控制的是日更定时任务，不是一次性的 `update_all`；在 OpenClaw 插件模式下通常显示为 `plugin_service`，本地调试模式下回退到项目自管 detached 进程。
- 查询监控是否运行时优先调用 `monitor_status`，不要根据上下文猜测。
