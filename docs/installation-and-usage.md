# TickFlow Assist 安装与使用指南

本文档聚焦安装、配置、调试、通道接入与日常使用。项目概览、功能特点与架构简介请先看 [README](../README.md)。

## 1. 前置条件

开始前请确认目标机器已经具备：

- `git`
- `node` 与 `npm`
- `uv`
- `openclaw`
- 可用的 `TickFlow API Key` [TickFlow获取地址](https://tickflow.org/auth/register?ref=BUJ54JEDGE) Free套餐即可支持`日线K线`、`实时行情`
- 可用的 OpenAI 兼容 `LLM API Key`

如果目标机器还没安装 `uv`，先执行：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## 2. 推荐目录

正式使用时，推荐把项目源码放在普通项目目录，例如：

```bash
~/projects/tickflow-assist
```

不建议把源码放到 `~/.openclaw/workspace/...` 下面，原因是：

- `workspace` 更适合会话级资源、临时文件、手工 skill
- 插件源码作为独立项目管理更清晰
- `openclaw plugins install -l <path>` 本身就是从任意稳定目录链接安装

首次部署建议：

```bash
mkdir -p ~/projects
cd ~/projects
git clone https://github.com/robinspt/tickflow-assist.git
cd tickflow-assist
```

## 3. 安装依赖并构建

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

## 4. 通过 OpenClaw 安装插件

```bash
openclaw plugins install -l /path/to/tickflow-assist
openclaw plugins enable tickflow-assist
```

## 5. 配置插件

正式运行时，插件配置写在：

```text
~/.openclaw/openclaw.json
```

配置路径：

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
          "tickflowApiKeyLevel": "Free",
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
          "alertTarget": "YOUR_TARGET",
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
- `tickflowApiKeyLevel` 用于声明当前 TickFlow Key 权限档位，影响是否尝试分钟K接口

### 配置字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `tickflowApiUrl` | 否 | TickFlow API 地址，默认 `https://api.tickflow.org` |
| `tickflowApiKey` | 是 | TickFlow API Key |
| `tickflowApiKeyLevel` | 否 | TickFlow API Key 档位：`Free`、`Start`、`Pro`、`Expert`，默认 `Free` |
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
- 必须和当前 OpenClaw 通道配置匹配，否则 `test_alert` 虽然执行了，也可能无法投递到目标会话

`tickflowApiKeyLevel` 说明：

- `Pro` 与 `Expert` 才会尝试分钟K接口
- `Free` 与 `Start` 会自动跳过分钟K更新
- 如果历史配置里误写成 `Export`，系统会按 `Expert` 兼容处理
- 即使 `Pro` / `Expert` 下分钟K请求失败，分析任务也不会因此失败，只会退回日线分析

## 6. 重启 Gateway

```bash
openclaw gateway restart
```

## 7. 安装后验收

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

如果 `test_alert` 成功，说明插件、配置和通道投递链路已基本就绪。

## 8. 更新插件

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

如果本次更新涉及 Python 指标侧依赖变化，还应额外执行：

```bash
cd /path/to/tickflow-assist/python
uv sync
cd ..
openclaw gateway restart
```

## 9. 使用方式

### 对话常用指令

| 指令示例 | 功能 |
|---|---|
| `添加 002261 成本 34.154` | 添加股票到关注列表 |
| `查看关注列表` | 查看当前关注股票及成本价 |
| `删除 002202` | 从关注列表删除股票 |
| `更新 002261 数据` | 抓取最新日 K 并重算指标 |
| `获取 002261 1m 分钟K` | 抓取当日分钟 K 并写入数据库 |
| `分析 002261` | 执行 LLM 技术分析，并补充日内走势判断 |
| `查看 002261 上次分析` | 回看最近一次分析结论 |
| `开始监控` | 启动实时监控 |
| `监控状态` | 查看监控状态、行情、关键价位覆盖情况 |
| `TickFlow日更状态` | 查看本插件定时日更后台最近一次执行情况 |
| `停止监控` | 停止监控 |
| `测试告警` | 验证 OpenClaw channel 投递链路 |
| `使用帮助` | 查看插件常用指令与示例 |
| `数据库里有哪些表` | 查看 LanceDB 当前数据表 |
| `看技术指标表结构` | 查看技术指标表字段结构 |
| `查 002261 最近 5 条技术指标` | 查询数据库中的技术指标记录 |

### 命令行直连调试

`npm run tool -- ...` 与 `npm run monitor-loop` 读取的是项目根目录 `local.config.json`，不是 `~/.openclaw/openclaw.json`。

先准备本地调试配置：

```bash
cp local.config.example.json local.config.json
```

再填写其中的 `plugin` 配置，然后执行：

```bash
npm run tool -- test_alert
npm run tool -- add_stock '{"symbol":"002261","costPrice":34.154}'
npm run tool -- fetch_klines '{"symbol":"002261","count":90}'
npm run tool -- fetch_intraday_klines '{"symbol":"002261","period":"1m","count":240}'
npm run tool -- analyze '{"symbol":"002261"}'
npm run tool -- update_all
npm run tool -- start_monitor
npm run tool -- monitor_status
npm run tool -- stop_monitor
```

补充说明：

- `update_all` 在收盘后执行时，会同时更新日K、日线指标和当日 `1m` 分钟K
- `analyze` 会读取本地日K和日线指标，并临时拉取当日全部分钟K、计算分钟指标、获取实时行情，再一起交给模型分析
- 本地 `klines_intraday` 默认仅保留近 10 个交易日，超过部分会自动清理

## 10. 配置 QQBot 通道（可选）

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

注意：

- 当前实现通过 `openclaw message send --target ...` 发送消息
- QQBot 已验证配置建议显式填写 `alertAccount: "default"`
- `alertTarget` 不应留空
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

## 11. 数据与运行说明

### 数据表

| 表名 | 说明 |
|---|---|
| `watchlist` | 关注列表、股票名称、成本价、添加时间 |
| `klines_daily` | 日 K 数据 |
| `klines_intraday` | 分钟 K 数据，包含 `period` 与 `trade_time`，默认仅保留近 10 个交易日 |
| `indicators` | 技术指标结果 |
| `key_levels` | 关键价位与评分 |
| `analysis_log` | 每次分析的文本和结构化结果 |
| `alert_log` | 告警去重与留痕 |

### 实时监控规则

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

运行约束：

- 非交易日不监控
- 交易时段：`09:30-11:30`、`13:00-15:00`
- 收盘后 `update_all` 才允许执行日更
- `monitor_status` 会显示当前运行方式：`plugin_service` 或 `fallback_process`

## 12. 卸载 / 从头测试

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
