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
- 可选的东方财富妙想 Skills `API Key` [获取地址](https://marketing.dfcfs.com/views/finskillshub/) ，用于 `mx_search` / `mx_select_stock`；当前每个技能每日限额 `50` 次

如果目标机器还没安装 `uv`，先执行：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## 2. 一键安装向导（推荐）

为了简化部署，我们提供了一个交互式的安装向导 `setup-tickflow.sh`。它可以自动探测环境、安装依赖、并在交互中收集您的配置。

执行以下命令即可启动一键安装：

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/robinspt/tickflow-assist/main/setup-tickflow.sh)"
```

向导会提示您输入 TickFlow / 妙想 Skills / LLM 的 API Key，以及消息通道目标等信息，生成配置并自动重启 OpenClaw Gateway。
如果目标目录里已经存在 `local.config.json`，向导会优先沿用其中已有的本地调试配置，避免重复安装时把现有参数覆盖回默认值。
如果完成向导，你可以跳至 **第 8 步 安装后验收**。

---

如果因为某些原因你想手动部署（或升级过程中需知悉具体步骤），请参考下方的详细指引：

## 2.1 推荐目录（手动步骤）

正式使用时，推荐把项目源码放在普通项目目录，例如：

```bash
~/tickflow-assist
```

不建议把源码放到 `~/.openclaw/workspace/...` 下面，原因是：

- `workspace` 更适合会话级资源、临时文件、手工 skill
- 插件源码作为独立项目管理更清晰
- `openclaw plugins install -l <path>` 本身就是从任意稳定目录链接安装

首次部署建议：

```bash
cd ~
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
          "mxSearchApiUrl": "https://mkapi2.dfcfs.com/finskillshub/api/claw",
          "mxSearchApiKey": "mkt_xxx",
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

- `tickflowApiKey`、`llmApiKey`、`alertTarget` 正式使用时必须填写（注意：使用 Ollama、vLLM 等本地部署模型时，`llmApiKey` 字段也不能为空缺，配置校验要求该字段必须存在。可填入任意占位字符，例如 `sk-xxx` 或 `ollama`）
- `mxSearchApiKey` 为可选项；如果需要使用 `mx_search` / `mx_select_stock`，请到东方财富妙想 Skills 页面获取并填写。当前每个技能每日限额 `50` 次
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

### 推荐：为股票 Agent 保持 `profile: "full"`

如果你希望给负责股票会话的 agent 显式写一份 `tools` 配置，推荐保留 `profile: "full"`，但不要再禁用 `exec`、`read`、`write` 等运行时工具，避免影响 OpenClaw 其他能力：

```json5
{
  "agents": {
    "list": [
      {
        "id": "stock",
        "tools": {
          "profile": "full",
          "deny": []
        }
      }
    ]
  }
}
```

如果你的 OpenClaw 目前没有 `agents.list`，而是单 Agent 默认模式，应写到顶层 `tools`：

```json5
{
  "tools": {
    "profile": "full",
    "deny": []
  }
}
```

不要写成下面这种形式，因为 OpenClaw 会报配置无效：

```json5
{
  "agents": {
    "defaults": {
      "tools": {
        "profile": "full"
      }
    }
  }
}
```

说明：

- 多 Agent 场景补到对应的 `agents.list[].tools`；单 Agent 默认模式补到顶层 `tools`
- `profile: "full"` 可以避免插件工具在某些 OpenClaw 版本/配置组合下被一并裁掉
- `deny: []` 表示不额外限制 `exec`、`bash`、`process`、`read`、`write`、`edit`、`apply_patch` 等能力，避免影响 OpenClaw 其他功能
- 如果你之前已经按旧文档加入了那组 `deny`，建议手动删掉或改成空数组
- 修改 `~/.openclaw/openclaw.json` 后需要重启 Gateway
- 最好再执行一次 `/new`，避免旧 session 继续沿用之前的工具选择习

### 配置字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `tickflowApiUrl` | 否 | TickFlow API 地址，默认 `https://api.tickflow.org` |
| `tickflowApiKey` | 是 | TickFlow API Key |
| `tickflowApiKeyLevel` | 否 | TickFlow API Key 档位：`Free`、`Start`、`Pro`、`Expert`，默认 `Free` |
| `mxSearchApiUrl` | 否 | 东方财富妙想 Skills 接口基础地址，默认 `https://mkapi2.dfcfs.com/finskillshub/api/claw` |
| `mxSearchApiKey` | 否 | 东方财富妙想 Skills API Key；用于 `mx_search` / `mx_select_stock`，当前每个技能每日限额 `50` 次 |
| `llmBaseUrl` | 否 | OpenAI 兼容接口地址 |
| `llmApiKey` | 是 | 大模型 API Key（使用Ollama/vLLM等本地模型时不能留空，请填入任意占位字符如 `sk-xxx`） |
| `llmModel` | 是 | 分析使用的模型名 |
| `databasePath` | 是 | LanceDB 数据目录，建议使用绝对路径 |
| `calendarFile` | 是 | 交易日历文件路径，建议使用绝对路径 |
| `requestInterval` | 否 | 实时监控轮询间隔，默认 `30` 秒 |
| `dailyUpdateNotify` | 否 | 是否发送定时日更通知，默认 `false` |
| `alertChannel` | 是 | 告警通道，例如 `telegram`、`qqbot`、`wecom` |
| `openclawCliBin` | 否 | `openclaw` 可执行文件路径，默认 `openclaw` |
| `alertAccount` | 否 | 多账号通道时指定账号，例如 QQBot / WeCom 常用 `default` |
| `alertTarget` | 是 | 告警投递目标，例如 Telegram 群组/会话 ID、QQBot OPENID、WeCom 的 `userId` 或 `chatId` |
| `pythonBin` | 否 | Python 子模块启动命令，默认 `uv` |
| `pythonArgs` | 否 | Python 子模块命令参数，默认 `["run", "python"]` |
| `pythonWorkdir` | 是 | Python 子模块工作目录，建议使用绝对路径 |

`alertTarget` 说明：

- 这是 OpenClaw 通道投递目标，不是 TickFlow 配置
- 如果你用 Telegram，通常填写群组或会话 ID
- 如果你用 QQBot，私聊通常填写 `qqbot:c2c:OPENID`
- 如果你用 WeCom，单聊填写 `userId`；群聊填写 `chatId`
- WeCom 群聊场景下，直接填写群 ID 也可被识别
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

5. 一键获取方式
在QQ上给机器人发送一条消息 `/whoami` 会返回：

```
🧭 Identity
Channel: qqbot
User id: **********************
AllowFrom: **********************
```
`**********************` 即所需YOUR_OPENID，拼成 `qqbot:c2c:**********************` 即可


## 7. 配置 WeCom 通道（可选）

如果你希望通过企业微信接收告警，需要先在 OpenClaw 中安装并配置官方 WeCom 通道插件。

官方插件仓库：

- [WecomTeam/wecom-openclaw-plugin](https://github.com/WecomTeam/wecom-openclaw-plugin)

### 1. 安装 WeCom 插件

```bash
openclaw plugins install @wecom/wecom-openclaw-plugin@latest
```

官方 README 还提供了交互式安装器；如果你的 OpenClaw 版本较新，也可以按官方说明执行：

```bash
npx -y @wecom/wecom-openclaw-cli install
```

### 2. 配置 OpenClaw WeCom 通道

推荐直接按官方插件 README 走交互式配置：

```bash
openclaw channels add
```

然后选择 `wecom`，填写企业微信应用对应的 `botId`、`secret` 等字段。

### 3. 修改本插件配置

如果你是通过 OpenClaw 对话正式运行插件，在 `~/.openclaw/openclaw.json` 的 `plugins.entries.tickflow-assist.config` 中设置：

```json5
{
  "alertChannel": "wecom",
  "openclawCliBin": "openclaw",
  "alertAccount": "default",
  "alertTarget": "YOUR_USER_ID_OR_CHAT_ID"
}
```

注意：

- 当前实现通过 `openclaw message send --target ...` 发送消息
- WeCom 官方插件支持主动消息投递，因此 `test_alert` 与监控告警可直接复用
- 如果你的 WeCom 账号名不是 `default`，请把 `alertAccount` 改成实际账号名
- `alertTarget` 单聊应填写 `userId`；群聊应填写 `chatId`
- 群聊场景下，直接填写群 ID 也可识别
- 如果你是用 `npm run tool -- test_alert` 做本地调试，需要把同样的字段填写到 `local.config.json.plugin`

## 8. 重启 Gateway

```bash
openclaw gateway restart
```

## 9. 安装后验收

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

## 10. 更新插件

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

## 11. 卸载 / 从头测试

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
