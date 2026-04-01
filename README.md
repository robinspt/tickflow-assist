# 📈 TickFlow Assist

基于 [OpenClaw](https://openclaw.ai) 的 A 股监控与分析插件。它使用 [TickFlow API](https://tickflow.org/auth/register?ref=BUJ54JEDGE) 获取行情与财务数据，结合 LLM 生成技术面、基本面、资讯面的综合判断，并把结果持久化到本地 LanceDB。

当前主线架构：

- OpenClaw 插件是主入口
- JS/TS 负责主业务流程
- Python 仅保留技术指标计算

兼容性要求：

- TickFlow Assist 当前主线按 OpenClaw `v2026.3.31+` 对齐
- 建议 Node `>=22.14.0`，并以目标 OpenClaw 版本上游要求为准

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

如果你已经装过旧版本，优先直接执行“升级”。具体升级与重装边界见 [docs/installation.md](docs/installation.md)。

### 社区安装（适合正式发布包）

如果你不需改动源码，可直接通过 OpenClaw 插件市场或 npm 安装：

```bash
openclaw plugins install tickflow-assist
npx -y tickflow-assist configure-openclaw
cd ~/.openclaw/extensions/tickflow-assist/python && uv sync
openclaw plugins enable tickflow-assist
openclaw config validate
openclaw gateway restart
```

社区安装时允许先完成插件安装，再通过第二条命令写入 `tickflowApiKey`、`llmApiKey` 等正式配置。
`configure-openclaw` 现在只负责写配置和打印下一步命令，不再自动执行 `openclaw`、`uv` 或系统包安装命令。
如果检测到 `plugins.installs["tickflow-assist"]` 来自 `clawhub`，向导还会把被旧版本钉死的 `spec` 归一化为 `clawhub:tickflow-assist`，避免后续升级一直锁在旧版本。
如果你在 Linux 或 macOS 上需要 PNG 告警卡正常显示中文，请额外手动安装 `fontconfig` 与 Noto CJK 一类中文字体，例如：

```bash
# Debian / Ubuntu
sudo apt-get update
sudo apt-get install -y fontconfig fonts-noto-cjk
fc-cache -fv

# RHEL / Fedora / Rocky / AlmaLinux
sudo dnf install -y fontconfig google-noto-sans-cjk-ttc-fonts
fc-cache -fv

# Arch / Manjaro
sudo pacman -Sy --noconfirm fontconfig noto-fonts-cjk
fc-cache -fv

# Alpine
sudo apk add fontconfig font-noto-cjk
fc-cache -fv

# macOS (Homebrew)
brew install fontconfig
brew install --cask font-noto-sans-cjk
fc-cache -fv
```

### 手动源码安装

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
npm install
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

## 🖼 效果预览

`/ta_testalert` 与 `test_alert` 现在会同时验证文本和 PNG 告警卡链路。下图为当前测试告警样式示例：

![TickFlow Assist 测试告警 PNG 示例](docs/images/test-alert-demo.png)

## 📝 更新日志

- `2026-03-17`：统一后台托管循环
- `2026-03-19`：新增财务与妙想链路
- `2026-03-20`：补充收盘分析与回测
- `2026-03-21`：优化A股语境与复盘记忆
- `2026-03-23`：发布 `v0.2.0`，迁移到 OpenClaw `v2026.3.22+` 的新版 plugin SDK，并将复盘改至 20:00 独立调度
- `2026-03-27`：发布 `v0.2.5`，优化分析 prompt 并增强结构化 JSON 解析容错。
- `2026-03-28`：发布 `v0.2.6`，补充 ClawHub 合规打包与 OpenClaw 插件兼容声明。
- `2026-03-29`：发布 `v0.2.7`，移除过时的 `openclaw.compat.pluginApi` 元数据并升级开发依赖到 OpenClaw `v2026.3.28`。
- `2026-03-29`：发布 `v0.2.8`，恢复 ClawHub 仍要求的 `openclaw.compat` 字段，并声明插件 API / 最低网关兼容线为 `2026.3.22`。
- `2026-03-30`：发布 `v0.2.9`，将 `openclaw.compat.pluginApi` 与最低网关兼容线上调到 `2026.3.28`，修复 ClawHub 安装器与 runtime 版本比对失败的问题。
- `2026-03-30`：发布 `v0.2.10`，补充 ClawHub 发布器要求的 `openclaw.build.openclawVersion` 元数据。
- `2026-03-31`：发布 `v0.2.11`，优化复盘/告警文本样式，接入 PNG 告警卡发送与临时文件清理，并按 A 股习惯调整涨跌主色。
- `2026-03-31`：发布 `v0.2.12`，调整社区安装清单，允许先安装插件再执行 `configure-openclaw` 写入密钥配置；同时将 `test_alert` 升级为文本 + PNG 告警卡链路测试。
- `2026-03-31`：发布 `v0.2.13`，在 `configure-openclaw` 与一键安装脚本中加入 Linux 中文字体自动安装，减少 VPS 上 PNG 告警卡中文乱码；并补充 GitHub README 效果预览图。
- `2026-04-01`：发布 `v0.2.14`，对齐 OpenClaw `v2026.3.31` 兼容声明与开发依赖，更新 QQ Bot 内置通道说明，并将 PNG 告警卡临时文件迁移到 OpenClaw 共享 temp root，修复新版本地媒体 allowlist 下的图片投递失败。
- `2026-04-01`：发布 `v0.2.15`，重新发布 npm 包以刷新包页 README 展示；功能与运行逻辑相对 `v0.2.14` 无新增变更。
- `2026-04-01`：发布 `v0.2.16`，移除社区发布包中的 `child_process` 依赖以兼容 OpenClaw `v2026.3.31` 的危险代码扫描；同时保留源码一键安装脚本的自动依赖安装与 Gateway 配置能力，并将 GitHub README 调整为优先推荐一键脚本安装。
- `2026-04-01`：发布 `v0.2.17`，补充社区安装所需的 Linux / macOS 字体安装命令；`configure-openclaw` 会自动把被旧版本钉死的 ClawHub install spec 归一化为 `clawhub:tickflow-assist`，并将空自选时的 `ta_startmonitor` 通用失败改为明确提示。

## 🙏 鸣谢

- [TickFlow](https://tickflow.org/auth/register?ref=BUJ54JEDGE) 提供行情数据服务与 API 支持
- [OpenClaw](https://openclaw.ai) 提供插件运行、对话通道与工具编排能力
- [CortexReach/memory-lancedb-pro](https://github.com/CortexReach/memory-lancedb-pro) 给你的 OpenClaw Agent 提供持久化、智能化的长期记忆

## 📄 License

MIT
