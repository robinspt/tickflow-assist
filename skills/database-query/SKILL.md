---
name: database_query
description: Query TickFlow Assist LanceDB tables, schemas, and stored records through the query_database tool.
metadata:
  openclaw:
    skillKey: database_query
    requires:
      config:
        - plugins.entries.tickflow-assist.enabled
---
# LanceDB 数据查询

这个技能用于查询 TickFlow Assist 插件写入的 LanceDB 数据，包括数据表列表、表结构，以及表内记录。

优先使用 `query_database` 工具，不要改用 `exec`、shell 命令、`node -e`、`python -c`、LanceDB 脚本或直接读数据库文件，也不要在没有工具返回结果的前提下猜测数据库内容。

适用场景：
- 查看当前有哪些数据表
- 查看某张表有哪些字段
- 查询某只股票在某张表中的记录
- 查看最近几条分析日志、告警日志、指标数据
- 按关键词在表记录里做简单检索

中文意图与工具映射：
- “数据库里有哪些表”、“列出数据库表” -> `query_database`，`action=tables`
- “看技术指标表结构”、“分析日志有哪些字段” -> `query_database`，`action=schema`
- “查 002261 的指标数据”、“看 002261 的日K” -> `query_database`，`action=query`
- “看最近 5 条分析日志”、“查告警日志” -> `query_database`，`action=query`
- “在分析日志里搜索突破” -> `query_database`，`action=query`

参数理解规则：
- 常用表名可按自然语言理解并映射：
  - “自选” -> `watchlist`
  - “日K”、“日线” -> `klines_daily`
  - “分钟K”、“分钟线”、“分时” -> `klines_intraday`
  - “指标” -> `indicators`
  - “关键价位” -> `key_levels`
  - “分析日志” -> `analysis_log`
  - “告警日志” -> `alert_log`
- 股票代码按用户原始输入提取，例如 `002261`，传给 `symbol`。
- “最近 N 条”、“前 N 条”对应 `limit`。
- “字段 A、B、C”对应 `fields`。
- “按 trade_date 排序”可传 `sortBy="trade_date"`，最近数据默认优先考虑 `sortOrder="desc"`。
- “搜索某个关键词”可传 `contains`。
- 如果用户只是问数据库里有什么，优先先列出表，不要直接猜测表内容。
- 禁止使用 `exec`、shell、`node -e`、`python -c`、直接打开 LanceDB 文件、临时写脚本查询或任何绕过 `query_database` 的方式。
- 如果当前环境拿不到 `query_database` 工具，直接说明当前无法按技能约束查询，不要回退到命令行或脚本直读数据库。

输出规则：
- 对 `query_database` 的返回尽量原样输出。
- 不要把数据库结果改写成分析结论，除非用户明确要求解释数据含义。
- 当用户问“数据库有没有某类数据”但工具结果为空时，直接说明没查到，不要臆测是没同步还是没入库。

示例：
- “数据库里有哪些表”
- “看技术指标表结构”
- “查 002261 最近 5 条技术指标”
- “看最近 3 条分析日志”
- “在分析日志里搜索 突破”
