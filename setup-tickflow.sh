#!/usr/bin/env bash
# ============================================================
# TickFlow Assist 一键安装脚本
# 参考了 CortexReach memory 安装脚本交互设计
# ============================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC}   $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()    { echo -e "${RED}[ERR]${NC}  $1"; exit 1; }
dry()     { echo -e "${YELLOW}[DRY-RUN]${NC} 将会执行 / Would run: $1"; }

DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
  esac
  shift
done

echo ""
echo -e "${BOLD}========================================${NC}"
echo -e "${BOLD}  TickFlow Assist 安装/升级向导${NC}"
echo -e "${BOLD}========================================${NC}"
echo ""

# 1. 环境检查
info "第 1 步：环境检查 / Environment check..."

if ! command -v node &>/dev/null; then fail "找不到 node / Node.js not found. 请先安装 Node.js"; fi
if ! command -v npm &>/dev/null; then fail "找不到 npm / npm not found."; fi
if ! command -v openclaw &>/dev/null; then fail "找不到 openclaw / openclaw not found. 请先安装 OpenClaw"; fi

if ! command -v jq &>/dev/null; then
  warn "未安装 jq。请先安装 jq：brew install jq 或 apt install jq"
  fail "需要 jq 来安全修改 openclaw.json"
fi

if ! command -v uv &>/dev/null; then
  warn "找不到 uv / uv not found."
  read -p "  要自动安装 uv 吗？/ Auto-install uv? (y/n) [y]: " INSTALL_UV
  if [[ "${INSTALL_UV:-y}" =~ ^[yY]$ ]]; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.cargo/bin:$PATH"
    if ! command -v uv &>/dev/null; then fail "uv 安装失败或未在 PATH 中，请重新打开终端并重试。"; fi
    success "uv 安装完成"
  else
    fail "请先手动安装 uv"
  fi
fi

# 2. 确认安装目录
echo ""
info "第 2 步：确认目录 / Confirm directory..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/openclaw.plugin.json" && -d "$SCRIPT_DIR/src" ]]; then
  PLUGIN_DIR="$SCRIPT_DIR"
  info "当前在插件源码目录下：$PLUGIN_DIR"
else
  DEFAULT_DIR="$HOME/projects/tickflow-assist"
  read -p "  请输入安装目录 [默认: $DEFAULT_DIR]: " INPUT_DIR
  PLUGIN_DIR="${INPUT_DIR:-$DEFAULT_DIR}"
fi

# 下载/更新源码
if [[ -d "$PLUGIN_DIR/.git" ]]; then
  info "目录已存在，拉取最新代码 / Updating git repo..."
  if $DRY_RUN; then
    dry "git -C \"$PLUGIN_DIR\" pull origin main"
  else
    git -C "$PLUGIN_DIR" pull origin main 2>&1 || warn "git pull 失败，可能需要手动解决冲突"
  fi
else
  info "正在克隆代码 / Cloning repository..."
  if $DRY_RUN; then
    dry "mkdir -p \"$(dirname "$PLUGIN_DIR")\""
    dry "git clone https://github.com/robinspt/tickflow-assist.git \"$PLUGIN_DIR\""
  else
    mkdir -p "$(dirname "$PLUGIN_DIR")"
    git clone https://github.com/robinspt/tickflow-assist.git "$PLUGIN_DIR"
  fi
fi
success "源码已就绪: $PLUGIN_DIR"

OPENCLAW_JSON="$HOME/.openclaw/openclaw.json"
LOCAL_CONFIG_PATH="$PLUGIN_DIR/local.config.json"

read_json_value() {
  local file="$1"
  local query="$2"
  if [[ -f "$file" ]]; then
    jq -r "$query // empty" "$file" 2>/dev/null || true
  fi
}

read_json_compact() {
  local file="$1"
  local query="$2"
  if [[ -f "$file" ]]; then
    jq -c "$query" "$file" 2>/dev/null || true
  fi
}

alert_target_hint() {
  case "$1" in
    telegram) printf '%s' "Telegram群组ID / 会话ID" ;;
    qqbot) printf '%s' "qqbot:c2c:OPENID" ;;
    wecom) printf '%s' "企业微信 userId（单聊）/ chatId 或群 ID（群聊）" ;;
    *) printf '%s' "OpenClaw target" ;;
  esac
}

# 3. 安装依赖与构建
echo ""
info "第 3 步：安装依赖并构建 / Install dependencies and build..."
if $DRY_RUN; then
  dry "cd \"$PLUGIN_DIR\" && npm install"
  dry "cd \"$PLUGIN_DIR/python\" && uv sync"
  dry "cd \"$PLUGIN_DIR\" && npm run build"
  success "依赖安装与构建完成 (Dry Run)"
else
  (
    cd "$PLUGIN_DIR"
    info "1) npm install..."
    npm install --loglevel=warn 2>&1
    info "2) uv sync (python)..."
    cd python && uv sync && cd ..
    info "3) npm run build..."
    npm run build
  )
  success "依赖安装与构建完成"
fi

# 4. 配置收集
echo ""
info "第 4 步：生成配置 / Configuring..."
echo ""
echo -e "${BOLD}--- TickFlow 配置 ---${NC}"
echo "获取 TickFlow API Key：https://tickflow.org/auth/register?ref=BUJ54JEDGE"

if [[ -f "$LOCAL_CONFIG_PATH" ]]; then
  info "检测到已有 local.config.json，将优先沿用其中的配置。"
fi

EXISTING_LOCAL_TICKFLOW_API_URL=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.tickflowApiUrl')
EXISTING_LOCAL_TICKFLOW_KEY=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.tickflowApiKey')
EXISTING_LOCAL_TICKFLOW_LEVEL=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.tickflowApiKeyLevel')
EXISTING_LOCAL_LLM_BASE_URL=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.llmBaseUrl')
EXISTING_LOCAL_LLM_KEY=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.llmApiKey')
EXISTING_LOCAL_LLM_MODEL=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.llmModel')
EXISTING_LOCAL_REQUEST_INTERVAL=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.requestInterval')
EXISTING_LOCAL_DAILY_UPDATE_NOTIFY=$(read_json_compact "$LOCAL_CONFIG_PATH" '.plugin.dailyUpdateNotify // false')
EXISTING_LOCAL_ALERT_CHANNEL=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.alertChannel')
EXISTING_LOCAL_ALERT_ACCOUNT=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.alertAccount')
EXISTING_LOCAL_ALERT_TARGET=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.alertTarget')
EXISTING_LOCAL_OPENCLAW_BIN=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.openclawCliBin')
EXISTING_LOCAL_PYTHON_BIN=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.pythonBin')
EXISTING_LOCAL_PYTHON_ARGS=$(read_json_compact "$LOCAL_CONFIG_PATH" '.plugin.pythonArgs // ["run","python"]')
EXISTING_LOCAL_DATABASE_PATH=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.databasePath')
EXISTING_LOCAL_CALENDAR_FILE=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.calendarFile')
EXISTING_LOCAL_PYTHON_WORKDIR=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.pythonWorkdir')

EXISTING_OPENCLAW_TICKFLOW_API_URL=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.tickflowApiUrl')
EXISTING_OPENCLAW_TICKFLOW_KEY=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.tickflowApiKey')
EXISTING_OPENCLAW_TICKFLOW_LEVEL=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.tickflowApiKeyLevel')
EXISTING_OPENCLAW_LLM_BASE_URL=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.llmBaseUrl')
EXISTING_OPENCLAW_LLM_KEY=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.llmApiKey')
EXISTING_OPENCLAW_LLM_MODEL=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.llmModel')
EXISTING_OPENCLAW_REQUEST_INTERVAL=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.requestInterval')
EXISTING_OPENCLAW_DAILY_UPDATE_NOTIFY=$(read_json_compact "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.dailyUpdateNotify // false')
EXISTING_OPENCLAW_ALERT_CHANNEL=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.alertChannel')
EXISTING_OPENCLAW_ALERT_ACCOUNT=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.alertAccount')
EXISTING_OPENCLAW_ALERT_TARGET=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.alertTarget')
EXISTING_OPENCLAW_OPENCLAW_BIN=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.openclawCliBin')
EXISTING_OPENCLAW_PYTHON_BIN=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.pythonBin')
EXISTING_OPENCLAW_PYTHON_ARGS=$(read_json_compact "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.pythonArgs // ["run","python"]')

DEFAULT_TICKFLOW_API_URL=${EXISTING_LOCAL_TICKFLOW_API_URL:-${EXISTING_OPENCLAW_TICKFLOW_API_URL:-https://api.tickflow.org}}
DEFAULT_TICKFLOW_KEY=${EXISTING_LOCAL_TICKFLOW_KEY:-$EXISTING_OPENCLAW_TICKFLOW_KEY}
DEFAULT_TICKFLOW_LEVEL=${EXISTING_LOCAL_TICKFLOW_LEVEL:-${EXISTING_OPENCLAW_TICKFLOW_LEVEL:-Free}}
DEFAULT_LLM_BASE_URL=${EXISTING_LOCAL_LLM_BASE_URL:-${EXISTING_OPENCLAW_LLM_BASE_URL:-https://api.openai.com/v1}}
DEFAULT_LLM_KEY=${EXISTING_LOCAL_LLM_KEY:-$EXISTING_OPENCLAW_LLM_KEY}
DEFAULT_LLM_MODEL=${EXISTING_LOCAL_LLM_MODEL:-${EXISTING_OPENCLAW_LLM_MODEL:-gpt-4o}}
DEFAULT_REQUEST_INTERVAL=${EXISTING_LOCAL_REQUEST_INTERVAL:-${EXISTING_OPENCLAW_REQUEST_INTERVAL:-30}}
DEFAULT_DAILY_UPDATE_NOTIFY=${EXISTING_LOCAL_DAILY_UPDATE_NOTIFY:-${EXISTING_OPENCLAW_DAILY_UPDATE_NOTIFY:-false}}
DEFAULT_ALERT_CHANNEL=${EXISTING_LOCAL_ALERT_CHANNEL:-${EXISTING_OPENCLAW_ALERT_CHANNEL:-telegram}}
DEFAULT_ALERT_ACCOUNT=${EXISTING_LOCAL_ALERT_ACCOUNT:-$EXISTING_OPENCLAW_ALERT_ACCOUNT}
DEFAULT_ALERT_TARGET=${EXISTING_LOCAL_ALERT_TARGET:-$EXISTING_OPENCLAW_ALERT_TARGET}
DEFAULT_OPENCLAW_BIN=${EXISTING_LOCAL_OPENCLAW_BIN:-${EXISTING_OPENCLAW_OPENCLAW_BIN:-openclaw}}
DEFAULT_PYTHON_BIN=${EXISTING_LOCAL_PYTHON_BIN:-${EXISTING_OPENCLAW_PYTHON_BIN:-uv}}
DEFAULT_PYTHON_ARGS=${EXISTING_LOCAL_PYTHON_ARGS:-${EXISTING_OPENCLAW_PYTHON_ARGS:-'["run","python"]'}}
DEFAULT_LOCAL_DATABASE_PATH=${EXISTING_LOCAL_DATABASE_PATH:-./data/lancedb}
DEFAULT_LOCAL_CALENDAR_FILE=${EXISTING_LOCAL_CALENDAR_FILE:-./day_future.txt}
DEFAULT_LOCAL_PYTHON_WORKDIR=${EXISTING_LOCAL_PYTHON_WORKDIR:-./python}

if [[ -n "$DEFAULT_TICKFLOW_KEY" ]]; then
  echo "当前 TickFlow API Key：[已保存过]"
  read -p "  输入新的 TickFlow API Key (直接回车保持不变): " TICKFLOW_KEY
  TICKFLOW_KEY=${TICKFLOW_KEY:-$DEFAULT_TICKFLOW_KEY}
else
  read -p "  TickFlow API Key: " TICKFLOW_KEY
  TICKFLOW_KEY=${TICKFLOW_KEY:-"YOUR_TICKFLOW_KEY"}
fi

echo ""
echo -e "  ${BOLD}TickFlow 订阅等级 / Subscription Level${NC}"
echo "  1) Free   (默认 / Default)"
echo "  2) Start"
echo "  3) Pro"
echo "  4) Expert"
DEFAULT_LEVEL_CHOICE=1
case "$DEFAULT_TICKFLOW_LEVEL" in
  Free) DEFAULT_LEVEL_CHOICE=1 ;;
  Start) DEFAULT_LEVEL_CHOICE=2 ;;
  Pro) DEFAULT_LEVEL_CHOICE=3 ;;
  Expert) DEFAULT_LEVEL_CHOICE=4 ;;
esac
while true; do
  read -p "  请选择等级 (1-4) [默认 ${DEFAULT_LEVEL_CHOICE}]: " LEVEL_CHOICE
  LEVEL_CHOICE=${LEVEL_CHOICE:-$DEFAULT_LEVEL_CHOICE}
  case "$LEVEL_CHOICE" in
    1) TICKFLOW_LEVEL="Free"; break ;;
    2) TICKFLOW_LEVEL="Start"; break ;;
    3) TICKFLOW_LEVEL="Pro"; break ;;
    4) TICKFLOW_LEVEL="Expert"; break ;;
    *) warn "无效选择，请输入 1-4 / Invalid, enter 1-4." ;;
  esac
done
success "已选择等级: $TICKFLOW_LEVEL"

echo ""
echo -e "${BOLD}--- LLM 配置 ---${NC}"
read -p "  LLM API Base URL [默认 ${DEFAULT_LLM_BASE_URL}]: " LLM_BASE_URL
LLM_BASE_URL=${LLM_BASE_URL:-$DEFAULT_LLM_BASE_URL}

if [[ -n "$DEFAULT_LLM_KEY" ]]; then
  read -p "  LLM API Key (直接回车保持不变): " LLM_API_KEY
  LLM_API_KEY=${LLM_API_KEY:-$DEFAULT_LLM_KEY}
else
  read -p "  LLM API Key: " LLM_API_KEY
  LLM_API_KEY=${LLM_API_KEY:-"YOUR_LLM_API_KEY"}
fi

read -p "  LLM 模型名 [默认 ${DEFAULT_LLM_MODEL}]: " LLM_MODEL
LLM_MODEL=${LLM_MODEL:-$DEFAULT_LLM_MODEL}

echo ""
echo -e "${BOLD}--- 告警投递配置 ---${NC}"
echo "  1) telegram   (默认 / Default)"
echo "  2) qqbot"
echo "  3) wecom"
DEFAULT_CHANNEL_CHOICE=1
case "$DEFAULT_ALERT_CHANNEL" in
  qqbot) DEFAULT_CHANNEL_CHOICE=2 ;;
  wecom) DEFAULT_CHANNEL_CHOICE=3 ;;
  *) DEFAULT_CHANNEL_CHOICE=1 ;;
esac
while true; do
  read -p "  请选择推送通道 (1-3) [默认 ${DEFAULT_CHANNEL_CHOICE}]: " CH_CHOICE
  CH_CHOICE=${CH_CHOICE:-$DEFAULT_CHANNEL_CHOICE}
  case "$CH_CHOICE" in
    1) ALERT_CHANNEL="telegram"; break ;;
    2) ALERT_CHANNEL="qqbot"; break ;;
    3) ALERT_CHANNEL="wecom"; break ;;
    *) warn "无效选择，请输入 1-3 / Invalid, enter 1-3." ;;
  esac
done
success "已选择通道: $ALERT_CHANNEL"

ALERT_ACCOUNT="$DEFAULT_ALERT_ACCOUNT"
if [[ ( "$ALERT_CHANNEL" == "qqbot" || "$ALERT_CHANNEL" == "wecom" ) && -z "$ALERT_ACCOUNT" ]]; then
  ALERT_ACCOUNT="default"
fi

TARGET_HINT=$(alert_target_hint "$ALERT_CHANNEL")
if [[ -n "$DEFAULT_ALERT_TARGET" ]]; then
  read -p "  告警投递目标 (${TARGET_HINT}，直接回车保持不变): " ALERT_TARGET
  ALERT_TARGET=${ALERT_TARGET:-$DEFAULT_ALERT_TARGET}
else
  read -p "  告警投递目标 (${TARGET_HINT}): " ALERT_TARGET
  ALERT_TARGET=${ALERT_TARGET:-"YOUR_TARGET"}
fi

# 生成 local.config.json
LOCAL_CONFIG=$(jq -n \
  --arg url "$DEFAULT_TICKFLOW_API_URL" \
  --arg key "$TICKFLOW_KEY" \
  --arg level "$TICKFLOW_LEVEL" \
  --arg llmUrl "$LLM_BASE_URL" \
  --arg llmKey "$LLM_API_KEY" \
  --arg model "$LLM_MODEL" \
  --arg dbPath "$DEFAULT_LOCAL_DATABASE_PATH" \
  --arg calFile "$DEFAULT_LOCAL_CALENDAR_FILE" \
  --argjson reqInt "$DEFAULT_REQUEST_INTERVAL" \
  --argjson daily "$DEFAULT_DAILY_UPDATE_NOTIFY" \
  --arg channel "$ALERT_CHANNEL" \
  --arg bin "$DEFAULT_OPENCLAW_BIN" \
  --arg acc "$ALERT_ACCOUNT" \
  --arg trg "$ALERT_TARGET" \
  --arg pyBin "$DEFAULT_PYTHON_BIN" \
  --arg pyDir "$DEFAULT_LOCAL_PYTHON_WORKDIR" \
  --argjson pyArgs "$DEFAULT_PYTHON_ARGS" \
  '{
    plugin: {
      tickflowApiUrl: $url,
      tickflowApiKey: $key,
      tickflowApiKeyLevel: $level,
      llmBaseUrl: $llmUrl,
      llmApiKey: $llmKey,
      llmModel: $model,
      databasePath: $dbPath,
      calendarFile: $calFile,
      requestInterval: $reqInt,
      dailyUpdateNotify: $daily,
      alertChannel: $channel,
      openclawCliBin: $bin,
      alertAccount: $acc,
      alertTarget: $trg,
      pythonBin: $pyBin,
      pythonArgs: $pyArgs,
      pythonWorkdir: $pyDir
    }
  }'
)
if $DRY_RUN; then
  dry "生成本地配置 -> $PLUGIN_DIR/local.config.json:\n$LOCAL_CONFIG"
else
  echo "$LOCAL_CONFIG" > "$PLUGIN_DIR/local.config.json"
  success "生成本地配置 -> $PLUGIN_DIR/local.config.json"
fi

# 5. OpenClaw 配置写入
echo ""
info "第 5 步：写入 openclaw.json / Write openclaw.json..."

if [[ ! -f "$OPENCLAW_JSON" ]]; then
  echo '{}' > "$OPENCLAW_JSON"
fi

# 5.1 获取现有的 Agent 并提示用户选择
echo ""
info "正在检查已有的 Agents / Checking existing agents..."
AGENT_DISCOVERY=$(jq -r '
  [
    if (.agents.list? | type) == "array" then
      .agents.list[]
      | select((.id // "") != "")
      | { targetType: "list", agentId: .id, label: .id }
    else
      empty
    end
  ] as $listAgents
  | if ($listAgents | length) > 0 then
      $listAgents[]
      | "\(.targetType)|\(.agentId)|\(.label)"
    else
      "global|default|默认 Agent (单 Agent 模式，写入顶层 tools)"
    end
' "$OPENCLAW_JSON" 2>/dev/null || echo "")

AGENT_TOOLS_JSON="{}"
SELECTED_AGENT_TYPE=""
SELECTED_AGENT=""
if [[ -n "$AGENT_DISCOVERY" ]]; then
  echo -e "${BOLD}可配置的 Agent 目标：${NC}"
  local_n=0
  declare -a AGENT_TARGET_TYPES=()
  declare -a AGENT_TARGET_IDS=()
  declare -a AGENT_TARGET_LABELS=()
  while IFS='|' read -r target_type agent_id label; do
    [[ -z "${target_type:-}" ]] && continue
    local_n=$((local_n + 1))
    AGENT_TARGET_TYPES+=("$target_type")
    AGENT_TARGET_IDS+=("$agent_id")
    AGENT_TARGET_LABELS+=("$label")
    echo "  $local_n) $label"
  done <<< "$AGENT_DISCOVERY"
  echo "  0) 不配置 tools 限制 (跳过)"
  echo ""

  read -p "  请选择要为哪个 Agent 写入推荐 tools 配置 (输入数字) [默认 1]: " AGENT_CHOICE
  AGENT_CHOICE=${AGENT_CHOICE:-1}

  if [[ "$AGENT_CHOICE" =~ ^[0-9]+$ ]] && [[ "$AGENT_CHOICE" -ge 1 ]] && [[ "$AGENT_CHOICE" -le $local_n ]]; then
    SELECTED_AGENT_TYPE="${AGENT_TARGET_TYPES[$((AGENT_CHOICE - 1))]}"
    SELECTED_AGENT="${AGENT_TARGET_IDS[$((AGENT_CHOICE - 1))]}"
    SELECTED_AGENT_LABEL="${AGENT_TARGET_LABELS[$((AGENT_CHOICE - 1))]}"
    success "已选择 Agent: $SELECTED_AGENT_LABEL"

    AGENT_TOOLS_JSON=$(cat <<EOF
{
  "profile": "full",
  "deny": []
}
EOF
)
  else
    info "跳过 Agent tools 配置。"
  fi
else
  info "未检测到可识别的 Agent 配置，跳过 tools 配置。"
fi

# 生成插件专用配置字段
PLUGIN_CONFIG_JSON=$(jq -n \
  --arg url "$DEFAULT_TICKFLOW_API_URL" \
  --arg key "$TICKFLOW_KEY" \
  --arg level "$TICKFLOW_LEVEL" \
  --arg llmUrl "$LLM_BASE_URL" \
  --arg llmKey "$LLM_API_KEY" \
  --arg model "$LLM_MODEL" \
  --arg dbPath "$PLUGIN_DIR/data/lancedb" \
  --arg calFile "$PLUGIN_DIR/day_future.txt" \
  --argjson reqInt "$DEFAULT_REQUEST_INTERVAL" \
  --argjson daily "$DEFAULT_DAILY_UPDATE_NOTIFY" \
  --arg channel "$ALERT_CHANNEL" \
  --arg bin "$DEFAULT_OPENCLAW_BIN" \
  --arg acc "$ALERT_ACCOUNT" \
  --arg trg "$ALERT_TARGET" \
  --arg pyBin "$DEFAULT_PYTHON_BIN" \
  --arg pyDir "$PLUGIN_DIR/python" \
  --argjson pyArgs "$DEFAULT_PYTHON_ARGS" \
  '{
    enabled: true,
    config: {
      tickflowApiUrl: $url,
      tickflowApiKey: $key,
      tickflowApiKeyLevel: $level,
      llmBaseUrl: $llmUrl,
      llmApiKey: $llmKey,
      llmModel: $model,
      databasePath: $dbPath,
      calendarFile: $calFile,
      requestInterval: $reqInt,
      dailyUpdateNotify: $daily,
      alertChannel: $channel,
      openclawCliBin: $bin,
      alertAccount: $acc,
      alertTarget: $trg,
      pythonBin: $pyBin,
      pythonArgs: $pyArgs,
      pythonWorkdir: $pyDir
    }
  }'
)

if [[ ! -f "$OPENCLAW_JSON" ]]; then
  echo '{}' > "$OPENCLAW_JSON"
fi

BACKUP_FILE="$OPENCLAW_JSON.backup.$(date +%Y%m%d_%H%M%S)"
cp "$OPENCLAW_JSON" "$BACKUP_FILE"

MERGED=$(jq \
  --argjson pcfg "$PLUGIN_CONFIG_JSON" \
  --argjson tools "$AGENT_TOOLS_JSON" \
  --arg agent_id "${SELECTED_AGENT:-}" \
  --arg agent_type "${SELECTED_AGENT_TYPE:-}" '
  def merge_tool_policy($base; $patch):
    ($base // {}) as $baseObj |
    ($patch // {}) as $patchObj |
    ($baseObj * $patchObj)
    | if ($baseObj.allow? | type) == "array" or ($patchObj.allow? | type) == "array" then
        .allow = ((($baseObj.allow // []) + ($patchObj.allow // [])) | unique)
      else
        .
      end
    | if ($patchObj | has("deny")) then
        .deny = ($patchObj.deny // [])
      elif ($baseObj.deny? | type) == "array" then
        .deny = ((($baseObj.deny // []) + ($patchObj.deny // [])) | unique)
      else
        .
      end;

  (.agents.defaults.tools // {}) as $legacyDefaultTools |
  .plugins //= {} |
  .plugins.entries //= {} |
  .plugins.entries["tickflow-assist"] = $pcfg |
  if (.agents.defaults? | type) == "object" then
    .agents.defaults |= del(.tools)
  else
    .
  end |
  if ($legacyDefaultTools | length) > 0 then
    .tools = merge_tool_policy(.tools; $legacyDefaultTools)
  else
    .
  end |
  if $agent_type == "list" and $agent_id != "" and $agent_id != null then
    .agents //= {} |
    .agents.list //= [] |
    (
      .agents.list | map(select(.id == $agent_id)) | length
    ) as $exists |
    if $exists > 0 then
      .agents.list = (.agents.list | map(
        if .id == $agent_id then
          .tools = merge_tool_policy(.tools; $tools)
        else
          .
        end
      ))
    else
      .
    end
  elif $agent_type == "global" then
    .tools = merge_tool_policy(.tools; $tools)
  else
    .
  end
' "$OPENCLAW_JSON")

if $DRY_RUN; then
  dry "更新 OpenClaw 配置文件 -> $OPENCLAW_JSON:\n$MERGED"
  info "当前为 --dry-run，未实际写入 $OPENCLAW_JSON，因此不会出现 updated。"
else
  if echo "$MERGED" | jq empty 2>/dev/null; then
    echo "$MERGED" > "$OPENCLAW_JSON"
    success "OpenClaw 配置文件已更新 / openclaw.json updated"
  else
    fail "JSON 合并失败，备份位于 $BACKUP_FILE"
  fi
fi

# 6. 安装与启动
echo ""
info "第 6 步：在 OpenClaw 中安装插件 / Register to OpenClaw..."
if $DRY_RUN; then
  dry "openclaw plugins install -l \"$PLUGIN_DIR\""
  dry "openclaw plugins enable tickflow-assist"
else
  openclaw plugins install -l "$PLUGIN_DIR"
  openclaw plugins enable tickflow-assist
  success "插件已注册"
fi

echo ""
info "第 7 步：重启 Gateway / Restart..."
if $DRY_RUN; then
  dry "openclaw gateway restart"
else
  if openclaw gateway restart 2>&1; then
    success "Gateway 重启成功"
  else
    warn "重启 Gateway 失败，可手动执行：openclaw gateway restart"
  fi
fi

echo ""
echo -e "${GREEN}${BOLD}======================================================${NC}"
echo -e "${GREEN}${BOLD}  安装完成 / Install Complete!${NC}"
echo -e "${GREEN}${BOLD}======================================================${NC}"
echo ""
echo "  您可以在 OpenClaw 对话中输入：“测试告警” 验证配置"
echo "  或者在项目目录执行: npm run tool -- test_alert"
echo ""
echo "  建议去 OpenClaw 对话中新建会话: /new"
echo "  以确保股票 Agent 加载最新的工具列表！"
echo ""
