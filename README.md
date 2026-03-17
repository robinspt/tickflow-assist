# 📈 TickFlow Assist

基于 [OpenClaw](https://openclaw.ai) 的 A 股监控与分析插件，利用 [TickFlow API](https://tickflow.org/auth/register?ref=BUJ54JEDGE) 获取日线、分钟线、实时行情，并把分析结果落到本地 LanceDB。

当前主线架构：

- OpenClaw 插件是主入口
- JS/TS 负责主业务流程
- Python 仅保留技术指标计算

## ✨ 功能特点

- 自选股管理：添加、删除、查看、刷新名称
- 日K与分钟K：支持单股抓取与收盘后批量更新
- 技术指标：日线指标持久化，分钟指标按分析任务实时计算
- 智能分析：结合日线、分钟线、实时行情输出关键价位与日内走势判断
- 实时监控：按交易时段轮询报价并触发告警
- 定时日更：OpenClaw 插件模式下由后台 service 托管，本地调试模式保留 detached 进程回退；交易日 15:25 后执行
- 本地数据库：使用 LanceDB 保存行情、指标、分析日志和告警留痕
- OpenClaw 内置 Skills：
  - `stock_analysis`
  - `usage_help`
  - `database_query`

## 📚 文档导航

- 安装指南：[docs/installation.md](docs/installation.md)
- 使用指南：[docs/usage.md](docs/usage.md)
- 插件清单：[openclaw.plugin.json](openclaw.plugin.json)
- 内置技能：
  - [skills/stock-analysis/SKILL.md](skills/stock-analysis/SKILL.md)
  - [skills/usage-help/SKILL.md](skills/usage-help/SKILL.md)
  - [skills/database-query/SKILL.md](skills/database-query/SKILL.md)

- TickFlow数据获取：[TickFlow官网](https://tickflow.org/auth/register?ref=BUJ54JEDGE) 
  - TickFlow 是为量化开发者打造的**专业金融数据 API**
  - Free 套餐即可使用稳定的**日线K线、实时行情**，具体详见官网介绍。

## ⚡ 一键安装

如果你已经安装了 `git`、`node`、`npm`、`uv`、`openclaw` 与 `jq`，可以直接运行一键安装向导：

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/robinspt/tickflow-assist/main/setup-tickflow.sh)"
```

安装向导会自动：

- 拉取或更新源码
- 安装依赖并构建
- 收集 TickFlow / LLM / 告警通道配置
- 写入 `local.config.json` 与 `~/.openclaw/openclaw.json`
- 安装并启用 OpenClaw 插件
- 重启 OpenClaw Gateway

如果项目目录里已经有 `local.config.json`，向导会优先沿用已有配置，避免重复安装时把本地调试参数覆盖回默认值。完整安装说明见 [docs/installation.md](docs/installation.md)。

## 🔄 更新方式

**项目仍在前期功能快速迭代中，请定期更新。**

如果你已经完成安装，后续建议定期在项目目录执行以下命令，同步最新代码与构建结果：

```bash
git pull
npm install
npm run build
openclaw gateway restart
```

如果本次更新涉及 Python 指标桥接依赖，也请额外执行：

```bash
cd python
uv sync
cd ..
```

## 🚀 核心能力

### 行情与分析

- `fetch_klines`：抓取日K并重算日线指标
- `fetch_intraday_klines`：抓取当日分钟K并写入数据库
- `update_all`：收盘后批量更新日K、日线指标和当日分钟K
- `analyze`：读取本地日线数据，并临时补充分钟线、分钟指标、实时行情做综合分析

### 监控与告警

- 实时监控交易时段：`09:30-11:30`、`13:00-15:00`
- 支持止损、突破、支撑、压力、止盈、涨跌幅、成交量等规则
- 盯盘阶段通知：上午开盘、上午结束、下午开盘、当日收盘自动推送
- 通过 OpenClaw CLI 投递 Telegram、QQBot、WeCom 等通道

### 数据落库

| 表名 | 说明 |
|---|---|
| `watchlist` | 关注列表 |
| `klines_daily` | 日 K 数据 |
| `klines_intraday` | 分钟 K 数据，默认仅保留近 10 个交易日 |
| `indicators` | 日线技术指标 |
| `key_levels` | 关键价位与评分 |
| `analysis_log` | 分析日志 |
| `alert_log` | 告警日志 |

## 📝 Changelog

### 2026-03-17

- 解决后台循环失败问题，统一由单一托管 service 并行管理日更与实时监控任务，避免部分循环未被正常启动。

## 🧩 支持的 Claw

- 🦞 [OpenClaw](https://openclaw.ai)（已支持）
- 🐈 [Nanobot](https://github.com/HKUDS/nanobot)（待 Nanobot 支持 Plugins）
- 🤖 其他 Claw（待增加）

## 🗂️ 项目结构

```text
tickflow-assist/
├── docs/                         # 安装与使用文档
├── src/                          # 主业务代码
├── skills/                       # 插件内置 skills
├── python/                       # Python 指标计算桥接
├── openclaw.plugin.json          # 插件清单
├── README.md                     # 项目概览
└── day_future.txt                # 交易日历
```

## 🙏 鸣谢

- [TickFlow](https://tickflow.org/auth/register?ref=BUJ54JEDGE) 提供行情数据服务与 API 支持
- [OpenClaw](https://openclaw.ai) 提供插件运行、对话通道与工具编排能力
- [sliverp/qqbot](https://github.com/sliverp/qqbot) 提供 QQ 机器人通道接入
- [WecomTeam/wecom-openclaw-plugin](https://github.com/WecomTeam/wecom-openclaw-plugin) 提供企业微信通道接入
- [CortexReach/memory-lancedb-pro](https://github.com/CortexReach/memory-lancedb-pro) 给你的 OpenClaw Agent 提供持久化、智能化的长期记忆

## 📄 License

MIT
