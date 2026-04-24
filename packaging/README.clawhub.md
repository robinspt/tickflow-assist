# TickFlow Assist

基于 [OpenClaw](https://openclaw.ai) 的 A 股监控与分析插件。它使用 [TickFlow](https://tickflow.org/auth/register?ref=BUJ54JEDGE) 获取行情与财务数据，并可选接入 [金十数据 MCP](https://mcp.jin10.com/app/) 快讯流，结合 LLM 生成技术面、基本面、资讯面的综合判断，并把结果持久化到本地 LanceDB。

最近更新：`v0.3.7` 接入 TickFlow 标的池行业映射与申万三级同业上下文，优化盘前简报提炼与收盘复盘市场信息展示，并复核 OpenClaw `v2026.4.22` 兼容与社区元数据。完整发布记录见 <https://github.com/robinspt/tickflow-assist/blob/main/CHANGELOG.md>。

当前主线按 OpenClaw `v2026.3.31+` 对齐，并已验证社区安装在 `v2026.4.22` 上兼容。

## 安装前准备

在执行社区安装前，建议先确认你已经准备好以下配置：

- 核心必需：`tickflowApiKey`、`llmApiKey`、`llmBaseUrl`、`llmModel`
- 告警投递：`alertChannel`、`alertTarget`、`alertAccount`
- 可选增强：`mxSearchApiKey`、`jin10ApiToken`

其中，`configure-openclaw` 会把上述配置写入 `~/.openclaw/openclaw.json` 的 `plugins.entries["tickflow-assist"].config`，插件启用后会在本地 `databasePath` 下持久化 LanceDB 数据，并运行监控 / 日更等后台服务。
如果你不想把密钥写进配置文件，运行时也支持环境变量回退，优先级是 `openclaw.json / local.config.json` > 环境变量 > 默认值。
常用环境变量：`TICKFLOW_ASSIST_TICKFLOW_API_KEY` / `TICKFLOW_API_KEY`、`TICKFLOW_ASSIST_LLM_API_KEY` / `LLM_API_KEY`、`TICKFLOW_ASSIST_LLM_BASE_URL` / `LLM_BASE_URL`、`TICKFLOW_ASSIST_LLM_MODEL` / `LLM_MODEL`、`TICKFLOW_ASSIST_MX_SEARCH_API_KEY` / `MX_SEARCH_API_KEY` / `MX_APIKEY`、`TICKFLOW_ASSIST_JIN10_API_TOKEN` / `JIN10_API_TOKEN`。
如果你希望尽量避免把密钥落盘，推荐先把这些变量写进 `~/.openclaw/.env`，再运行配置向导补齐非密钥项。

## 安装

社区安装：

```bash
openclaw plugins install tickflow-assist
node ~/.openclaw/extensions/tickflow-assist/dist/dev/tickflow-assist-cli.js configure-openclaw
cd ~/.openclaw/extensions/tickflow-assist/python && uv sync
openclaw plugins enable tickflow-assist
openclaw config validate
openclaw gateway restart
```

- `configure-openclaw` 会把配置写入 `~/.openclaw/openclaw.json` 的 `plugins.entries["tickflow-assist"].config`。
- 核心必填建议先准备：`tickflowApiKey`、`tickflowApiKeyLevel`、`llmApiKey`、`llmBaseUrl`、`llmModel`；告警场景再补 `alertChannel`、`alertTarget`、`alertAccount`。
- 如果你不想把密钥落盘，优先把环境变量写进 `~/.openclaw/.env`，再运行配置向导补齐非密钥项；如需 PNG 告警卡正常显示中文，请自行安装 `fontconfig` 与 Noto CJK 字体。

社区安装后的升级方式：

```bash
openclaw plugins update tickflow-assist
openclaw gateway restart
```

## 配置

插件正式运行读取：

```text
~/.openclaw/openclaw.json
```

配置路径：

```text
plugins.entries["tickflow-assist"].config
```

建议按完整功能显式填写以下字段，不要只填 API Key：

- 核心运行：`tickflowApiKey`、`llmApiKey`、`llmBaseUrl`、`llmModel`
- 本地数据：`databasePath`、`calendarFile`
- 告警投递：`alertChannel`、`alertTarget`、`alertAccount`
- 能力补充：`mxSearchApiKey`、`jin10ApiToken`

其中，`mxSearchApiKey` 用于 `mx_search`、`mx_data`、`mx_select_stock`、东方财富自选同步以及非 `Expert` 财务链路的 lite 补充；东方财富自选管理接口每日额度 200 次；`jin10ApiToken` 用于 24 小时金十数据快讯监控；`jin10FlashNightAlert` 默认 `false`（开启夜间静默），设为 `true` 可恢复 24 小时快讯告警；`alertTarget`、`alertAccount` 建议在准备启用 `test_alert`、实时监控告警、金十数据快讯告警和定时通知前一并配好，避免配置不完整导致功能缺失。
如果你使用环境变量，运行时支持以下回退：

- `tickflowApiUrl`：`TICKFLOW_ASSIST_TICKFLOW_API_URL` / `TICKFLOW_API_URL`
- `tickflowApiKey`：`TICKFLOW_ASSIST_TICKFLOW_API_KEY` / `TICKFLOW_API_KEY`
- `tickflowApiKeyLevel`：`TICKFLOW_ASSIST_TICKFLOW_API_KEY_LEVEL` / `TICKFLOW_API_KEY_LEVEL`
- `llmBaseUrl`：`TICKFLOW_ASSIST_LLM_BASE_URL` / `LLM_BASE_URL`
- `llmApiKey`：`TICKFLOW_ASSIST_LLM_API_KEY` / `LLM_API_KEY`
- `llmModel`：`TICKFLOW_ASSIST_LLM_MODEL` / `LLM_MODEL`
- `mxSearchApiUrl`：`TICKFLOW_ASSIST_MX_SEARCH_API_URL` / `MX_SEARCH_API_URL`
- `mxSearchApiKey`：`TICKFLOW_ASSIST_MX_SEARCH_API_KEY` / `MX_SEARCH_API_KEY` / `MX_APIKEY`
- `jin10McpUrl`：`TICKFLOW_ASSIST_JIN10_MCP_URL` / `JIN10_MCP_URL`
- `jin10ApiToken`：`TICKFLOW_ASSIST_JIN10_API_TOKEN` / `JIN10_API_TOKEN`

## 功能

- 自选股管理、东方财富自选同步、日 K / 分钟 K 抓取与指标计算
- 妙想资讯搜索、官方金融数据查询、智能选股，以及限量候选池 + TickFlow 补数据联动
- 技术面、财务面、资讯面的综合分析
- 实时监控、定时日更、收盘后复盘
- 金十数据 24 小时快讯监控与自选关联提醒
- 本地 LanceDB 数据留痕与分析结果查看

## 运行说明

- 插件会在本地 `databasePath` 下持久化 LanceDB 数据。
- 后台服务会按配置执行定时日更、实时监控与金十数据快讯监控。
- Python 子模块仅用于技术指标计算，不承担主业务流程。

## 依赖与可选能力

- [TickFlow](https://tickflow.org/auth/register?ref=BUJ54JEDGE)：`Free` 可用日线与实时行情；`Starter` 起可用标的池，插件会用来做申万行业映射与申万 3 级同业表现；`Pro` 起可用分钟K；`Expert` 才走 TickFlow 财务数据，非 `Expert` 默认回退妙想 lite。
- [金十数据 MCP](https://mcp.jin10.com/app/)：可选，用于 24 小时快讯流接入、自选关联筛选与事件驱动告警。独立的金十数据 Skill 详见 [OpenClaw Skill](https://clawhub.ai/robinspt/jin10) / [Hermes Skill](https://github.com/robinspt/hermes-skills)。
- [东方财富妙想 Skills](https://marketing.dfcfs.com/views/finskillshub/)：可选，用于 `mx_search`、`mx_data`、`mx_select_stock`、东方财富自选同步与非 `Expert` 财务链路的 lite 补充。

## 仓库

- GitHub: [robinspt/tickflow-assist](https://github.com/robinspt/tickflow-assist)
