# TickFlow Assist

基于 [OpenClaw](https://openclaw.ai) 的 A 股监控与分析插件。当前版本已完成核心架构迁移：

- OpenClaw 插件是主入口
- JS/TS 负责主业务流程
- Python 仅保留技术指标计算

发布状态与验证范围见：

- [RELEASE_STATUS.md](/home/x/githubxm/tickflow-assist-beta/RELEASE_STATUS.md)
- [RELEASE_CHECKLIST.md](/home/x/githubxm/tickflow-assist-beta/RELEASE_CHECKLIST.md)

## 功能

- 关注列表管理：添加、查看、删除股票
- TickFlow 日 K 更新：单股抓取、收盘后批量更新
- 技术指标计算：通过 Python 子模块计算并写回 LanceDB
- LLM 分析：输出分析结论、关键价位、技术面评分
- 实时监控：按配置轮询 TickFlow 实时行情
- 告警推送：通过 OpenClaw CLI 投递到 Telegram 等通道
- OpenClaw 内置 Skill：`stock_analysis`

## 推荐目录

正式使用时，推荐把项目源码放在普通项目目录，例如：

```bash
~/projects/tickflow-assist
```

不建议把源码放到 `~/.openclaw/workspace/...` 下面，原因是：

- `workspace` 更适合会话级资源、临时文件、手工 skill
- 插件源码作为独立项目管理更清晰
- `openclaw plugins install -l <path>` 本身就是从任意稳定目录链接安装

## 安装

### 1. 安装依赖并构建

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
  plugins: {
    enabled: true,
    entries: {
      "tickflow-assist": {
        enabled: true,
        config: {
          tickflowApiUrl: "https://api.tickflow.org",
          tickflowApiKey: "your-tickflow-key",
          llmBaseUrl: "https://api.openai.com/v1",
          llmApiKey: "sk-xxx",
          llmModel: "gpt-4o",
          databasePath: "/home/ocuser/projects/tickflow-assist/data/lancedb",
          calendarFile: "/home/ocuser/projects/tickflow-assist/day_future.txt",
          requestInterval: 30,
          alertChannel: "telegram",
          openclawCliBin: "openclaw",
          alertAccount: "",
          alertTarget: "your-target",
          pythonBin: "uv",
          pythonArgs: ["run", "python"],
          pythonWorkdir: "/home/ocuser/projects/tickflow-assist/python"
        }
      }
    }
  }
}
```

说明：

- `tickflowApiKey`、`llmApiKey`、`alertTarget` 正式使用时必须填写
- 插件允许先安装后填配置，所以安装阶段不会因为缺少这些值而失败

### 4. 重启 Gateway

```bash
openclaw gateway restart
```

## `local.config.json` 的作用

`local.config.json` 只用于本地或 VPS 上直接执行：

```bash
npm run tool -- ...
npm run monitor-loop
```

也就是说：

- 正式通过 OpenClaw 插件使用时，不需要依赖 `local.config.json`
- 正式配置以 `~/.openclaw/openclaw.json -> plugins.entries.tickflow-assist.config` 为准

## Skill

内置 Skill 文件：

```text
skills/stock-analysis/SKILL.md
```

Skill key：

```text
stock_analysis
```

这是插件内置 skill，不需要再手动复制到 `~/.openclaw/workspace/skills`。

## 可用工具

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
- `test_alert`

## 正式使用建议

先确认：

```bash
openclaw plugins info tickflow-assist
openclaw plugins doctor
```

然后在对话里直接使用：

- `添加 002261 成本 34.154`
- `分析 002261`
- `开始监控`
- `监控状态`
- `停止监控`

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
