# TickFlow Assist 安装指南

本文档聚焦于安装、配置与消息通道接入。功能与日常使用请参阅 [使用说明](usage.md)，项目概览请先看 [README](../README.md)。

## 1. 前置条件

开始前请确认目标机器已经具备：

- `git`
- `node` 与 `npm`
- `uv`
- `openclaw`
- OpenClaw 版本建议 `v2026.3.31` 或更高
- Node 版本建议 `>=22.14.0`，并以目标 OpenClaw 版本上游要求为准
- 可用的 `TickFlow API Key`：[获取地址](https://tickflow.org/auth/register?ref=BUJ54JEDGE)
- 可用的 OpenAI 兼容 `LLM API Key`
- 可选的东方财富妙想 Skills `API Key`：[获取地址](https://marketing.dfcfs.com/views/finskillshub/)

如果目标机器还没安装 `uv`，先执行：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## 2. 一键安装（推荐）

安装、升级、卸载都优先建议使用项目自带向导：

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/robinspt/tickflow-assist/main/setup-tickflow.sh)"
```

向导会自动完成以下工作：

- 拉取或更新源码
- 安装 Node 与 Python 依赖
- 在 Linux 上尝试安装 PNG 告警卡所需的中文字体
- 生成或复用 `local.config.json`
- 写入 `~/.openclaw/openclaw.json` 中的插件配置
- 安装并启用 `tickflow-assist`
- 重启 OpenClaw Gateway

如果你只是日常升级，重新运行同一条命令并在菜单里选择“升级”即可。更具体的升级与重装说明见下文 [7.2 升级](#72-升级) 与 [7.3 禁用重装与清理](#73-禁用重装与清理)。

## 3. 社区安装（适合正式发布包）

如果你不需改动源码，可直接通过 OpenClaw 插件市场或 npm 安装：

```bash
openclaw plugins install tickflow-assist
node ~/.openclaw/extensions/tickflow-assist/dist/dev/tickflow-assist-cli.js configure-openclaw
cd ~/.openclaw/extensions/tickflow-assist/python
uv sync
cd -
openclaw plugins enable tickflow-assist
openclaw config validate
openclaw gateway restart
```

社区安装阶段允许先完成插件安装，再通过 `configure-openclaw` 补写 `tickflowApiKey`、`llmApiKey` 等正式配置。
`configure-openclaw` 会：

- 写入 `plugins.entries["tickflow-assist"].config`
- 给顶层 `tools.allow` 或推断出的目标 Agent 补 `tickflow-assist` allowlist
- 打印后续需要手动执行的命令

它不再自动执行 `uv sync`、`openclaw plugins enable`、`openclaw config validate`、`openclaw gateway restart` 或 Linux 字体安装命令。
如果你已经手动启用插件，或暂时不想重启 Gateway，可追加 `--no-enable` 或 `--no-restart`，让向导不再打印对应步骤。
如果 Python 已经装好，或你暂时不想看到 Python / 字体提示，可追加 `--no-python-setup` 或 `--no-font-setup`。
如果检测到 `plugins.installs["tickflow-assist"]` 的安装来源是 `clawhub`，向导还会把被旧版本钉死的 `spec` 归一化为 `clawhub:tickflow-assist`，避免后续升级继续锁在旧版本。
如果你希望尽量避免把密钥写进 `openclaw.json`，推荐先把 `TICKFLOW_ASSIST_TICKFLOW_API_KEY`、`TICKFLOW_ASSIST_LLM_BASE_URL`、`TICKFLOW_ASSIST_LLM_API_KEY`、`TICKFLOW_ASSIST_LLM_MODEL` 等变量写进 `~/.openclaw/.env`，再运行上面的本地 CLI 去补齐非密钥配置。
如需临时从 npm registry 拉取 CLI，也可以改用 `npx -y tickflow-assist configure-openclaw`；但对已安装的社区插件，默认更建议直接运行扩展目录里的本地 CLI，避免额外下载。

如果你在 Linux 或 macOS 上需要 PNG 告警卡正常显示中文，请额外安装 `fontconfig` 与 Noto CJK 一类中文字体，例如：

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

## 4. 源码安装

### 4.1 拉取源码

推荐把项目放在普通开发目录，不要放到 `~/.openclaw/workspace/...` 下面。

```bash
cd ~
git clone https://github.com/robinspt/tickflow-assist.git
cd tickflow-assist
```

### 4.2 安装依赖并构建

```bash
npm install --include=dev --loglevel=error --no-fund --no-audit
cd python
uv sync
cd ..
npm run check
npm run build
```

这里安装的 `openclaw` npm 包仅用于源码模式下的 plugin SDK 类型检查与本地调试，不会替你安装系统 `openclaw` CLI；正式插件运行仍要求宿主机已先安装 OpenClaw。

### 4.3 安装并启用插件（源码安装）

```bash
openclaw plugins install -l /path/to/tickflow-assist
openclaw plugins enable tickflow-assist
```

## 5. 插件配置

正式插件运行读取：

```text
~/.openclaw/openclaw.json
```

配置路径：

```text
plugins.entries["tickflow-assist"].config
```

最小示例：

```json5
{
  "plugins": {
    "enabled": true,
    "entries": {
      "tickflow-assist": {
        "enabled": true,
        "config": {
          "tickflowApiKey": "your-tickflow-key",
          "mxSearchApiUrl": "https://mkapi2.dfcfs.com/finskillshub/api/claw",
          "mxSearchApiKey": "mkt_xxx",
          "llmBaseUrl": "https://api.openai.com/v1",
          "llmApiKey": "sk-xxx",
          "llmModel": "gpt-4o",
          "databasePath": "/path/to/tickflow-assist/data/lancedb",
          "calendarFile": "/path/to/tickflow-assist/day_future.txt",
          "alertChannel": "telegram",
          "alertTarget": "YOUR_TARGET",
          "jin10FlashNightAlert": false,
          "pythonBin": "uv",
          "pythonArgs": ["run", "python"],
          "pythonWorkdir": "/path/to/tickflow-assist/python"
        }
      }
    }
  }
}
```

如果你还需要使用 `npm run tool -- ...`、`npm run monitor-loop` 或 `npm run daily-update-loop`，则项目根目录还需要有一个 `local.config.json`，并且字段必须写在 `plugin` 下：

```json
{
  "plugin": {
    "tickflowApiKey": "your-tickflow-key",
    "mxSearchApiUrl": "https://mkapi2.dfcfs.com/finskillshub/api/claw",
    "mxSearchApiKey": "mkt_xxx",
    "jin10McpUrl": "https://mcp.jin10.com/mcp",
    "jin10ApiToken": "jin10_xxx",
    "jin10FlashPollInterval": 300,
    "jin10FlashRetentionDays": 7,
    "jin10FlashNightAlert": false,
    "llmBaseUrl": "https://api.openai.com/v1",
    "llmApiKey": "sk-xxx",
    "llmModel": "gpt-4o",
    "databasePath": "./data/lancedb",
    "calendarFile": "./day_future.txt",
    "alertChannel": "telegram",
    "alertTarget": "YOUR_TARGET"
  }
}
```

### 配置字段速查

| 字段 | 必填 | 说明 |
|---|---|---|
| `tickflowApiUrl` | 否 | TickFlow API 地址，默认 `https://api.tickflow.org` |
| `tickflowApiKey` | 是 | TickFlow API Key |
| `tickflowApiKeyLevel` | 否 | `Free` / `Start` / `Pro` / `Expert`；`Pro` 与 `Expert` 会尝试分钟 K |
| `mxSearchApiUrl` | 否 | 妙想 Skills 接口地址 |
| `mxSearchApiKey` | 否 | 启用 `mx_search` / `mx_select_stock`，也用于非 Expert 财务链路的 lite 回退 |
| `jin10McpUrl` | 否 | Jin10 MCP 地址，默认 `https://mcp.jin10.com/mcp` |
| `jin10ApiToken` | 否 | 启用 24 小时 Jin10 快讯监控 |
| `jin10FlashPollInterval` | 否 | Jin10 快讯轮询间隔，默认 `300` 秒 |
| `jin10FlashRetentionDays` | 否 | Jin10 原始快讯本地保留天数，默认 `7` 天 |
| `jin10FlashNightAlert` | 否 | `true`=24小时告警；`false`=22:00~06:00（北京时间）不发送快讯告警（默认） |
| `llmBaseUrl` | 否 | OpenAI 兼容接口地址 |
| `llmApiKey` | 是 | 大模型 API Key；使用本地模型时也不能留空，可填占位值 |
| `llmModel` | 是 | 分析使用的模型名 |
| `databasePath` | 是 | LanceDB 数据目录，建议正式环境用绝对路径 |
| `calendarFile` | 是 | 交易日历文件路径，建议正式环境用绝对路径 |
| `requestInterval` | 否 | 实时监控轮询间隔，默认 `30` 秒 |
| `dailyUpdateNotify` | 否 | 是否发送定时日更与定时复盘通知，默认 `true` |
| `alertChannel` | 是 | 告警通道，如 `telegram`、`qqbot`（QQ机器人）、`wecom`（企业微信）、`weixin`（微信） |
| `openclawCliBin` | 否 | `openclaw` 可执行文件路径，默认 `openclaw` |
| `alertAccount` | 否 | 多账号通道使用；QQBot / WeCom 常见为 `default` |
| `alertTarget` | 是 | 告警投递目标，写法随通道而不同 |
| `pythonBin` | 否 | Python 子模块启动命令，默认 `uv` |
| `pythonArgs` | 否 | Python 子模块命令参数，默认 ["run", "python"] |
| `pythonWorkdir` | 是 | Python 子模块工作目录 |

<details>
<summary>进阶说明：正式配置、本地调试配置与 Agent Tools</summary>

正式插件链路与本地 CLI 链路是两套独立配置：

- OpenClaw 对话读取 `~/.openclaw/openclaw.json`
- `npm run tool -- ...` 与本地 loop 读取 `local.config.json.plugin`
- 它们不会自动同步；如果两边都要用，建议至少保持 `tickflowApiKey`、`llmBaseUrl`、`llmApiKey`、`llmModel`、`databasePath`、`calendarFile`、`alertChannel`、`alertAccount`、`alertTarget` 一致
- `npm run monitor-loop` 会同时驱动价格监控与 Jin10 快讯监控；未配置 `jin10ApiToken` 时，Jin10 监控会保持空转不告警

如果你给股票 Agent 显式配置 `tools`，推荐保留 `profile: "full"`，不要额外禁用 `exec`、`read`、`write` 等运行时能力。

从 `0.2.0` 起，以下 TickFlow Assist agent tools 按 OpenClaw 官方建议以 optional 注册：

- `add_stock`
- `remove_stock`
- `refresh_watchlist_names`
- `refresh_watchlist_profiles`
- `start_monitor`
- `stop_monitor`
- `start_daily_update`
- `stop_daily_update`
- `update_all`
- `test_alert`

如果你给 Agent 配了 `tools.allow`，请把插件 id `tickflow-assist` 或上面的具体工具名加入允许列表；否则这些 optional tools 不会自动出现在对话可调用工具集中。插件 Slash Command 不受这个 allowlist 影响。

多 Agent 场景示例：

```json5
{
  "agents": {
    "list": [
      {
        "id": "stock",
        "tools": {
          "profile": "full",
          "allow": ["tickflow-assist"],
          "deny": []
        }
      }
    ]
  }
}
```

单 Agent 默认模式示例：

```json5
{
  "tools": {
    "profile": "full",
    "allow": ["tickflow-assist"],
    "deny": []
  }
}
```

修改配置后建议执行：

```bash
openclaw config validate
openclaw gateway restart
```

</details>

## 6. 消息通道配置（可选）

TickFlow Assist 当前通过 `openclaw message send` 投递告警，因此前提是目标通道本身已经能在 OpenClaw 中正常工作。

统一接入步骤：

1. 在 OpenClaw 里启用并配置目标通道。
2. 在插件配置里填写 `alertChannel`、`alertAccount`、`alertTarget`。
3. 重启 Gateway。
4. 执行一次 `test_alert` 验证链路。

识别 `alertTarget` 的通用方法：

- 如果目标通道支持 `/whoami`，优先在目标会话里给机器人发送 `/whoami`。
- 直接读取返回的 `User id`、`chatId` 或其它会话标识。
- 再按对应通道的 target 格式写入 `alertTarget`。
- 如果该通道没有 `/whoami`，再查看官方项目说明或插件日志。

通道差异速查：

| 通道 | 官方项目 / 接入方式 | `alertAccount` | `alertTarget` 示例 | 说明 |
|---|---|---|---|---|
| `telegram` | `openclaw channels add --channel telegram` | 通常留空 | `-1001234567890` | 直接使用群组 / 会话 ID |
| `discord` | `openclaw channels add --channel discord` | 通常留空 | `user:1234567890` | 优先在目标会话发送 `/whoami`，读取 `User id`，拼装成 `user:User id` |
| `qqbot`（QQ机器人） | `openclaw channels add --channel qqbot`（OpenClaw `v2026.3.31+` 已内置） | 推荐 `default` | `qqbot:c2c:YOUR_OPENID` | 优先在目标会话发送 `/whoami`，读取 `User id` |
| `wecom`（企业微信） | [@wecom/wecom-openclaw-plugin](https://www.npmjs.com/package/@wecom/wecom-openclaw-plugin) | 常见为 `default` | `YOUR_USER_ID_OR_CHAT_ID` | 优先在目标会话发送 `/whoami`，再区分单聊 `userId` / 群聊 `chatId` |
| `weixin`（微信） | [@tencent-weixin/openclaw-weixin](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin) | 视插件配置 | `YOUR_TARGET` | 预留通道，当前 TickFlow Assist 尚未做专门适配，建议先用 `test_alert` 验证 |

配置示例：

```json5
{
  "alertChannel": "qqbot",
  "alertAccount": "default",
  "alertTarget": "qqbot:c2c:YOUR_OPENID"
}
```

如果你同时使用 `npm run tool -- test_alert` 做本地调试，记得把同样的通道字段也写进 `local.config.json.plugin`。

<details>
<summary>QQBot 补充</summary>

- 在 OpenClaw `v2026.3.31+` 中，QQ Bot 已作为 bundled channel 内置；可直接执行 `openclaw channels add --channel qqbot` 完成接入。
- 完成通道接入后，再回到 TickFlow Assist 填写 `alertChannel: "qqbot"`、`alertAccount: "default"`、`alertTarget: "qqbot:c2c:YOUR_OPENID"`。
- 私聊场景常用 target 格式为 `qqbot:c2c:YOUR_OPENID`。
- target 获取方式沿用上面的通用 `/whoami` 说明；如果当前版本没有该命令，再查看官方说明或插件日志。

</details>

<details>
<summary>WeCom 补充</summary>

官方项目：[@wecom/wecom-openclaw-plugin](https://www.npmjs.com/package/@wecom/wecom-openclaw-plugin)

- 先按官方项目完成安装与通道接入，再回到 TickFlow Assist 填写 `alertChannel: "wecom"`、`alertAccount` 和 `alertTarget`。
- `alertTarget` 单聊填写 `userId`；群聊填写 `chatId`。
- target 获取方式沿用上面的通用 `/whoami` 说明；如果当前版本没有该命令，再查看官方说明。

</details>

<details>
<summary>Weixin 补充</summary>

官方项目：[@tencent-weixin/openclaw-weixin](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin)

- 当前 TickFlow Assist 还没有针对 `weixin` 做专门适配。
- 当前实测中，`@tencent-weixin/openclaw-weixin` 通过 `openclaw message send` 主动发送时仍可能要求额外的 `contextToken`；因此即使已拿到 `alertTarget`，`test_alert`、监控告警、日更通知也仍可能失败。
- 如果出现 `sendWeixinOutbound: contextToken is required`，说明当前版本暂时不适合作为 TickFlow Assist 的后台主动告警通道，建议先仅将微信作为 OpenClaw 对话入口使用，待官方插件后续更新后再启用主动告警推送。
- 建议先执行一次 `test_alert`，确认当前插件版本与目标链路是否兼容。

</details>

## 7. 运维与日常管理

### 7.1 重启与验收

完成安装或修改配置后，建议按下面顺序做一次验收：

```bash
openclaw plugins info tickflow-assist
openclaw plugins doctor
openclaw config validate
openclaw gateway restart
openclaw channels status --probe
```

然后验证告警链路：

```bash
npm run tool -- test_alert
```

或者直接在 OpenClaw 对话里发送“测试告警”。

### 7.2 升级

推荐继续使用安装向导，在菜单里选择“升级”。

从 `v0.1.0` 升到 `v0.2.0` 时，默认也走这条直接升级路径即可；不需要先卸载。

如果你更喜欢手动更新：

```bash
cd /path/to/tickflow-assist
git pull
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

### 7.3 禁用、重装与清理

禁用插件：

```bash
openclaw plugins disable tickflow-assist
openclaw gateway restart
```

如果不再需要插件配置，再从 `~/.openclaw/openclaw.json` 删除：

```text
plugins.entries["tickflow-assist"]
```

重新安装通常只在这两类场景需要：

- 你要更换插件源码目录
- OpenClaw 里残留了旧的同名安装来源，直接升级后仍指向错误路径

确实需要重装时再执行：

```bash
openclaw plugins install -l /path/to/tickflow-assist
openclaw plugins enable tickflow-assist
openclaw gateway restart
```

如果你是为了“从零开始测试”，可按需手动删除 `/path/to/tickflow-assist/data/lancedb`。这只会清空本地数据库，不会删除源码。
