# 📈 TickFlow Assist

基于 [OpenClaw](https://openclaw.ai) 的 A 股监控与分析插件，利用 [TickFlow API](https://tickflow.org/)数据接口获取股票数据。当前版本已完成核心架构迁移：

- OpenClaw 插件是主入口
- JS/TS 负责主业务流程
- Python 仅保留技术指标计算

## ✨ 功能

- 关注列表管理：添加、查看、删除股票
- TickFlow 日 K 更新：单股抓取、收盘后批量更新
- 技术指标计算：通过 Python 子模块计算并写回 LanceDB
- LLM 分析：输出分析结论、关键价位、技术面评分
- 实时监控：按配置轮询 TickFlow 实时行情
- 告警推送：通过 OpenClaw CLI 投递到 Telegram 等通道
- OpenClaw 内置 Skills：
  - `stock_analysis`：股票管理、拉K、分析、监控
  - `usage_help`：返回常用指令与示例
  - `database_query`：查询 LanceDB 表、表结构和记录

## 🧩 支持的 Claw

- 🦞 [OpenClaw](https://openclaw.ai)（已支持）
- 🐈 [Nanobot](https://github.com/HKUDS/nanobot)（待测试）
- 🤖 其他 Claw（待增加）

## 推荐目录

正式使用时，推荐把项目源码放在普通项目目录，例如：

```bash
~/projects/tickflow-assist
```

不建议把源码放到 `~/.openclaw/workspace/...` 下面，原因是：

- `workspace` 更适合会话级资源、临时文件、手工 skill
- 插件源码作为独立项目管理更清晰
- `openclaw plugins install -l <path>` 本身就是从任意稳定目录链接安装

如果你是首次部署，建议先把仓库克隆到该目录：

```bash
mkdir -p ~/projects
cd ~/projects
git clone https://github.com/robinspt/tickflow-assist.git
cd tickflow-assist
```

## 🚀 安装

### 前置条件

开始前请确认目标机器已经具备：

- `git`
- `node` 与 `npm`
- `uv`
- `openclaw`
- 可用的 `TickFlow API Key`
- 可用的 OpenAI 兼容 `LLM API Key`

### 1. 安装依赖并构建

如果目标机器还没安装 `uv`，先执行：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

然后安装依赖并构建：

```bash
cd /path/to/tickflow-assist
npm install
cd python
uv sync
cd ..
npm run check
npm run build
```

说明：

- Node 侧依赖通过 `npm install` 安装
- Python 指标子模块依赖通过 `python/` 目录下的 `uv sync` 安装
- 正式运行时，指标计算默认通过 `uv run python` 调用 `python/indicator_runner.py`

### 2. 通过 OpenClaw 安装插件

```bash
openclaw plugins install -l /path/to/tickflow-assist
openclaw plugins enable tickflow-assist
```

### 3. 在 `openclaw.json` 中填写插件配置

正式使用时，配置应写在：

```text
~/.openclaw/openclaw.json
```

具体路径：

```json5
{
  "plugins": {
    "enabled": true,
    "entries": {
      "tickflow-assist": {
        "enabled": true,
        "config": {
          "tickflowApiUrl": "https://api.tickflow.org",
          "tickflowApiKey": "your-tickflow-key",
          "llmBaseUrl": "https://api.openai.com/v1",
          "llmApiKey": "sk-xxx",
          "llmModel": "gpt-4o",
          "databasePath": "/path/to/tickflow-assist/data/lancedb",
          "calendarFile": "/path/to/tickflow-assist/day_future.txt",
          "requestInterval": 30,
          "dailyUpdateNotify": false,
          "alertChannel": "telegram",
          "openclawCliBin": "openclaw",
          "alertAccount": "",
          "alertTarget": "your-target",
          "pythonBin": "uv",
          "pythonArgs": ["run", "python"],
          "pythonWorkdir": "/path/to/tickflow-assist/python"
        }
      }
    }
  }
}
```

说明：

- `tickflowApiKey`、`llmApiKey`、`alertTarget` 正式使用时必须填写
- 插件允许先安装后填配置，所以安装阶段不会因为缺少这些值而失败

### 3.1 配置字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `tickflowApiUrl` | 否 | TickFlow API 地址，默认 `https://api.tickflow.org` |
| `tickflowApiKey` | 是 | TickFlow API Key |
| `llmBaseUrl` | 否 | OpenAI 兼容接口地址 |
| `llmApiKey` | 是 | 大模型 API Key |
| `llmModel` | 是 | 分析使用的模型名 |
| `databasePath` | 是 | LanceDB 数据目录，建议使用绝对路径 |
| `calendarFile` | 是 | 交易日历文件路径，建议使用绝对路径 |
| `requestInterval` | 否 | 实时监控轮询间隔，默认 `30` 秒 |
| `dailyUpdateNotify` | 否 | 是否发送定时日更通知，默认 `false` |
| `alertChannel` | 是 | 告警通道，例如 `telegram` |
| `openclawCliBin` | 否 | `openclaw` 可执行文件路径，默认 `openclaw` |
| `alertAccount` | 否 | 多账号通道时指定账号，例如 QQBot 常用 `default` |
| `alertTarget` | 是 | 告警投递目标，例如 Telegram 群组/会话 ID、QQBot OPENID |
| `pythonBin` | 否 | Python 子模块启动命令，默认 `uv` |
| `pythonArgs` | 否 | Python 子模块命令参数，默认 `["run", "python"]` |
| `pythonWorkdir` | 是 | Python 子模块工作目录，建议使用绝对路径 |

`alertTarget` 说明：

- 这是 OpenClaw 通道投递目标，不是 TickFlow 配置
- 如果你用 Telegram，通常填写群组或会话 ID
- 如果你用 QQBot，私聊通常填写 `qqbot:c2c:OPENID`
- 必须和你当前 OpenClaw 通道配置匹配，否则 `test_alert` 虽然执行了，也可能无法投递到目标会话
- 最稳妥的做法是先用已知可用的 channel/target 跑通 `test_alert`

### 4. 重启 Gateway

```bash
openclaw gateway restart
```

### 5. 安装后验收

建议按下面顺序做一次验收：

```bash
openclaw plugins info tickflow-assist
openclaw plugins doctor
openclaw gateway restart
```

然后验证告警链路：

- 通过 OpenClaw 对话发送“测试告警”
- 或在项目目录执行：

```bash
npm run tool -- test_alert
```

如果 `test_alert` 成功，说明插件、配置和通道投递链路都已基本就绪

## 🔄 更新插件

如果你是通过本地链接方式安装的：

```bash
openclaw plugins install -l /path/to/tickflow-assist
```

后续代码更新通常不需要重新安装插件，按下面步骤更新即可：

```bash
cd /path/to/tickflow-assist
git pull
npm install
npm run build
openclaw gateway restart
```

说明：

- `-l` 安装是链接安装，OpenClaw 直接使用当前项目目录
- 因此代码更新后，通常只需要拉取最新代码并重新构建
- 插件变更生效前，建议执行一次 `openclaw gateway restart`
- 如果你希望定时日更执行成功或失败时主动收到消息，可把 `dailyUpdateNotify` 设为 `true`
- 如果本次更新涉及 Python 指标侧依赖变化，还应额外执行：

```bash
cd /path/to/tickflow-assist/python
uv sync
cd ..
openclaw gateway restart
```

## 正式使用建议

配置边界说明：

- 正式通过 OpenClaw 插件运行时，读取的是 `~/.openclaw/openclaw.json`
- 本地或 VPS 直接执行 `npm run tool -- ...` 时，读取的是项目根目录下的 `local.config.json`
- 如果要排查“为什么对话里正常、命令行不正常”或相反，优先检查这两个配置文件是否一致

先确认：

```bash
openclaw plugins info tickflow-assist
openclaw plugins doctor
```

然后在对话里直接使用：

| 指令示例 | 功能 |
|---|---|
| `添加 002261 成本 34.154` | 添加股票到关注列表 |
| `查看关注列表` | 查看当前关注股票及成本价 |
| `删除 002202` | 从关注列表删除股票 |
| `更新 002261 数据` | 抓取最新日 K 并重算指标 |
| `分析 002261` | 执行 LLM 技术分析 |
| `查看 002261 上次分析` | 回看最近一次分析结论 |
| `开始监控` | 启动实时监控 |
| `监控状态` | 查看监控状态、行情、关键价位覆盖情况 |
| `日更状态` | 查看定时日更后台最近一次执行情况 |
| `停止监控` | 停止监控 |
| `测试告警` | 验证 OpenClaw channel 投递链路 |
| `使用帮助` | 查看插件常用指令与示例 |
| `数据库里有哪些表` | 查看 LanceDB 当前数据表 |
| `看技术指标表结构` | 查看技术指标表的字段结构 |
| `查 002261 最近 5 条技术指标` | 查询数据库中的技术指标记录 |

## 配置 QQBot 通道（可选）

如果你希望通过 QQ 接收告警，需要先在 OpenClaw 中安装并配置 QQBot 通道。

### 1. 安装 QQBot 插件

```bash
openclaw plugins install @sliverp/qqbot@latest
```

### 2. 配置 OpenClaw QQBot 通道

```bash
openclaw channels add --channel qqbot --token "AppID:AppSecret"
```

### 3. 修改本插件配置

在 `~/.openclaw/openclaw.json` 的 `plugins.entries.tickflow-assist.config` 中设置：

```json5
{
  "alertChannel": "qqbot",
  "openclawCliBin": "openclaw",
  "alertAccount": "default",
  "alertTarget": "qqbot:c2c:YOUR_OPENID"
}
```

说明：

- 当前实现通过 `openclaw message send --target ...` 发送消息
- QQBot 已验证配置建议显式填写 `alertAccount: "default"`
- `alertTarget` 不应留空
- 最稳妥的方式是先在 QQ 上和机器人建立会话，再通过 OpenClaw 日志确认实际 target
- 配置完成后，先执行 `test_alert` 验证链路


### 4. 获取 QQBot 的 OPENID / target

1. 先让目标 QQ 用户给机器人发送一条消息
2. 在服务器上查看日志：

```bash
openclaw logs --follow | grep -Ei 'qqbot|Processing message from|/v2/users/'
```

3. 从类似下面的日志里提取用户标识：

```text
Processing message from YOUR_OPENID: 今天上海的天气如何
POST https://api.sgroup.qq.com/v2/users/YOUR_OPENID/messages
```

4. 把该值拼成：

```text
qqbot:c2c:YOUR_OPENID
```

拿到后，将其填写到：

```json5
"alertTarget": "qqbot:c2c:OPENID"
```

注意：

- 不同机器人下的 OpenID 不能混用
- 如果是群场景，应以 QQBot 实际日志里打印出的 target 格式为准

## Skill 与工具

内置 Skill 文件：

```text
skills/stock-analysis/SKILL.md
skills/usage-help/SKILL.md
skills/database-query/SKILL.md
```

Skill key：

```text
stock_analysis
usage_help
database_query
```

这些都是插件内置 skills，不需要再手动复制到 `~/.openclaw/workspace/skills`。

可用工具：

- `add_stock`
- `remove_stock`
- `list_watchlist`
- `refresh_watchlist_names`
- `fetch_klines`
- `update_all`
- `analyze`
- `view_analysis`
- `start_monitor`
- `stop_monitor`
- `monitor_status`
- `daily_update_status`
- `test_alert`
- `query_database`

常用 skill / 指令示例：

- `使用帮助`
- `添加 002261 成本 34.15`
- `添加 002261 成本 34.15 并获取 120 天日K`
- `分析 002261`
- `日更状态`
- `数据库里有哪些表`
- `看技术指标表结构`
- `查 002261 最近 5 条技术指标`

## ⏰ 实时监控逻辑

### 监控规则

| 规则 | 说明 | 触发条件 |
|---|---|---|
| 止损告警 | 跌破止损位 | `价格 <= 止损位` |
| 止损预警 | 接近止损位 | `价格 <= 止损位 × 1.005` |
| 突破告警 | 突破关键位 | `价格 >= 突破位` |
| 支撑告警 | 接近支撑位 | `价格 <= 支撑位 × 1.005` |
| 压力告警 | 接近压力位 | `价格 >= 压力位 × 0.995` |
| 止盈告警 | 达到止盈位 | `价格 >= 止盈位` |
| 涨跌幅异动 | 单日涨跌幅超阈值 | `绝对涨跌幅 >= 5%` |
| 成交量异动 | 成交量异常放大 | `当前量 >= 5日均量 × 3` |

### 运行约束

- 非交易日不监控
- 交易时段：`09:30-11:30`、`13:00-15:00`
- 收盘后 `update_all` 才允许执行日更
- `monitor_status` 会显示当前运行方式：`plugin_service` 或 `fallback_process`

## 📊 技术指标

当前通过 Python 子模块计算的核心指标包括：

| 类别 | 指标 |
|---|---|
| 均线系统 | `MA5`, `MA10`, `MA20`, `MA60` |
| 趋势指标 | `MACD`, `Signal`, `Histogram`, `ADX`, `+DI`, `-DI` |
| 动量指标 | `RSI6`, `RSI12`, `RSI24`, `KDJ`, `CCI` |
| 波动指标 | `BOLL 上轨/中轨/下轨` |
| 偏离指标 | `BIAS6`, `BIAS12`, `BIAS24` |

## 🗄️ 数据库结构

本项目使用 LanceDB，本地数据默认写入 `data/lancedb/`。

| 表名 | 说明 |
|---|---|
| `watchlist` | 关注列表、股票名称、成本价、添加时间 |
| `klines_daily` | 日 K 数据 |
| `indicators` | 技术指标结果 |
| `key_levels` | 关键价位与评分 |
| `analysis_log` | 每次分析的文本和结构化结果 |
| `alert_log` | 告警去重与留痕 |

## 📁 项目结构

```text
tickflow-assist/
├── openclaw.plugin.json          # OpenClaw 插件清单
├── package.json                  # Node/TS 项目配置
├── tsconfig.json                 # TypeScript 配置
├── day_future.txt                # 交易日历
├── src/
│   ├── plugin.ts                 # 插件入口
│   ├── bootstrap.ts              # 服务与工具装配
│   ├── config/                   # 配置 schema / normalize
│   ├── services/                 # TickFlow / 分析 / 监控 / 更新服务
│   ├── storage/                  # LanceDB 访问层
│   ├── tools/                    # OpenClaw tools
│   ├── background/               # 监控与日更 worker
│   ├── prompts/                  # 分析 prompt
│   ├── runtime/                  # 插件 API 适配
│   ├── types/                    # 领域类型
│   └── utils/                    # 时间、格式、symbol 工具
├── python/
│   ├── indicator_runner.py       # Python 指标桥接入口
│   ├── indicators.py             # 技术指标计算
│   ├── pyproject.toml            # Python 子模块依赖
│   └── requirements.txt          # Python 兼容依赖清单
├── skills/stock-analysis/
│   └── SKILL.md                  # 股票分析与监控 Skill
├── skills/usage-help/
│   └── SKILL.md                  # 使用帮助 Skill
├── skills/database-query/
│   └── SKILL.md                  # 数据库查询 Skill
└── data/
    └── lancedb/                  # 本地数据库目录（运行时生成）
```

## 📋 依赖

- Node.js
- TypeScript
- Python 3.10+
- `uv`
- TickFlow API Key
- OpenAI 兼容 LLM API
- OpenClaw
- qqbot 插件（可选）

## 本地/服务器直连调试

如果你不是通过 Gateway 对话，而是想直接在命令行调试：

```bash
cp local.config.example.json local.config.json
```

再填写里面的 `plugin` 配置，然后执行：

```bash
npm run tool -- test_alert
npm run tool -- add_stock '{"symbol":"002261","costPrice":34.154}'
npm run tool -- fetch_klines '{"symbol":"002261","count":90}'
npm run tool -- analyze '{"symbol":"002261"}'
npm run tool -- start_monitor
npm run tool -- monitor_status
npm run tool -- stop_monitor
```

`npm run monitor-loop` 仅用于非 Gateway 场景下的 fallback 验证，不是正式主路径。

## 卸载 / 从头测试

本地文档里目前确认可用、且符合官方文档的操作是：

### 1. 禁用插件

```bash
openclaw plugins disable tickflow-assist
```

### 2. 从 `openclaw.json` 删除插件配置

删除：

```json5
plugins.entries["tickflow-assist"]
```

### 3. 重启 Gateway

```bash
openclaw gateway restart
```

### 4. 如需重新安装

```bash
openclaw plugins install -l /path/to/tickflow-assist
openclaw plugins enable tickflow-assist
openclaw gateway restart
```

如果你想连数据也一起清空，再手动删除项目目录下的数据文件，例如：

```bash
rm -rf /path/to/tickflow-assist/data/lancedb
```

这个动作会删除本地数据库内容，不会删除源码。

## 🙏 鸣谢

- [TickFlow](https://tickflow.org) 提供行情数据服务与 API 支持
- [tickflow-org/tickflow](https://github.com/tickflow-org/tickflow)
- [OpenClaw](https://openclaw.ai) 提供插件运行、对话通道与工具编排能力
- [qqbot](https://github.com/sliverp/qqbot) 提供qq机器人通道接入

## 📄 License

MIT
