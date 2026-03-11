# AGENTS.md

本文件用于约束后续在 `tickflow-assist-beta` 目录中运行的 Codex/代理行为。

## 项目定位

- 当前目录 `/home/x/githubxm/tickflow-assist-beta` 是本项目的主开发目录。
- 该目录对应 Git `main` 分支，作为当前正式主线维护。
- 旧 Python 版本保存在另一工作目录 `/home/x/githubxm/tickflow_plugin`，对应 `python-legacy` 分支。
- 当前主线架构：
  - OpenClaw 插件是主入口
  - JS/TS 负责主业务流程
  - Python 仅保留技术指标计算

## 工作原则

- 默认在本目录工作，不要把修改落到旧目录 `tickflow_plugin`，除非用户明确要求处理 `python-legacy`。
- 后续用户提到“main 分支”时，默认就是当前目录。
- 优先保持当前插件架构，不要把逻辑重新迁回 Python 外挂模式。
- 除非用户明确要求，不要重建架构、不要大改目录结构、不要引入第二套并行实现。

## 关键目录

- `src/`：主业务代码
- `src/tools/`：OpenClaw tools
- `src/services/`：TickFlow、分析、监控、告警、更新服务
- `src/background/`：监控与日更后台逻辑
- `src/prompts/`：提示词目录
- `src/prompts/analysis/`：分析相关 prompt，按“通用规则 + 分析维度”拆分
- `python/`：Python 指标计算子模块
- `skills/stock-analysis/SKILL.md`：插件内置 skill
- `openclaw.plugin.json`：插件清单
- `README.md`：面向用户的正式文档

## Prompt 结构约定

- 分析相关提示词默认放在 `src/prompts/analysis/` 下维护，不要继续把所有分析 prompt 都堆在单个文件里。
- 结构优先按“通用规则 + 具体分析维度”拆分：
  - 通用 system prompt 放在类似 `common-system-prompt.ts` 的文件中
  - 不同分析任务的数据组织与 user prompt 分别独立建文件，例如 `kline-analysis-user-prompt.ts`
- 如果后续新增资金流、财报、新闻、题材、多因子等分析能力，应优先新增独立 prompt 文件，而不是直接把内容追加到现有日K prompt。
- `src/prompts/analysis/index.ts` 作为统一导出入口；新增分析 prompt 时，优先从这里汇总导出。
- 旧的 `src/prompts/analysis-system-prompt.ts`、`src/prompts/analysis-user-prompt.ts` 可保留为兼容入口，但后续新增能力不要再以它们作为主要扩展点。
- 如果 prompt 变化会影响分析输出结构，修改时同步检查 `src/services/analysis-service.ts` 以及结构化结果解析逻辑是否仍然匹配。

## 分析架构演进约定

- 当前分析架构已进入“第一阶段”：
  - `src/services/analysis-service.ts` 作为通用执行器
  - `src/analysis/tasks/` 放不同分析任务
  - `src/analysis/parsers/` 放不同分析结果解析器
  - 当前只正式落地了日K技术分析任务
- 第一阶段目标是不改数据库结构，先完成分析任务抽象；因此如果只是重构分析流程、prompt 结构、task 分层，默认不要顺手改 LanceDB 表结构。
- 后续进入“第二阶段”时机：
  - 新增了资金流、财报、新闻、题材、多因子等新的分析数据
  - 或新增了与当前 `key_levels` 明显不同的结构化结果
- 第二阶段默认原则：
  - 优先为新分析能力新增独立 task、独立 parser、独立 prompt 文件
  - 只有在结果结构确实不同且现有表不适配时，才新增新的 LanceDB 结果表
  - 不要把新的结构化结果继续硬塞进 `key_levels`
  - 若需要在分析日志中区分任务类型，再考虑扩展 `analysis_log`
- 除非用户明确要求进入第二阶段，否则后续默认只在第一阶段架构内演进，不主动扩表、不预埋第二套数据库结构。

## 配置约定

### 正式运行

- 正式插件运行读取：
  - `~/.openclaw/openclaw.json`
- 插件配置路径：
  - `plugins.entries["tickflow-assist"].config`

### 本地 / VPS 直连调试

- `npm run tool -- ...` 与 `npm run monitor-loop` 读取：
  - 项目根目录 `local.config.json`
- `local.config.json` 必须使用如下结构：

```json
{
  "plugin": {
    "tickflowApiUrl": "...",
    "tickflowApiKey": "...",
    "llmBaseUrl": "...",
    "llmApiKey": "...",
    "llmModel": "...",
    "databasePath": "./data/lancedb",
    "calendarFile": "./day_future.txt",
    "requestInterval": 30,
    "alertChannel": "telegram",
    "openclawCliBin": "openclaw",
    "alertAccount": "",
    "alertTarget": "...",
    "pythonBin": "uv",
    "pythonArgs": ["run", "python"],
    "pythonWorkdir": "./python"
  }
}
```

- 注意：`run-tool.ts` 只读取 `local.config.json.plugin`，不要把字段写在顶层。

## OpenClaw 相关约定

- 插件 ID：`tickflow-assist`
- 内置 skill key：`stock_analysis`
- 当前工具名统一使用 `snake_case`
- 插件已注册服务：
  - `tickflow-assist.realtime-monitor`
  - `tickflow-assist.daily-update`

### 对话输出

- `skills/stock-analysis/SKILL.md` 已要求对关键工具输出尽量原样转发。
- 如果用户反馈 OpenClaw 在对话里擅自改写工具输出，优先检查并更新 `SKILL.md`，不要先改业务逻辑。

## QQBot 约定

- 当前实现通过 `openclaw message send` 发送消息。
- QQBot 已验证配置应显式填写：
  - `alertChannel: "qqbot"`
  - `alertAccount: "default"`
  - `alertTarget: "qqbot:c2c:OPENID"` 或群目标格式
- 不要在代码、README、提交记录中写入真实用户的 OPENID、群 ID、token、API Key。
- 文档与示例中一律使用占位符：
  - `YOUR_OPENID`
  - `YOUR_TARGET`
  - `sk-xxx`
  - `/path/to/tickflow-assist/...`

## 文档约定

- `README.md` 是正式对外文档，应保持中文、面向安装与使用。
- `README.md` 中不要出现：
  - 用户真实用户名路径，如 `/home/ocuser/...`
  - 真实 QQBot OPENID / Telegram 群 ID / token / API Key
- 安装说明中需要保留：
  - `git clone`
  - `npm install`
  - `python/uv sync`
  - `openclaw plugins install -l`
  - `openclaw plugins enable`
  - `openclaw gateway restart`
- 如果补文档，优先保持：
  1. 项目简介
  2. 功能
  3. 安装与配置
  4. 使用方式
  5. 通道配置
  6. 架构/指标/数据库等补充说明

## 测试与验证

如果修改了插件逻辑，优先使用以下命令验证：

```bash
npm run check
npm run build
```

如果修改了 Python 指标桥接，额外验证：

```bash
cd python
uv sync
cd ..
```

如果修改了工具链，可使用：

```bash
npm run tool -- test_alert
npm run tool -- add_stock '{"symbol":"002261","costPrice":34.154}'
npm run tool -- fetch_klines '{"symbol":"002261","count":90}'
npm run tool -- analyze '{"symbol":"002261"}'
npm run tool -- start_monitor
npm run tool -- monitor_status
npm run tool -- stop_monitor
```

## Git 与发布

- 当前目录就是 `main` 工作目录。
- 推送目标默认是 `origin main`。
- 旧 Python 版本在 `python-legacy`，不要误推覆盖。
- 若只是文档或小修复，优先保持提交粒度清晰，不要混入无关变更。

## 禁止事项

- 不要把真实密钥、真实 target、真实 OPENID 写入仓库。
- 不要假设 `local.config.json` 与 `openclaw.json` 是同一套读取路径。
- 不要在没有明确要求的情况下删除用户现有数据目录。
- 不要把已完成的 JS/TS 主线 다시改回 Python 主流程。
