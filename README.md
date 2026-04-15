# 📈 TickFlow Assist

基于 [OpenClaw](https://openclaw.ai) 的 A 股监控与分析插件。它使用 [TickFlow API](https://tickflow.org/auth/register?ref=BUJ54JEDGE) 获取行情与财务数据，并可选接入 [金十数据 MCP](https://mcp.jin10.com/app/) 快讯流，结合 LLM 生成技术面、基本面、资讯面的综合判断，并把结果持久化到本地 LanceDB。

最近更新：`v0.3.6` 修复 Telegram 告警重复补发，并修复 QQBot 图片告警路径问题，确保图文告警通过 OpenClaw 稳定送达。完整发布记录见 [CHANGELOG.md](CHANGELOG.md)。

当前主线架构：

- OpenClaw 插件是主入口
- JS/TS 负责主业务流程
- Python 仅保留技术指标计算

兼容性要求：

- TickFlow Assist 当前主线按 OpenClaw `v2026.3.31+` 对齐，已验证社区安装在 `v2026.4.14` 上兼容
- 建议 Node `>=22.14.0`，并以目标 OpenClaw 版本上游要求为准

## 🧭 项目简介

TickFlow Assist 面向一条完整的“自选管理 -> 数据抓取 -> 综合分析 -> 后台监控 -> 结果留痕”链路，适合在 OpenClaw 中做 A 股日常盯盘、收盘后复盘和分析结果沉淀。

## ✨ 核心特性

- 数据抓取：支持日 K、分钟 K、实时行情、财务数据与金十数据快讯接入，收盘后可批量更新。
- 多维分析：技术面、财务面、资讯面按固定流水线执行，输出综合结论与关键价位。
- 监控告警：围绕止损、突破、支撑、压力、止盈、涨跌幅和成交量异动进行交易时段轮询，并支持金十数据 24 小时快讯候选筛选与事件告警。
- 复盘留痕：收盘后自动生成活动关键价位快照，并提供 `1/3/5` 日回测统计（测试）。
- 本地数据库：使用 LanceDB 保存自选、K 线、指标、分析结果、关键价位和告警日志。

## 📚 文档导航

- 安装指南：[docs/installation.md](docs/installation.md)
- 使用指南：[docs/usage.md](docs/usage.md)
- 更新日志：[CHANGELOG.md](CHANGELOG.md)
- 插件清单：[openclaw.plugin.json](openclaw.plugin.json)
- npm 包：https://www.npmjs.com/package/tickflow-assist
- 内置技能：
  - [skills/stock-analysis/SKILL.md](skills/stock-analysis/SKILL.md)
  - [skills/usage-help/SKILL.md](skills/usage-help/SKILL.md)
  - [skills/database-query/SKILL.md](skills/database-query/SKILL.md)

## 🛠 安装与配置

如果你是从 GitHub 仓库开始安装，优先建议使用一键安装脚本；社区安装更适合只安装正式发布包、不改源码的场景。

### 一键安装脚本（首选）

如果你已经安装了 `git`、`node`、`npm`、`uv`、`openclaw` 与 `jq`，并且想要从源码运行，可以直接运行安装向导：

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/robinspt/tickflow-assist/main/setup-tickflow.sh)"
```

向导会自动完成源码更新、依赖安装、配置写入、插件安装与 Gateway 重启。完整流程见 [docs/installation.md](docs/installation.md)。
在 Linux 上，向导也会 best-effort 安装 PNG 告警卡所需的中文字体。
脚本要求系统里已经能执行 `openclaw` 命令；其中 npm 步骤只会安装当前源码目录构建所需的本地 devDependencies，不会替你安装宿主 OpenClaw。

如果你已经装过旧版本，优先直接执行“升级”。具体升级与重装边界见 [docs/installation.md](docs/installation.md)。

### 社区安装（适合正式发布包）

如果你不需改动源码，可以直接通过 OpenClaw 插件市场或 npm 安装，但 **默认不推荐**。为适配 ClawHub / 社区发布包，这条链路牺牲了源码版的一键安装、自动升级与部分便捷能力；日常使用优先建议走上面的“一键安装脚本”。

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

社区安装的详细说明、限制与发布页专用文案见 [packaging/README.clawhub.md](packaging/README.clawhub.md)。

### 手动源码安装

```bash
git clone https://github.com/robinspt/tickflow-assist.git
cd tickflow-assist
npm install --include=dev --loglevel=error --no-fund --no-audit
cd python
uv sync
cd ..
npm run check
npm run build
openclaw plugins install -l /path/to/tickflow-assist
openclaw plugins enable tickflow-assist
openclaw gateway restart
```


## 🔄 升级

如果你是通过 `openclaw plugins install tickflow-assist` 安装的社区版本，后续升级可直接执行：

```bash
openclaw plugins update tickflow-assist
openclaw gateway restart
```

如果想同时升级所有已跟踪插件，也可以执行：

```bash
openclaw plugins update --all
openclaw gateway restart
```

如果你是通过 `openclaw plugins install -l /path/to/tickflow-assist` 链接本地源码目录，`openclaw plugins update` 不会替你拉源码。此时应在源码目录手动更新后重新构建并重启 Gateway：

```bash
git pull
npm install --include=dev --loglevel=error --no-fund --no-audit
cd python
uv sync
cd ..
npm run check
npm run build
openclaw gateway restart
```

## 🚀 使用方式

常见入口有三种：

- OpenClaw 对话：直接说“添加 002261”“分析 002261”“开始监控”。
- Slash Command：使用 `/ta_addstock`、`/ta_analyze`、`/ta_monitorstatus`、`/ta_flashstatus` 等免 AI 直达命令。
- 本地 CLI：通过 `npm run tool -- ...`、`npm run monitor-loop`、`npm run daily-update-loop` 做调试或直连运行。

常用示例：

```text
添加 002261
分析 002261
/ta_addstock 002261 34.15
/ta_monitorstatus
/ta_flashstatus
npm run tool -- analyze '{"symbol":"002261"}'
```

更完整的指令分类、CLI 示例与运行规则见 [docs/usage.md](docs/usage.md)。

## 🧩 架构与目录

后台任务统一由 `tickflow-assist.managed-loop` 托管，在同一个 service 内并行运行日更、实时监控与金十数据 24 小时快讯监控。

```text
tickflow-assist/
├── docs/                         # 安装、使用与示例文档
├── src/                          # 主业务代码
├── src/tools/                    # OpenClaw tools
├── src/services/                 # 行情、分析、金十数据 MCP、监控、告警、更新服务
├── src/background/               # 日更、价格监控与金十数据快讯后台逻辑
├── src/prompts/analysis/         # 分析 prompt
├── skills/                       # 插件内置 skills
├── python/                       # Python 指标计算子模块
├── openclaw.plugin.json          # 插件清单
├── CHANGELOG.md                  # 独立更新日志
└── README.md                     # 项目概览
```

## 🔌 依赖与可选能力

- [TickFlow](https://tickflow.org/auth/register?ref=BUJ54JEDGE)：`Free` 可用日线与实时行情；`Starter` 起可用标的池，插件会用来做申万行业映射与申万 3 级同业表现；`Pro` 起可用分钟K；`Expert` 才走 TickFlow 财务数据，非 `Expert` 默认回退妙想 lite。
- OpenClaw：负责插件运行、工具注册、对话入口与消息投递。
- [金十数据 MCP](https://mcp.jin10.com/app/)：可选，用于 24 小时快讯流接入、自选关联筛选与事件驱动告警。独立的金十数据 Skill 详见 [OpenClaw Skill](https://clawhub.ai/robinspt/jin10) / [Hermes Skill](https://github.com/robinspt/hermes-skills)。
- [东方财富妙想 Skills](https://marketing.dfcfs.com/views/finskillshub/)：可选，用于 `mx_search` 与 `mx_select_stock`，也用于非 Expert 财务链路的 lite 补充。

## ⚠️ 风险提示

本项目仅用于策略研究、流程验证与教学交流，不构成任何形式的投资建议、收益承诺或具体交易指引。

- 市场环境、流动性、执行价格与个人交易纪律都会影响实际结果，历史表现不代表未来收益。
- AI 模型、自动化分析与回测结果都可能存在偏差、遗漏或失效，不应作为单一决策依据。
- 使用前请结合自身资金情况、风险承受能力与独立判断审慎评估，并自行承担相应风险。

## 🖼 效果预览

`/ta_testalert` 与 `test_alert` 现在会同时验证文本和 PNG 告警卡链路。下图为当前测试告警样式示例：

![TickFlow Assist 测试告警 PNG 示例](docs/images/test-alert-demo.png)

## 📝 更新记录

完整历史发布记录见 [CHANGELOG.md](CHANGELOG.md)。

## 🙏 鸣谢

- [TickFlow](https://tickflow.org/auth/register?ref=BUJ54JEDGE) 提供行情数据服务与 API 支持
- [OpenClaw](https://openclaw.ai) 提供插件运行、对话通道与工具编排能力
- [CortexReach/memory-lancedb-pro](https://github.com/CortexReach/memory-lancedb-pro) 给你的 OpenClaw Agent 提供持久化、智能化的长期记忆

## 📄 License

MIT
