# 📈 TickFlow 股票分析插件

基于 [OpenClaw](https://openclaw.ai) 的 A 股实时分析插件，通过 [TickFlow](https://tickflow.org) API 获取行情数据，结合 LLM 进行技术分析，自动监控关键价位并推送告警。

## ✨ 功能特性

- 🔍 **对话式交互** — 通过 OpenClaw 对话输入股票代码和成本价
- 📊 **日K线获取** — 自动从 TickFlow 批量接口获取前复权日K数据，交易时段内自动剔除当日未完成数据
- 🧮 **技术指标计算** — MA / MACD / KDJ / RSI / CCI / BIAS / DMI / BOLL 等全套指标
- 🤖 **LLM 智能分析** — 调用大模型分析K线形态和指标共振，输出 9 个关键价位 + 评分
- ⏰ **实时监控** — 按配置间隔（默认 30 秒）获取实时行情，对比关键价位按规则推送告警
- 📅 **交易日历** — 内置交易日历，统一的时间约束判断（交易时段 / 收盘后 / 日更新窗口）
- 💾 **LanceDB 存储** — 轻量级向量数据库，无需额外部署
- ✅ **A 股代码强校验** — 入口统一校验交易所后缀、代码前缀，仅允许股票（不含指数/可转债）
- 🔄 **全量滚动更新** — 每次收盘后重新拉取最近 N 天 K 线并整股覆盖，自动处理除权除息
- 🕐 **内建定时任务** — 一键注册 crontab，自动管理收盘更新和实时监控
- 🔒 **监控单实例锁** — PID 锁文件机制，cron 重复触发时不会叠加多个监控进程

## 🧩 支持的 Claw

- 🦞[OpenClaw](https://openclaw.ai)（已支持）
- 🐈[Nanobot](https://github.com/HKUDS/nanobot)（待测试）
- 其他 Claw（待增加）

## 📁 项目结构

```
tickflow-assist/
├── config.yaml                    # 配置文件
├── pyproject.toml                 # uv / 项目依赖配置
├── requirements.txt               # Python 依赖
├── day_future.txt                 # 交易日历（至2026年底）
├── src/                           # 核心模块
│   ├── config.py                  # 配置加载
│   ├── validators.py              # A 股代码校验
│   ├── calendar.py                # 交易日历 + 统一时间约束
│   ├── tickflow_api.py            # TickFlow HTTP API 客户端（批量 K 线 + 适配层）
│   ├── db.py                      # LanceDB 数据库操作
│   ├── indicators.py              # 技术指标计算
│   ├── analyzer.py                # LLM 分析引擎（fail-close + 输出分离）
│   ├── alert.py                   # 告警发送
│   ├── monitor.py                 # 实时监控引擎（含 PID 单实例锁）
│   └── scheduler.py               # 定时任务管理（crontab）
├── scripts/                       # CLI 入口脚本
│   ├── add_stock.py               # 添加关注股票
│   ├── list_watchlist.py          # 查看当前关注列表
│   ├── remove_stock.py            # 删除关注股票 + 清除数据
│   ├── test_alert.py              # 发送测试告警验证 channel
│   ├── fetch_klines.py            # 获取K线 + 计算指标（单股）
│   ├── update_all.py              # 收盘后批量全量更新
│   ├── analyze.py                 # LLM 技术分析
│   ├── view_analysis.py           # 查看最近一次分析结果
│   ├── start_monitor.py           # 启动实时监控并输出摘要
│   ├── realtime_monitor.py        # 实时监控主循环
│   ├── monitor_status.py          # 查看监控运行状态
│   ├── stop_monitor.py            # 停止实时监控
│   └── init_scheduler.py          # 注册/管理定时任务
└── skills/stock-analysis/
    └── SKILL.md                   # OpenClaw Skill 定义
```

## 🚀 快速开始

### 1. 安装依赖

```bash
cd tickflow-assist
uv sync
```

如果目标机器还没安装 `uv`，可先执行：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

如果你只想保留现有 `requirements.txt` 工作流，也可以：

```bash
uv pip install -r requirements.txt
```

不建议在 Debian / Ubuntu 系统 Python 上直接执行 `pip install -r requirements.txt`，因为较新的发行版默认启用了 PEP 668，会报 `externally-managed-environment`。

### 2. 配置

编辑 `config.yaml`，填入以下必要信息：

```yaml
# LLM 配置（兼容 OpenAI API）
llm:
  base_url: "https://your-llm-api.com/v1"
  api_key: "sk-xxx"
  model: "gpt-4o"

# TickFlow 配置（访问 tickflow.org 登录后，在控制台一键生成你的 API Key）
tickflow:
  api_url: "https://api.tickflow.org"
  api_key: "your-tickflow-api-key"

# 告警配置
alert:
  openclaw_cli_bin: "openclaw"     # 可选，默认直接调用系统里的 openclaw
  channel: "telegram"              # 支持 telegram / discord / slack / qqbot 等
  account: ""                      # 多账号时指定 accountId（如 QQBot 多机器人）
  target: ""                       # 通道目标 ID（QQBot 可不填）
```

敏感配置默认推荐直接写在 `config.yaml`。如果你更希望把密钥放到环境变量里，也可以覆盖，此时 `config.yaml` 里的 `llm.api_key` / `tickflow.api_key` 可留空。

```bash
export LLM_API_KEY="sk-xxx"
export TICKFLOW_API_KEY="your-key"
```

### 3. 注册定时任务

```bash
# 一键注册 crontab 定时任务（收盘更新 + 实时监控）
uv run python scripts/init_scheduler.py

# 查看已注册的任务
uv run python scripts/init_scheduler.py --list

# 移除所有定时任务
uv run python scripts/init_scheduler.py --remove
```

注册后将自动创建两条 crontab 任务：

| 任务 | 时间 | 说明 |
|------|------|------|
| `daily_update` | 周一至周五 15:35 | 收盘后全量更新 K 线和指标（单次执行后退出） |
| `realtime_monitor` | 周一至周五 09:25 | 启动实时监控（常驻进程，内置 PID 锁防重复启动） |

### 4. 加载 OpenClaw Skill

```bash
cd /path/to/tickflow-assist
echo "export TICKFLOW_ASSIST_ROOT=$(pwd)" >> ~/.bashrc
export TICKFLOW_ASSIST_ROOT=$(pwd)
mkdir -p ~/.openclaw/workspace/skills
cp -r $(pwd)/skills/stock-analysis ~/.openclaw/workspace/skills/stock-analysis
```

默认推荐上面的持久化写法，这样重启机器或重新登录后仍然生效。

如果 OpenClaw Gateway 是通过 systemd、supervisor 或容器启动的，则要把 `TICKFLOW_ASSIST_ROOT` 配到对应服务的环境变量里，而不是只配在交互式 shell 中。

重启 Gateway 使 Skill 生效：

```bash
openclaw gateway restart
```

### 5. 配置 QQBot 通道（可选）

如果希望通过 QQ 接收告警，需要先在 OpenClaw 中安装 QQBot 插件。

#### 5.1 创建 QQ 机器人

1. 前往 [QQ 开放平台](https://q.qq.com/) 扫码登录（手机 QQ 扫码即可自动注册）
2. 点击「创建机器人」，在机器人页面找到 **AppID** 和 **AppSecret** 并保存


#### 5.2 安装 QQBot 插件

```bash
# 推荐：通过 OpenClaw CLI 安装
openclaw plugins install @sliverp/qqbot@latest
```

#### 5.3 配置 OpenClaw

**CLI 向导（推荐）**

```bash
openclaw channels add --channel qqbot --token "AppID:AppSecret"
```

#### 5.4 配置告警通道

在本项目的 `config.yaml` 中，将告警通道切换为 QQBot：

```yaml
alert:
  channel: "qqbot"
  # target 可选，留空则投递到主私聊会话（最近一次与 bot 私聊的用户）
  # 如需指定用户: target: "qqbot:c2c:OPENID"
```

> ℹ️ 如需指定 target，OpenID 可通过先在 QQ 上向机器人发送消息，然后 `openclaw logs --follow` 查看日志获取。**不同机器人的 OpenID 不通用**。

#### 5.5 重启 Gateway

```bash
openclaw gateway restart
```

在 QQ 中找到你的机器人，发送一条消息测试即可！

## 💬 使用方式

### 通过 OpenClaw 对话

在任意已绑定的通道（Telegram、QQ 等）中与 OpenClaw 对话：

> 对 OpenClaw 的要求（对话发送一次让它记住）：调用 `stock-analysis` 技能后，应尽量完整保留脚本原始输出，不要擅自删减关键字段、合并多行、改写数值、补充主观总结或只返回简化版结果。除非脚本本身报错，否则优先直接转发脚本输出。

| 指令示例 | 功能 |
|---|---|
| `添加 600000.SH 成本 10.5` | 添加股票到关注列表 |
| `查看关注列表` | 查看当前已关注股票及成本价 |
| `删除 600000.SH` | 从关注列表移除并清除数据 |
| `删除 600000.SH 保留数据` | 从关注列表移除，但保留已抓取数据 |
| `测试告警` | 发送一条测试消息，验证告警 channel 是否可用 |
| `更新 600000.SH 数据` | 获取最新日K线并计算指标 |
| `分析 600000.SH` | 获取数据 + LLM 分析 + 输出关键价位 |
| `查看 600000.SH 上次分析` | 回看最近一次分析结论和关键价位 |
| `开始监控` | 启动实时行情监控 |
| `监控状态` / `看看监控` | 查看监控进程、交易时段、今日告警等运行状态 |
| `停止监控` / `关闭监控` | 优雅停止实时监控进程 |

### 通过命令行

```bash
# 添加关注（含 A 股代码校验，非法代码会被拒绝）
uv run python scripts/add_stock.py --symbol 600000.SH --cost 10.5

# 查看当前关注列表
uv run python scripts/list_watchlist.py

# 删除关注（同时清除关联数据）
uv run python scripts/remove_stock.py --symbol 600000.SH

# 删除关注（保留 K 线和指标数据）
uv run python scripts/remove_stock.py --symbol 600000.SH --keep-data

# 发送测试告警，验证 channel 投递链路
uv run python scripts/test_alert.py

# 获取K线 + 计算指标（单股）
uv run python scripts/fetch_klines.py --symbol 600000.SH --days 90

# 收盘后全量更新所有关注股票（需 15:30 后执行，自动处理除权除息）
uv run python scripts/update_all.py

# 强制更新（跳过时间检查）
uv run python scripts/update_all.py --force

# LLM 分析（输出简洁结论 + 关键价位表格）
uv run python scripts/analyze.py --symbol 600000.SH

# 查看最近一次分析结果
uv run python scripts/view_analysis.py --symbol 600000.SH

# 启动实时监控（按配置输出实际轮询间隔）
uv run python scripts/start_monitor.py

# 查看监控运行状态
uv run python scripts/monitor_status.py

# 停止实时监控（优雅退出）
uv run python scripts/stop_monitor.py

# 强制停止实时监控
uv run python scripts/stop_monitor.py --force
```

## ⏰ 实时监控

启动/停止监控时会主动向当前告警通道发送生命周期通知。这样即使当天没有触发价格类告警，也能确认 channel 投递链路仍然可用。启动通知会包含当前交易时段状态、轮询间隔、监控标的和最新行情快照。

### 监控规则

| 规则 | 说明 | 触发条件 |
|---|---|---|
| ⛔ 止损告警 | 触及或跌破止损位 | `价格 ≤ 止损位` |
| ⚠️ 止损预警 | 接近止损位 | `价格 ≤ 止损位 × 1.005` |
| 🚀 突破告警 | 突破关键压力位 | `价格 ≥ 突破位` |
| 📉 支撑告警 | 触及支撑位 | `价格 ≤ 支撑位 × 1.005` |
| 📈 压力告警 | 接近压力位 | `价格 ≥ 压力位 × 0.995` |
| 💰 止盈告警 | 触及止盈位 | `价格 ≥ 止盈位` |
| 📊 涨跌幅异动 | 当日涨跌幅超阈值 | `涨跌幅 ≥ 5%`（涨跌均触发） |
| 📈 成交量异动 | 成交量异常放大 | `当前量 ≥ 5日均量 × 3` |

> 每条规则在同一交易时段内仅触发一次（上午盘/下午盘各自独立），避免重复告警。

### 时间约束

所有涉及行情拉取和入库的模块共用 `calendar.py` 中的统一时间判断函数：

| 函数 | 说明 |
|------|------|
| `is_trading_day()` | 是否交易日 |
| `is_trading_time()` | 是否在交易时段内（交易日 + 09:30-11:30 / 13:00-15:00） |
| `is_after_market_close()` | 当天是否已收盘（交易日 + ≥ 15:00） |
| `can_run_daily_update(force)` | 能否执行收盘更新（交易日 + ≥ 15:30，`--force` 跳过） |

## 🤖 LLM 分析

### 输出格式

分析结果对用户展示为简洁结论 + 关键价位表格，不包含原始 JSON：

```
该股短期均线多头排列，MACD 金叉放量，RSI 处于中性偏强区域。
建议关注 11.20 突破位，若放量站上可加仓。支撑位 10.00 为防守线，
跌破 9.80 止损位应果断离场。

📊 关键价位汇总:
---------------------------------------------
  当前价格: 10.50
  止损位: 9.80
  突破位: 11.20
  支撑位: 10.00
  成本位: 10.30
  压力位: 11.00
  止盈位: 12.50
  缺口位: 暂无
  目标位: 13.00
  整数关: 11.00

  技术面评分: 6/10
---------------------------------------------
```

### Fail-Close 机制

- 结构化解析成功且校验通过 → 关键价位写入 `key_levels` 表
- 结构化解析失败或校验失败 → **不覆盖**已有有效价位，仅写入 `analysis_log` 表留痕
- `current_price` 必须 > 0，`score` 必须 1-10，所有价位 ≥ 0

## 📊 技术指标

基于 [ta](https://github.com/bukosabino/ta) 库计算：

| 类别 | 指标 |
|---|---|
| 均线系统 | MA5, MA10, MA20, MA60 |
| 趋势指标 | MACD (DIF/DEA/柱状), DMI (+DI/-DI/ADX) |
| 动量指标 | KDJ (K/D/J), RSI (6/12/24), CCI (14) |
| 偏离指标 | BIAS (6/12/24) |
| 波动指标 | 布林带 (上轨/中轨/下轨) |

## 🗄️ 数据库

使用 [LanceDB](https://lancedb.com/) 轻量级嵌入式数据库，数据存储在 `data/lancedb/` 目录下。

| 表名 | 说明 |
|---|---|
| `watchlist` | 关注列表（股票代码、股票名称、成本价、添加时间） |
| `klines_daily` | 日K线数据（按股票维度全量替换，滚动窗口） |
| `indicators` | 技术指标数据（全量重算覆盖） |
| `key_levels` | 关键价位（仅存储校验通过的有效数据） |
| `analysis_log` | 分析日志（记录每次 LLM 分析结果，支持后续回看最近一次分析） |
| `alert_log` | 告警日志（用于去重） |

## ✅ A 股代码校验

本插件仅支持 A 股**股票**，不支持指数和可转债。所有入口统一调用 `validate_a_share_symbol()` 校验：

| 交易所 | 允许前缀 | 示例 |
|--------|---------|------|
| SH (上交所) | 60x (主板), 68x (科创板) | 600000.SH, 688001.SH |
| SZ (深交所) | 00x (主板), 30x (创业板) | 000001.SZ, 300001.SZ |
| BJ (北交所) | 8x, 4x | 830001.BJ, 430001.BJ |

非法代码（如指数 `000001.SH`、可转债 `128001.SZ`、无效 `999999.XX`）在入口处直接拒绝。

## ⚙️ 配置项说明

| 配置项 | 说明 | 默认值 |
|---|---|---|
| `llm.base_url` | LLM API 地址 | `https://api.openai.com/v1` |
| `llm.model` | 模型名称 | `gpt-4o` |
| `llm.temperature` | 生成温度 | `0.3` |
| `tickflow.api_url` | TickFlow API 根地址（不含版本号） | `https://api.tickflow.org` |
| `tickflow.request_interval` | 实时行情请求间隔（秒） | `30` |
| `kline.days` | 默认获取K线天数 | `90` |
| `kline.adjust` | 复权类型 | `forward` |
| `alert.openclaw_cli_bin` | OpenClaw CLI 可执行文件名或路径 | `openclaw` |
| `alert.channel` | 告警通道 | `telegram` |
| `alert.account` | 多账号时指定 accountId | `""` |
| `alert.target` | 通道目标 ID（不同 channel 格式不同） | `""` |
| `alert_rules.stop_loss_buffer` | 止损预警缓冲 | `0.005` (0.5%) |
| `alert_rules.change_pct_threshold` | 涨跌幅异动阈值 | `0.05` (5%) |
| `alert_rules.volume_ratio_threshold` | 成交量异动倍数 | `3.0` |

## 📋 依赖

- Python ≥ 3.10
- [TickFlow API Key](https://tickflow.org)
- OpenAI 兼容的 LLM API
- [OpenClaw](https://openclaw.ai)（用于对话交互和告警推送）

## 🙏 鸣谢

- [TickFlow](https://tickflow.org) 提供行情数据服务与 API 支持。[项目地址](https://github.com/tickflow-org/tickflow)

## 📄 License

MIT
