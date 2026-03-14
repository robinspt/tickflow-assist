# TickFlow Assist 安装指南

本文档聚焦于项目的安装、配置与通道接入。功能与日常使用请参阅 [使用说明](usage.md)。项目概览、功能特点与架构简介请先看 [README](../README.md)。

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

## 5. 配置正式插件

如果你是在 OpenClaw 对话中正式使用 TickFlow Assist，插件配置写在：

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
- 这份配置只供 OpenClaw 插件正式运行使用，不会自动同步到 `local.config.json`
- `npm run tool -- ...`、`npm run monitor-loop`、`npm run daily-update-loop` 不读取这里，而是读取项目根目录 `local.config.json`

### 正式配置与本地调试配置的关系

TickFlow Assist 目前有两条独立配置链路：

- 正式插件链路：读取 `~/.openclaw/openclaw.json`
- 本地调试 / CLI 链路：读取项目根目录 `local.config.json`

它们互不共享，也不会自动同步。

因此应按下面原则处理：

- 如果你只依赖 OpenClaw 插件正式运行，而不使用 `npm run tool -- ...`、`npm run monitor-loop`、`npm run daily-update-loop` 这类本地命令，那么只填写 `~/.openclaw/openclaw.json` 即可。
- 如果你在 VPS 上既会通过 OpenClaw 对话使用插件，也会直接执行项目目录下的 `npm run tool -- ...` 或本地 loop 脚本，那么建议两套配置都填写，并保持关键字段一致。
- 像 `npm run tool -- add_stock '{"symbol":"601872","costPrice":5.32}'` 这样的命令，会读取 `local.config.json.plugin.tickflowApiKey`，不会去读 `~/.openclaw/openclaw.json`

建议至少保持一致的字段：

- `tickflowApiUrl`
- `tickflowApiKey`
- `tickflowApiKeyLevel`
- `llmBaseUrl`
- `llmApiKey`
- `llmModel`
- `databasePath`
- `calendarFile`
- `requestInterval`
- `dailyUpdateNotify`
- `alertChannel`
- `openclawCliBin`
- `alertAccount`
- `alertTarget`
- `pythonBin`
- `pythonArgs`
- `pythonWorkdir`

实践上，最容易引发“明明能用，但状态对不上”的是这几个字段不一致：

- `databasePath`
- `calendarFile`
- `tickflowApiKey`
- `alertTarget`

### 推荐：让股票 Agent 优先走已注册插件工具

如果你希望 OpenClaw 对话优先调用 TickFlow Assist 已注册的插件工具，而不是退回 `exec` 再试错 `npm run tool -- ...`，推荐对负责股票会话的 agent 显式禁用运行时命令工具：

```json5
{
  "agents": {
    "list": [
      {
        "id": "stock",
        "tools": {
          "profile": "full",
          "deny": [
            "exec",
            "bash",
            "process",
            "read",
            "write",
            "edit",
            "apply_patch"
          ]
        }
      }
    ]
  }
}
```

说明：

- 需在你自己的 agent 配置下补充 `tools` 段即可
- `profile: "full"` 可以避免插件工具在某些 OpenClaw 版本/配置组合下被一并裁掉
- 显式禁用 `exec`、`bash`、`process`、`read`、`write`、`edit`、`apply_patch` 后，股票对话更容易稳定落到插件已注册的 `add_stock`、`remove_stock`、`monitor_status` 等工具
- 修改 `~/.openclaw/openclaw.json` 后需要重启 Gateway
- 最好再执行一次 `/new`，避免旧 session 继续沿用之前的工具选择习

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

## 6. 配置 QQBot 通道（可选）

如果你希望通过 QQ 接收告警，需要先在 OpenClaw 中安装并配置 QQBot 通道。详细的通道配置也可以参考 OpenClaw 官方手册。

### 1. 安装 QQBot 插件

```bash
openclaw plugins install @sliverp/qqbot@latest
```

### 2. 配置 OpenClaw QQBot 通道

```bash
openclaw channels add --channel qqbot --token "AppID:AppSecret"
```

### 3. 修改本插件配置

如果你是通过 OpenClaw 对话正式运行插件，在 `~/.openclaw/openclaw.json` 的 `plugins.entries.tickflow-assist.config` 中设置：

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
- 如果你是用 `npm run tool -- test_alert` 做本地调试，需要把同样的字段填写到 `local.config.json.plugin`

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

## 7. 重启 Gateway

```bash
openclaw gateway restart
```

## 8. 安装后验收

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

## 9. 更新插件

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

## 10. 卸载 / 从头测试

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
