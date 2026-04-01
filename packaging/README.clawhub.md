# TickFlow Assist

基于 [OpenClaw](https://openclaw.ai) 的 A 股监控与分析插件。它使用 [TickFlow](https://tickflow.org/auth/register?ref=BUJ54JEDGE) 获取行情与财务数据，结合 LLM 生成技术面、基本面、资讯面的综合判断，并把结果持久化到本地 LanceDB。

最近更新：`v0.2.16` 移除社区发布包中的 `child_process` 依赖，以兼容 OpenClaw `v2026.3.31` 的危险代码扫描；源码一键安装脚本仍保留自动依赖安装与 Gateway 配置能力。

当前主线按 OpenClaw `v2026.3.31+` 对齐。

## 安装

社区安装：

```bash
openclaw plugins install tickflow-assist
npx -y tickflow-assist configure-openclaw
cd ~/.openclaw/extensions/tickflow-assist/python && uv sync
openclaw plugins enable tickflow-assist
openclaw config validate
openclaw gateway restart
```

安装阶段允许先落插件，再通过第二条命令写入 `tickflowApiKey`、`llmApiKey` 等正式配置。
`configure-openclaw` 会写入 `~/.openclaw/openclaw.json` 中的 `plugins.entries["tickflow-assist"].config`，并打印后续建议执行的命令；它不再自动执行 `openclaw`、`uv` 或系统包安装命令。

如果你希望先审阅配置，再只打印最少的后续步骤，可使用：

```bash
npx -y tickflow-assist configure-openclaw --no-enable --no-restart
```

如果你在 Linux 上需要 PNG 告警卡正常显示中文，请额外手动安装 `fontconfig` 与 Noto CJK 一类中文字体。

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
