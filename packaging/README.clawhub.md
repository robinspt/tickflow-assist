# TickFlow Assist

基于 [OpenClaw](https://openclaw.ai) 的 A 股监控与分析插件。它使用 [TickFlow](https://tickflow.org/auth/register?ref=BUJ54JEDGE) 获取行情与财务数据，结合 LLM 生成技术面、基本面、资讯面的综合判断，并把结果持久化到本地 LanceDB。

最近更新：`v0.2.18` 调整 PNG 告警卡的日内时间轴与午间衔接逻辑，修复测试图与 demo 图的时间展示不一致；同时修正社区版配置字段说明，并补强 npm 打包脚本对包页 README 元数据的处理。

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
如果检测到 `plugins.installs["tickflow-assist"]` 来自 `clawhub`，向导还会把被旧版本钉死的 `spec` 归一化为 `clawhub:tickflow-assist`，避免后续升级继续锁在旧版本。

如果你希望先审阅配置，再只打印最少的后续步骤，可使用：

```bash
npx -y tickflow-assist configure-openclaw --no-enable --no-restart
```

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
- 能力补充：`mxSearchApiKey`

其中，`mxSearchApiKey` 用于 `mx_search`、`mx_select_stock` 以及非 `Expert` 财务链路的 lite 补充；`alertTarget`、`alertAccount` 建议在准备启用 `test_alert`、实时监控告警和定时通知前一并配好，避免配置不完整导致功能缺失。

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
