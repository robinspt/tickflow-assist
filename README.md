# 📈 TickFlow Assist

基于 [OpenClaw](https://openclaw.ai) 的 A 股监控与分析插件。它使用 [TickFlow API](https://tickflow.org/auth/register?ref=BUJ54JEDGE) 获取行情与财务数据，结合 LLM 生成技术面、基本面、资讯面的综合判断，并把结果持久化到本地 LanceDB。

当前主线架构：

- OpenClaw 插件是主入口
- JS/TS 负责主业务流程
- Python 仅保留技术指标计算

兼容性要求：

- TickFlow Assist `0.2.0` 起面向 OpenClaw `v2026.3.22+` 的新版 plugin SDK
- 建议 Node `>=22.16.0`，这是 OpenClaw `v2026.3.22` 上游声明的运行时要求

## 🧭 项目简介

TickFlow Assist 面向一条完整的“自选管理 -> 数据抓取 -> 综合分析 -> 后台监控 -> 结果留痕”链路，适合在 OpenClaw 中做 A 股日常盯盘、收盘后复盘和分析结果沉淀。

## ✨ 核心特性

- 数据抓取：支持日 K、分钟 K、实时行情与财务数据接入，收盘后可批量更新。
- 多维分析：技术面、财务面、资讯面按固定流水线执行，输出综合结论与关键价位。
- 监控告警：围绕止损、突破、支撑、压力、止盈、涨跌幅和成交量异动进行交易时段轮询。
- 复盘留痕：收盘后自动生成活动关键价位快照，并提供 `1/3/5` 日回测统计（测试）。
- 本地数据库：使用 LanceDB 保存自选、K 线、指标、分析结果、关键价位和告警日志。

## 📚 文档导航

- 安装指南：[docs/installation.md](docs/installation.md)
- 使用指南：[docs/usage.md](docs/usage.md)
- 插件清单：[openclaw.plugin.json](openclaw.plugin.json)
- 内置技能：
  - [skills/stock-analysis/SKILL.md](skills/stock-analysis/SKILL.md)
  - [skills/usage-help/SKILL.md](skills/usage-help/SKILL.md)
  - [skills/database-query/SKILL.md](skills/database-query/SKILL.md)

## 🛠 安装与配置

### 一键安装

如果你已经安装了 `git`、`node`、`npm`、`uv`、`openclaw` 与 `jq`，可以直接运行安装向导：

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/robinspt/tickflow-assist/main/setup-tickflow.sh)"
```

向导会自动完成源码更新、依赖安装、配置写入、插件安装与 Gateway 重启。完整流程见 [docs/installation.md](docs/installation.md)。

如果你已经装过旧版本，优先直接执行“升级”。具体升级与重装边界见 [docs/installation.md](docs/installation.md)。

### 手动安装

```bash
git clone https://github.com/robinspt/tickflow-assist.git
cd tickflow-assist
npm install
cd python
uv sync
cd ..
npm run check
npm run build
openclaw plugins install -l /path/to/tickflow-assist
openclaw plugins enable tickflow-assist
openclaw gateway restart
```

正式插件运行读取 `~/.openclaw/openclaw.json` 中的 `plugins.entries["tickflow-assist"].config`。本地调试与 CLI 读取项目根目录 `local.config.json` 下的 `plugin` 字段，两套配置互不共享。

## 🚀 使用方式

常见入口有三种：

- OpenClaw 对话：直接说“添加 002261”“分析 002261”“开始监控”。
- Slash Command：使用 `/ta_addstock`、`/ta_analyze`、`/ta_monitorstatus` 等免 AI 直达命令。
- 本地 CLI：通过 `npm run tool -- ...`、`npm run monitor-loop`、`npm run daily-update-loop` 做调试或直连运行。

常用示例：

```text
添加 002261
分析 002261
/ta_addstock 002261 34.15
/ta_monitorstatus
npm run tool -- analyze '{"symbol":"002261"}'
```

更完整的指令分类、CLI 示例与运行规则见 [docs/usage.md](docs/usage.md)。

## 🧩 架构与目录

后台任务统一由 `tickflow-assist.managed-loop` 托管，在同一个 service 内并行运行日更与实时监控。

```text
tickflow-assist/
├── docs/                         # 安装与使用文档
├── src/                          # 主业务代码
├── src/tools/                    # OpenClaw tools
├── src/services/                 # 行情、分析、监控、告警、更新服务
├── src/background/               # 日更与实时监控后台逻辑
├── src/prompts/analysis/         # 分析 prompt
├── skills/                       # 插件内置 skills
├── python/                       # Python 指标计算子模块
├── openclaw.plugin.json          # 插件清单
└── README.md                     # 项目概览
```

## 🔌 依赖与可选能力

- [TickFlow](https://tickflow.org/auth/register?ref=BUJ54JEDGE)：提供日线、分钟线、实时行情与财务数据接口。
- OpenClaw：负责插件运行、工具注册、对话入口与消息投递。
- [东方财富妙想 Skills](https://marketing.dfcfs.com/views/finskillshub/)：可选，用于 `mx_search` 与 `mx_select_stock`，也用于非 Expert 财务链路的 lite 补充。

## ⚠️ 风险提示

本项目仅用于策略研究、流程验证与教学交流，不构成任何形式的投资建议、收益承诺或具体交易指引。

- 市场环境、流动性、执行价格与个人交易纪律都会影响实际结果，历史表现不代表未来收益。
- AI 模型、自动化分析与回测结果都可能存在偏差、遗漏或失效，不应作为单一决策依据。
- 使用前请结合自身资金情况、风险承受能力与独立判断审慎评估，并自行承担相应风险。

## 📝 更新日志

- `2026-03-17`：统一后台托管循环
- `2026-03-19`：新增财务与妙想链路
- `2026-03-20`：补充收盘分析与回测
- `2026-03-21`：优化A股语境与复盘记忆
- `2026-03-23`：发布 `v0.2.0`，迁移到 OpenClaw `v2026.3.22+` 的新版 plugin SDK，并将复盘改至 20:00 独立调度

## 🙏 鸣谢

- [TickFlow](https://tickflow.org/auth/register?ref=BUJ54JEDGE) 提供行情数据服务与 API 支持
- [OpenClaw](https://openclaw.ai) 提供插件运行、对话通道与工具编排能力
- [CortexReach/memory-lancedb-pro](https://github.com/CortexReach/memory-lancedb-pro) 给你的 OpenClaw Agent 提供持久化、智能化的长期记忆

## 📄 License

MIT
