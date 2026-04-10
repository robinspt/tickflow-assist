# Changelog

## v0.3.4 - 2026-04-10

- 新增每天北京时间 `09:20` 的盘前资讯简报：自动汇总前一日 `17:00` 到当日 `09:20` 间的金十重点快讯，并结合自选股上下文生成开盘前摘要。
- 修复金十快讯监控把历史补页当成新消息重复推送的问题，并修正 `ta_flashstatus` / 状态页把补写入库记录误显示为“最新快讯”的问题。
- 修复并发监控实例下同一 `session + symbol + rule` 告警仍可能整组重复发送的问题；同时补强 Jin10 session 失效自动恢复与盘前简报“同日只尝试一次”的保护逻辑。
- `telegram` 告警发送在插件 runtime 下改为优先走 `sendMessageTelegram`，避免图文消息已送达却因 CLI 退出状态误判失败后再次补发图片和文本。

## v0.3.3 - 2026-04-09

- 修复实时监控告警在会话去重前先生成 PNG 导致临时目录高频堆图的问题。
- 增加监控轮询运行锁，避免 `plugin_service` 与 `fallback_process` 并发执行导致重复告警。
- 收敛价格告警策略：单轮单票只发送优先级最高的一条，并缩窄“接近”判定窗口以减少噪声。
- 补充 `monitor-service` 回归测试，覆盖去重前不出图、失败后清理媒体、单轮告警收敛与并发互斥。

## v0.3.2 - 2026-04-08

- 新增 `jin10FlashNightAlert` 夜间静默配置，并将全局默认值改为 `false`：默认在北京时间 `22:00~06:00` 静默不发送金十快讯告警，如需恢复 24 小时告警可显式关闭夜间静默。
- `setup-tickflow.sh` 与 `configure-openclaw` 改为菜单式选择夜间静默模式，安装与配置时可直接选择“24 小时告警”或“22:00~06:00 不告警（默认）”。
- 收盘复盘新增金十快讯上下文：一方面注入当日已触发的个股关联快讯，另一方面补充“港股收评”“每日投行/机构观点梳理”“A 股每日市场要闻回顾”等市场概览快讯，供复盘结论综合参考。

## v0.3.1 - 2026-04-07

- 补充 npm Trusted Publishing 所需的 `repository`、`homepage`、`bugs` 包元数据，修复 GitHub Release 触发的 `npm publish --provenance` 因仓库信息缺失而被 npm 拒绝的问题。
- 将金十数据 MCP `initialize` 握手中的 `clientInfo` 调整为中性固定值 `mcp-client / 1.0.0`，避免插件版本号继续暴露在上游握手元信息里。

## v0.3.0 - 2026-04-07

- 接入 [金十数据 MCP](https://mcp.jin10.com/app/) 24 小时快讯监控，新增独立后台循环、原始快讯 LanceDB 落库、按保留天数清理和 `/ta_flashstatus` 状态查看。
- 金十数据快讯告警采用“两段式筛选”：先按自选股代码、名称、行业和题材生成候选，再交给 LLM 判断是否需要推送；未命中 LLM 时保留直接提及个股的兜底策略。
- 金十数据 MCP 接入改为标准 `initialize -> notifications/initialized -> tools/list/resources/list -> tools/call` 流程，优先读取 `structuredContent`，支持 `cursor / next_cursor` 分页和标准 SSE 响应解析。
- 一键安装脚本、`configure-openclaw`、本地调试配置与状态工具同步补充金十数据配置项与运行入口，默认轮询间隔调整为 300 秒。
- README 改为引用独立更新日志，避免主页堆积过长的历史发布记录。

## v0.2.19 - 2026-04-02

- 将社区版 `openclaw.compat.pluginApi` 调整为范围声明 `>=2026.3.31`，保留最小兼容版本并将构建对齐信息升级到 `2026.4.1`，修复 OpenClaw `v2026.4.1` 上社区更新被精确版本校验拦截的问题。

## v0.2.18 - 2026-04-02

- 调整 PNG 告警卡的 A 股日内时间轴与午间衔接逻辑，修复测试图和示例图时间显示不一致；同时更新社区版配置字段说明，并补强 npm 打包脚本对包页 README 元数据的处理。

## v0.2.17 - 2026-04-01

- 补充社区安装所需的 Linux / macOS 字体安装命令；`configure-openclaw` 会自动把被旧版本钉死的 ClawHub install spec 归一化为 `clawhub:tickflow-assist`，并将空自选时的 `ta_startmonitor` 通用失败改为明确提示。

## v0.2.16 - 2026-04-01

- 移除社区发布包中的 `child_process` 依赖以兼容 OpenClaw `v2026.3.31` 的危险代码扫描；同时保留源码一键安装脚本的自动依赖安装与 Gateway 配置能力，并将 GitHub README 调整为优先推荐一键脚本安装。

## v0.2.15 - 2026-04-01

- 重新发布 npm 包以刷新包页 README 展示；功能与运行逻辑相对 `v0.2.14` 无新增变更。

## v0.2.14 - 2026-04-01

- 对齐 OpenClaw `v2026.3.31` 兼容声明与开发依赖，更新 QQ Bot 内置通道说明，并将 PNG 告警卡临时文件迁移到 OpenClaw 共享 temp root，修复新版本地媒体 allowlist 下的图片投递失败。

## v0.2.13 - 2026-03-31

- 在 `configure-openclaw` 与一键安装脚本中加入 Linux 中文字体自动安装，减少 VPS 上 PNG 告警卡中文乱码；并补充 GitHub README 效果预览图。

## v0.2.12 - 2026-03-31

- 调整社区安装清单，允许先安装插件再执行 `configure-openclaw` 写入密钥配置；同时将 `test_alert` 升级为文本加 PNG 告警卡链路测试。

## v0.2.11 - 2026-03-31

- 优化复盘与告警文本样式，接入 PNG 告警卡发送与临时文件清理，并按 A 股习惯调整涨跌主色。

## v0.2.10 - 2026-03-30

- 补充 ClawHub 发布器要求的 `openclaw.build.openclawVersion` 元数据。

## v0.2.9 - 2026-03-30

- 将 `openclaw.compat.pluginApi` 与最低网关兼容线上调到 `2026.3.28`，修复 ClawHub 安装器与 runtime 版本比对失败的问题。

## v0.2.8 - 2026-03-29

- 恢复 ClawHub 仍要求的 `openclaw.compat` 字段，并声明插件 API / 最低网关兼容线为 `2026.3.22`。

## v0.2.7 - 2026-03-29

- 移除过时的 `openclaw.compat.pluginApi` 元数据并升级开发依赖到 OpenClaw `v2026.3.28`。

## v0.2.6 - 2026-03-28

- 补充 ClawHub 合规打包与 OpenClaw 插件兼容声明。

## v0.2.5 - 2026-03-27

- 优化分析 prompt 并增强结构化 JSON 解析容错。

## v0.2.0 - 2026-03-23

- 迁移到 OpenClaw `v2026.3.22+` 的新版 plugin SDK，并将复盘改至 20:00 独立调度。

## Pre-release milestones

- 2026-03-21：优化 A 股语境与复盘记忆。
- 2026-03-20：补充收盘分析与回测。
- 2026-03-19：新增财务与妙想链路。
- 2026-03-17：统一后台托管循环。
