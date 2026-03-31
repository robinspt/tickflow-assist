# TickFlow Assist

基于 [OpenClaw](https://openclaw.ai) 的 A 股监控与分析插件。它使用 [TickFlow](https://tickflow.org/auth/register?ref=BUJ54JEDGE) 获取行情与财务数据，结合 LLM 生成技术面、基本面、资讯面的综合判断，并把结果持久化到本地 LanceDB。

最近更新：`v0.2.11` 优化复盘/告警文本样式与 PNG 告警卡预览，并按 A 股习惯调整涨跌主色。

## 安装

社区安装：

```bash
openclaw plugins install tickflow-assist
npx -y tickflow-assist configure-openclaw
```

第二条命令会写入 `~/.openclaw/openclaw.json` 中的 `plugins.entries["tickflow-assist"].config`，并默认执行：

- `openclaw plugins enable tickflow-assist`
- `openclaw config validate`
- `openclaw gateway restart`

如果你希望先审阅配置再手动启用或重启，可使用：

```bash
npx -y tickflow-assist configure-openclaw --no-enable --no-restart
```

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

常用字段：

- 必填：`tickflowApiKey`、`llmApiKey`
- 常用：`llmBaseUrl`、`llmModel`、`databasePath`、`calendarFile`
- 可选：`mxSearchApiKey`、`alertTarget`、`alertAccount`

`mxSearchApiKey` 用于 `mx_search`、`mx_select_stock` 以及非 `Expert` 财务链路的 lite 补充；`alertTarget` 仅在 `test_alert`、实时监控告警和定时通知场景需要。

## 功能

- 自选股管理、日 K / 分钟 K 抓取与指标计算
- 技术面、财务面、资讯面的综合分析
- 实时监控、定时日更、收盘后复盘
- 本地 LanceDB 数据留痕与分析结果查看

## 运行说明

- 插件会在本地 `databasePath` 下持久化 LanceDB 数据。
- 后台服务会按配置执行定时日更与实时监控。
- Python 子模块仅用于技术指标计算，不承担主业务流程。

## 仓库

- GitHub: <https://github.com/robinspt/tickflow-assist>
