#!/usr/bin/env bash
# ============================================================
# TickFlow Assist 安装/升级/卸载脚本
# 菜单式入口，支持状态检查、安装、升级、卸载
# ============================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

PLUGIN_ID="tickflow-assist"
REPO_URL="https://github.com/robinspt/tickflow-assist.git"
OPENCLAW_JSON="$HOME/.openclaw/openclaw.json"

DRY_RUN=false
ACTION=""

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC}   $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()    { echo -e "${RED}[ERR]${NC}  $1"; exit 1; }
dry()     { echo -e "${YELLOW}[DRY-RUN]${NC} 将会执行 / Would run: $1"; }

print_usage() {
  cat <<'EOF'
用法:
  bash setup-tickflow.sh [--dry-run] [--install|--upgrade|--uninstall]

参数:
  --dry-run      仅打印将执行的操作，不实际写入或执行
  --install      直接进入新安装流程
  --upgrade      直接进入升级流程
  --uninstall    直接进入卸载流程
  -h, --help     显示帮助
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      ;;
    --install|install)
      ACTION="install"
      ;;
    --upgrade|upgrade)
      ACTION="upgrade"
      ;;
    --uninstall|uninstall)
      ACTION="uninstall"
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      fail "未知参数: $1"
      ;;
  esac
  shift
done

command_installed() {
  command -v "$1" >/dev/null 2>&1
}

maybe_fix_openclaw_path() {
  local npm_prefix=""
  local npm_bin=""
  local npm_candidate=""

  if command_installed openclaw; then
    return 0
  fi

  if ! command_installed npm; then
    return 1
  fi

  npm_prefix=$(npm prefix -g 2>/dev/null || true)
  [[ -z "$npm_prefix" ]] && return 1

  npm_bin="$npm_prefix/bin"
  npm_candidate="$npm_bin/openclaw"
  [[ ! -x "$npm_candidate" ]] && return 1

  case ":$PATH:" in
    *":$npm_bin:"*)
      return 0
      ;;
  esac

  export PATH="$npm_bin:$PATH"
  OPENCLAW_PATH_FIXED="yes"
  OPENCLAW_PATH_HINT="$npm_candidate"
  return 0
}

resolve_openclaw_command() {
  local npm_prefix=""
  local npm_candidate=""

  maybe_fix_openclaw_path >/dev/null 2>&1 || true

  if command_installed openclaw; then
    command -v openclaw
    return 0
  fi

  if command_installed npm; then
    npm_prefix=$(npm prefix -g 2>/dev/null || true)
    if [[ -n "$npm_prefix" ]]; then
      npm_candidate="$npm_prefix/bin/openclaw"
      if [[ -x "$npm_candidate" ]]; then
        printf '%s\n' "$npm_candidate"
        return 0
      fi
    fi
  fi

  return 1
}

is_plugin_source_dir() {
  local dir="$1"
  [[ -f "$dir/openclaw.plugin.json" && -d "$dir/src" ]]
}

is_git_worktree() {
  local dir="$1"
  if ! command_installed git; then
    return 1
  fi
  git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

status_badge() {
  if [[ "$1" == "yes" ]]; then
    printf '%b已就绪%b' "$GREEN" "$NC"
  else
    printf '%b未就绪%b' "$RED" "$NC"
  fi
}

bool_text() {
  if [[ "$1" == "yes" ]]; then
    printf '是'
  else
    printf '否'
  fi
}

print_status_row() {
  local name="$1"
  local status="$2"
  local detail="${3:-}"
  printf '  %-18s %b' "$name" "$(status_badge "$status")"
  if [[ -n "$detail" ]]; then
    printf '  %s' "$detail"
  fi
  printf '\n'
}

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

parent_dir() {
  local path="$1"
  dirname "$path"
}

candidate_dir_from_config_path() {
  local raw_path="$1"
  local parent=""
  local grandparent=""

  [[ -z "$raw_path" ]] && return 1

  case "$raw_path" in
    */data/lancedb)
      parent=$(parent_dir "$raw_path")
      grandparent=$(parent_dir "$parent")
      printf '%s\n' "$grandparent"
      return 0
      ;;
    */day_future.txt)
      parent=$(parent_dir "$raw_path")
      printf '%s\n' "$parent"
      return 0
      ;;
    */python)
      parent=$(parent_dir "$raw_path")
      printf '%s\n' "$parent"
      return 0
      ;;
  esac

  return 1
}

detect_plugin_dir_from_openclaw_config() {
  local candidate=""
  local value=""

  if [[ ! -f "$OPENCLAW_JSON" ]] || ! command_installed jq; then
    return 1
  fi

  for query in \
    '.plugins.entries["tickflow-assist"].config.databasePath' \
    '.plugins.entries["tickflow-assist"].config.calendarFile' \
    '.plugins.entries["tickflow-assist"].config.pythonWorkdir'
  do
    value=$(read_json_value "$OPENCLAW_JSON" "$query")
    candidate=$(candidate_dir_from_config_path "$value" || true)
    if [[ -n "$candidate" ]] && is_plugin_source_dir "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

detect_plugin_dir_from_openclaw_cli() {
  local info_output=""
  local candidate=""
  local openclaw_cmd=""

  openclaw_cmd="${OPENCLAW_CMD:-}"
  if [[ -z "$openclaw_cmd" ]]; then
    openclaw_cmd=$(resolve_openclaw_command || true)
  fi

  if [[ -z "$openclaw_cmd" ]]; then
    return 1
  fi

  info_output=$("$openclaw_cmd" plugins info "$PLUGIN_ID" 2>/dev/null || true)
  [[ -z "$info_output" ]] && return 1

  while IFS= read -r candidate; do
    [[ -z "$candidate" ]] && continue
    if [[ -f "$candidate" ]] && [[ "$(basename "$candidate")" == "openclaw.plugin.json" ]]; then
      candidate=$(parent_dir "$candidate")
    fi
    if is_plugin_source_dir "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(printf '%s\n' "$info_output" | grep -Eo '/[^[:space:]"]+' | sed 's/[),:]$//' | awk '!seen[$0]++')

  return 1
}

if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  SCRIPT_DIR="$(pwd)"
fi

if is_plugin_source_dir "$SCRIPT_DIR"; then
  DEFAULT_PLUGIN_DIR="$SCRIPT_DIR"
elif DETECTED_PLUGIN_DIR="$(detect_plugin_dir_from_openclaw_config)"; then
  DEFAULT_PLUGIN_DIR="$DETECTED_PLUGIN_DIR"
elif DETECTED_PLUGIN_DIR="$(detect_plugin_dir_from_openclaw_cli)"; then
  DEFAULT_PLUGIN_DIR="$DETECTED_PLUGIN_DIR"
else
  DEFAULT_PLUGIN_DIR="$HOME/tickflow-assist"
fi

PLUGIN_DIR="$DEFAULT_PLUGIN_DIR"
LOCAL_CONFIG_PATH=""

refresh_paths() {
  LOCAL_CONFIG_PATH="$PLUGIN_DIR/local.config.json"
}

refresh_state() {
  HAS_GIT="no"
  HAS_NODE="no"
  HAS_NPM="no"
  HAS_UV="no"
  HAS_JQ="no"
  HAS_OPENCLAW="no"
  OPENCLAW_CMD=""
  OPENCLAW_PATH_HINT=""
  OPENCLAW_PATH_WARNING="no"
  OPENCLAW_PATH_FIXED="no"

  command_installed git && HAS_GIT="yes"
  command_installed node && HAS_NODE="yes"
  command_installed npm && HAS_NPM="yes"
  command_installed uv && HAS_UV="yes"
  command_installed jq && HAS_JQ="yes"
  maybe_fix_openclaw_path >/dev/null 2>&1 || true
  if OPENCLAW_CMD="$(resolve_openclaw_command)"; then
    HAS_OPENCLAW="yes"
    if [[ "$OPENCLAW_PATH_FIXED" == "yes" ]]; then
      OPENCLAW_PATH_WARNING="yes"
      OPENCLAW_PATH_HINT="$OPENCLAW_CMD"
    elif [[ "$OPENCLAW_CMD" != "openclaw" && "$OPENCLAW_CMD" != "$(command -v openclaw 2>/dev/null || true)" ]]; then
      OPENCLAW_PATH_WARNING="yes"
      OPENCLAW_PATH_HINT="$OPENCLAW_CMD"
    fi
  fi

  PLUGIN_SOURCE_READY="no"
  PLUGIN_GIT_READY="no"
  LOCAL_CONFIG_EXISTS="no"
  BUILD_READY="no"
  OPENCLAW_JSON_EXISTS="no"
  OPENCLAW_PLUGIN_CONFIGURED="no"
  OPENCLAW_PLUGIN_ENABLED="no"

  is_plugin_source_dir "$PLUGIN_DIR" && PLUGIN_SOURCE_READY="yes"
  if is_git_worktree "$PLUGIN_DIR"; then
    PLUGIN_GIT_READY="yes"
  fi
  [[ -f "$LOCAL_CONFIG_PATH" ]] && LOCAL_CONFIG_EXISTS="yes"
  [[ -f "$PLUGIN_DIR/dist/plugin.js" ]] && BUILD_READY="yes"
  [[ -f "$OPENCLAW_JSON" ]] && OPENCLAW_JSON_EXISTS="yes"

  if [[ "$HAS_JQ" == "yes" && -f "$OPENCLAW_JSON" ]]; then
    if jq -e '.plugins.entries["tickflow-assist"]? != null' "$OPENCLAW_JSON" >/dev/null 2>&1; then
      OPENCLAW_PLUGIN_CONFIGURED="yes"
    fi
    if jq -e '.plugins.entries["tickflow-assist"]?.enabled == true' "$OPENCLAW_JSON" >/dev/null 2>&1; then
      OPENCLAW_PLUGIN_ENABLED="yes"
    fi
  fi
}

show_header() {
  echo ""
  echo -e "${BOLD}========================================${NC}"
  echo -e "${BOLD}  TickFlow Assist 安装管理脚本${NC}"
  echo -e "${BOLD}========================================${NC}"
  echo ""
}

show_status_panel() {
  refresh_state
  show_header
  echo -e "${BOLD}依赖状态${NC}"
  print_status_row "git" "$HAS_GIT"
  print_status_row "node" "$HAS_NODE"
  print_status_row "npm" "$HAS_NPM"
  print_status_row "uv" "$HAS_UV"
  print_status_row "jq" "$HAS_JQ"
  print_status_row "openclaw" "$HAS_OPENCLAW" "${OPENCLAW_PATH_HINT:-}"
  echo ""
  echo -e "${BOLD}项目状态${NC}"
  print_status_row "项目目录" "$PLUGIN_SOURCE_READY" "$PLUGIN_DIR"
  print_status_row "Git 仓库" "$PLUGIN_GIT_READY" "$PLUGIN_DIR/.git"
  print_status_row "本地配置" "$LOCAL_CONFIG_EXISTS" "$LOCAL_CONFIG_PATH"
  print_status_row "构建产物" "$BUILD_READY" "$PLUGIN_DIR/dist/plugin.js"
  print_status_row "OpenClaw 配置文件" "$OPENCLAW_JSON_EXISTS" "$OPENCLAW_JSON"
  print_status_row "插件配置已写入" "$OPENCLAW_PLUGIN_CONFIGURED" "$PLUGIN_ID"
  print_status_row "插件已启用" "$OPENCLAW_PLUGIN_ENABLED" "$PLUGIN_ID"
  echo ""
  if [[ "$OPENCLAW_PATH_WARNING" == "yes" ]]; then
    if [[ "$OPENCLAW_PATH_FIXED" == "yes" ]]; then
      warn "检测到 openclaw 已安装，但不在当前 PATH 中。脚本已临时加入 PATH，并将使用: $OPENCLAW_CMD"
    else
      warn "检测到 openclaw 已安装，但不在当前 PATH 中。脚本将改用: $OPENCLAW_CMD"
    fi
    warn "建议你在当前 shell 手动执行：export PATH=\"\$(npm prefix -g)/bin:\$PATH\""
    warn "如需长期生效，请把这行加入 ~/.bashrc 或 ~/.zshrc。"
    echo ""
  fi
}

prompt_main_menu() {
  if [[ -n "$ACTION" ]]; then
    SELECTED_ACTION="$ACTION"
    return
  fi

  echo -e "${BOLD}请选择任务${NC}"
  echo "  1) 新安装"
  echo "  2) 升级"
  echo "  3) 卸载"
  echo "  4) 退出"
  echo ""

  while true; do
    read -r -p "请输入选项 [默认 1]: " MENU_CHOICE
    MENU_CHOICE=${MENU_CHOICE:-1}
    case "$MENU_CHOICE" in
      1) SELECTED_ACTION="install"; return ;;
      2) SELECTED_ACTION="upgrade"; return ;;
      3) SELECTED_ACTION="uninstall"; return ;;
      4) SELECTED_ACTION="exit"; return ;;
      *) warn "无效选择，请输入 1-4。" ;;
    esac
  done
}

ensure_parent_dir() {
  local target="$1"
  if $DRY_RUN; then
    dry "mkdir -p \"$target\""
  else
    mkdir -p "$target"
  fi
}

ensure_required_commands() {
  local missing=()
  local cmd=""
  for cmd in "$@"; do
    if [[ "$cmd" == "openclaw" ]]; then
      maybe_fix_openclaw_path >/dev/null 2>&1 || true
      if ! OPENCLAW_CMD="$(resolve_openclaw_command)"; then
        missing+=("$cmd")
      fi
    else
      if ! command_installed "$cmd"; then
        missing+=("$cmd")
      fi
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    fail "缺少依赖：${missing[*]}。请先安装后重试。"
  fi
}

ensure_uv() {
  if command_installed uv; then
    return
  fi

  warn "找不到 uv。"
  read -r -p "  要自动安装 uv 吗？(y/n) [y]: " INSTALL_UV
  if [[ ! "${INSTALL_UV:-y}" =~ ^[yY]$ ]]; then
    fail "请先手动安装 uv。"
  fi

  ensure_required_commands curl
  if $DRY_RUN; then
    dry "curl -LsSf https://astral.sh/uv/install.sh | sh"
    HAS_UV="yes"
    return
  fi

  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.cargo/bin:$PATH"
  command_installed uv || fail "uv 安装失败或未在 PATH 中，请重新打开终端后重试。"
  success "uv 安装完成"
}

prompt_plugin_dir() {
  local mode="$1"
  local default_dir="$PLUGIN_DIR"
  local prompt_text="项目目录"

  case "$mode" in
    install) prompt_text="安装目录" ;;
    upgrade) prompt_text="升级目录" ;;
    uninstall) prompt_text="卸载目录" ;;
  esac

  echo ""
  read -r -p "  ${prompt_text} [默认: ${default_dir}]: " INPUT_DIR
  if [[ -n "${INPUT_DIR:-}" ]]; then
    PLUGIN_DIR="$INPUT_DIR"
    refresh_paths
    refresh_state
  fi
}

prepare_plugin_source() {
  if is_plugin_source_dir "$PLUGIN_DIR"; then
    info "检测到已有源码目录：$PLUGIN_DIR"
    if is_git_worktree "$PLUGIN_DIR"; then
      info "正在拉取最新代码..."
      if $DRY_RUN; then
        dry "git -C \"$PLUGIN_DIR\" pull origin main"
      else
        git -C "$PLUGIN_DIR" pull origin main 2>&1 || warn "git pull 失败，可能需要手动解决冲突。"
      fi
    else
      warn "目录存在但不是 Git 仓库，将直接使用当前源码目录。"
    fi
  else
    if [[ -e "$PLUGIN_DIR" ]]; then
      if ! is_git_worktree "$PLUGIN_DIR"; then
        fail "目录已存在但不是 tickflow-assist Git 仓库：$PLUGIN_DIR"
      fi
    fi

    info "正在获取源码..."
    if $DRY_RUN; then
      dry "mkdir -p \"$(dirname "$PLUGIN_DIR")\""
      dry "git clone \"$REPO_URL\" \"$PLUGIN_DIR\""
    else
      mkdir -p "$(dirname "$PLUGIN_DIR")"
      git clone "$REPO_URL" "$PLUGIN_DIR"
    fi
  fi

  refresh_paths
  refresh_state
  if ! $DRY_RUN && [[ "$PLUGIN_SOURCE_READY" != "yes" ]]; then
    fail "源码目录初始化失败：$PLUGIN_DIR"
  fi
  success "源码已就绪: $PLUGIN_DIR"
}

install_dependencies_and_build() {
  echo ""
  info "安装依赖并构建..."
  if $DRY_RUN; then
    dry "cd \"$PLUGIN_DIR\" && npm install"
    dry "cd \"$PLUGIN_DIR/python\" && uv sync"
    dry "cd \"$PLUGIN_DIR\" && npm run build"
    return
  fi

  (
    cd "$PLUGIN_DIR"
    info "1) npm install..."
    npm install --loglevel=warn
    info "2) uv sync (python)..."
    cd python
    uv sync
    cd ..
    info "3) npm run build..."
    npm run build
  )
  success "依赖安装与构建完成"
  refresh_state
}

load_existing_config_defaults() {
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
}

apply_default_config_values() {
  TICKFLOW_KEY="$DEFAULT_TICKFLOW_KEY"
  TICKFLOW_LEVEL="$DEFAULT_TICKFLOW_LEVEL"
  LLM_BASE_URL="$DEFAULT_LLM_BASE_URL"
  LLM_API_KEY="$DEFAULT_LLM_KEY"
  LLM_MODEL="$DEFAULT_LLM_MODEL"
  ALERT_CHANNEL="$DEFAULT_ALERT_CHANNEL"
  ALERT_ACCOUNT="$DEFAULT_ALERT_ACCOUNT"
  ALERT_TARGET="$DEFAULT_ALERT_TARGET"
}

collect_configuration() {
  echo ""
  info "生成配置..."
  echo ""
  echo -e "${BOLD}--- TickFlow 配置 ---${NC}"
  echo "获取 TickFlow API Key：https://tickflow.org/auth/register?ref=BUJ54JEDGE"

  load_existing_config_defaults

  if [[ -n "$DEFAULT_TICKFLOW_KEY" ]]; then
    echo "当前 TickFlow API Key：[已保存过]"
    read -r -p "  输入新的 TickFlow API Key (直接回车保持不变): " TICKFLOW_KEY
    TICKFLOW_KEY=${TICKFLOW_KEY:-$DEFAULT_TICKFLOW_KEY}
  else
    read -r -p "  TickFlow API Key: " TICKFLOW_KEY
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
    read -r -p "  请选择等级 (1-4) [默认 ${DEFAULT_LEVEL_CHOICE}]: " LEVEL_CHOICE
    LEVEL_CHOICE=${LEVEL_CHOICE:-$DEFAULT_LEVEL_CHOICE}
    case "$LEVEL_CHOICE" in
      1) TICKFLOW_LEVEL="Free"; break ;;
      2) TICKFLOW_LEVEL="Start"; break ;;
      3) TICKFLOW_LEVEL="Pro"; break ;;
      4) TICKFLOW_LEVEL="Expert"; break ;;
      *) warn "无效选择，请输入 1-4。" ;;
    esac
  done
  success "已选择等级: $TICKFLOW_LEVEL"

  echo ""
  echo -e "${BOLD}--- LLM 配置 ---${NC}"
  read -r -p "  LLM API Base URL [默认 ${DEFAULT_LLM_BASE_URL}]: " LLM_BASE_URL
  LLM_BASE_URL=${LLM_BASE_URL:-$DEFAULT_LLM_BASE_URL}

  if [[ -n "$DEFAULT_LLM_KEY" ]]; then
    read -r -p "  LLM API Key (直接回车保持不变): " LLM_API_KEY
    LLM_API_KEY=${LLM_API_KEY:-$DEFAULT_LLM_KEY}
  else
    read -r -p "  LLM API Key: " LLM_API_KEY
    LLM_API_KEY=${LLM_API_KEY:-"YOUR_LLM_API_KEY"}
  fi

  read -r -p "  LLM 模型名 [默认 ${DEFAULT_LLM_MODEL}]: " LLM_MODEL
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
    read -r -p "  请选择推送通道 (1-3) [默认 ${DEFAULT_CHANNEL_CHOICE}]: " CH_CHOICE
    CH_CHOICE=${CH_CHOICE:-$DEFAULT_CHANNEL_CHOICE}
    case "$CH_CHOICE" in
      1) ALERT_CHANNEL="telegram"; break ;;
      2) ALERT_CHANNEL="qqbot"; break ;;
      3) ALERT_CHANNEL="wecom"; break ;;
      *) warn "无效选择，请输入 1-3。" ;;
    esac
  done
  success "已选择通道: $ALERT_CHANNEL"

  ALERT_ACCOUNT="$DEFAULT_ALERT_ACCOUNT"
  if [[ ( "$ALERT_CHANNEL" == "qqbot" || "$ALERT_CHANNEL" == "wecom" ) && -z "$ALERT_ACCOUNT" ]]; then
    ALERT_ACCOUNT="default"
  fi

  TARGET_HINT=$(alert_target_hint "$ALERT_CHANNEL")
  if [[ -n "$DEFAULT_ALERT_TARGET" ]]; then
    read -r -p "  告警投递目标 (${TARGET_HINT}，直接回车保持不变): " ALERT_TARGET
    ALERT_TARGET=${ALERT_TARGET:-$DEFAULT_ALERT_TARGET}
  else
    read -r -p "  告警投递目标 (${TARGET_HINT}): " ALERT_TARGET
    ALERT_TARGET=${ALERT_TARGET:-"YOUR_TARGET"}
  fi
}

write_local_config() {
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
    dry "生成本地配置 -> $LOCAL_CONFIG_PATH"
    return
  fi

  echo "$LOCAL_CONFIG" > "$LOCAL_CONFIG_PATH"
  success "生成本地配置 -> $LOCAL_CONFIG_PATH"
}

select_agent_tools_target() {
  AGENT_TOOLS_JSON="{}"
  SELECTED_AGENT_TYPE=""
  SELECTED_AGENT=""

  echo ""
  info "正在检查已有的 Agents..."
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

  if [[ -z "$AGENT_DISCOVERY" ]]; then
    info "未检测到可识别的 Agent 配置，跳过 tools 配置。"
    return
  fi

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

  read -r -p "  请选择要为哪个 Agent 写入推荐 tools 配置 (输入数字) [默认 1]: " AGENT_CHOICE
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
}

write_openclaw_config() {
  echo ""
  info "写入 openclaw.json..."

  if $DRY_RUN; then
    dry "mkdir -p \"$(dirname "$OPENCLAW_JSON")\""
  else
    mkdir -p "$(dirname "$OPENCLAW_JSON")"
  fi

  if [[ ! -f "$OPENCLAW_JSON" ]]; then
    if $DRY_RUN; then
      dry "echo '{}' > \"$OPENCLAW_JSON\""
    else
      echo '{}' > "$OPENCLAW_JSON"
    fi
  fi

  select_agent_tools_target

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

  BACKUP_FILE="$OPENCLAW_JSON.backup.$(date +%Y%m%d_%H%M%S)"
  if $DRY_RUN; then
    dry "cp \"$OPENCLAW_JSON\" \"$BACKUP_FILE\""
  else
    cp "$OPENCLAW_JSON" "$BACKUP_FILE"
  fi

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
    dry "更新 OpenClaw 配置文件 -> $OPENCLAW_JSON"
    return
  fi

  if echo "$MERGED" | jq empty >/dev/null 2>&1; then
    echo "$MERGED" > "$OPENCLAW_JSON"
    success "OpenClaw 配置文件已更新"
  else
    fail "JSON 合并失败，备份位于 $BACKUP_FILE"
  fi
}

register_plugin() {
  echo ""
  info "在 OpenClaw 中安装并启用插件..."
  if $DRY_RUN; then
    dry "openclaw plugins install -l \"$PLUGIN_DIR\""
    dry "openclaw plugins enable \"$PLUGIN_ID\""
    return
  fi

  "$OPENCLAW_CMD" plugins install -l "$PLUGIN_DIR"
  "$OPENCLAW_CMD" plugins enable "$PLUGIN_ID"
  success "插件已注册并启用"
}

restart_gateway() {
  echo ""
  info "重启 OpenClaw Gateway..."
  if $DRY_RUN; then
    dry "openclaw gateway restart"
    return
  fi

  if "$OPENCLAW_CMD" gateway restart 2>&1; then
    success "Gateway 重启成功"
  else
    warn "重启 Gateway 失败，可手动执行：openclaw gateway restart"
  fi
}

maybe_reconfigure_for_upgrade() {
  RECONFIGURE="yes"
  if [[ "$LOCAL_CONFIG_EXISTS" == "yes" || "$OPENCLAW_PLUGIN_CONFIGURED" == "yes" ]]; then
    read -r -p "检测到已有配置，是否重新填写配置？(y/N): " SHOULD_RECONFIGURE
    if [[ ! "${SHOULD_RECONFIGURE:-n}" =~ ^[yY]$ ]]; then
      RECONFIGURE="no"
    fi
  fi
}

disable_plugin_if_possible() {
  if [[ "$HAS_OPENCLAW" != "yes" ]]; then
    warn "当前未检测到 openclaw 命令，跳过插件 disable。"
    return
  fi

  if [[ "$OPENCLAW_PLUGIN_CONFIGURED" != "yes" ]]; then
    info "未检测到已写入的插件配置，跳过 disable。"
    return
  fi

  if $DRY_RUN; then
    dry "openclaw plugins disable \"$PLUGIN_ID\""
    return
  fi

  if "$OPENCLAW_CMD" plugins disable "$PLUGIN_ID" 2>&1; then
    success "插件已禁用"
  else
    warn "插件 disable 失败，可稍后手动执行：openclaw plugins disable $PLUGIN_ID"
  fi
}

remove_plugin_entry_from_openclaw_json() {
  if [[ "$HAS_JQ" != "yes" ]]; then
    fail "卸载流程需要 jq 来安全修改 openclaw.json。"
  fi

  if [[ ! -f "$OPENCLAW_JSON" ]]; then
    info "未找到 $OPENCLAW_JSON，跳过配置清理。"
    return
  fi

  BACKUP_FILE="$OPENCLAW_JSON.backup.$(date +%Y%m%d_%H%M%S)"
  if $DRY_RUN; then
    dry "cp \"$OPENCLAW_JSON\" \"$BACKUP_FILE\""
    dry "从 \"$OPENCLAW_JSON\" 删除 plugins.entries[\"$PLUGIN_ID\"]"
    return
  fi

  cp "$OPENCLAW_JSON" "$BACKUP_FILE"
  TMP_OPENCLAW_JSON="$OPENCLAW_JSON.tmp"
  jq '
    if .plugins.entries? then
      del(.plugins.entries["tickflow-assist"])
    else
      .
    end
    | if (.plugins.entries? | type) == "object" and (.plugins.entries | length) == 0 then
        .plugins |= del(.entries)
      else
        .
      end
    | if (.plugins? | type) == "object" and (.plugins | length) == 0 then
        del(.plugins)
      else
        .
      end
  ' "$OPENCLAW_JSON" > "$TMP_OPENCLAW_JSON"
  mv "$TMP_OPENCLAW_JSON" "$OPENCLAW_JSON"
  success "已从 openclaw.json 删除插件配置"
}

remove_local_config_if_confirmed() {
  if [[ ! -f "$LOCAL_CONFIG_PATH" ]]; then
    info "未检测到 local.config.json，跳过本地配置清理。"
    return
  fi

  read -r -p "是否删除本地调试配置 local.config.json？(Y/n): " REMOVE_LOCAL_CONFIG
  if [[ "${REMOVE_LOCAL_CONFIG:-y}" =~ ^[nN]$ ]]; then
    info "保留 $LOCAL_CONFIG_PATH"
    return
  fi

  if $DRY_RUN; then
    dry "rm -f \"$LOCAL_CONFIG_PATH\""
    return
  fi

  rm -f "$LOCAL_CONFIG_PATH"
  success "已删除 $LOCAL_CONFIG_PATH"
}

remove_project_dir_if_confirmed() {
  if [[ ! -d "$PLUGIN_DIR" ]]; then
    info "未检测到项目目录，跳过目录清理。"
    return
  fi

  read -r -p "是否删除整个项目目录（包含源码、node_modules、data）？(y/N): " REMOVE_PROJECT_DIR
  if [[ ! "${REMOVE_PROJECT_DIR:-n}" =~ ^[yY]$ ]]; then
    info "保留项目目录：$PLUGIN_DIR"
    return
  fi

  if $DRY_RUN; then
    dry "rm -rf \"$PLUGIN_DIR\""
    return
  fi

  rm -rf "$PLUGIN_DIR"
  success "已删除项目目录：$PLUGIN_DIR"
}

run_install_flow() {
  prompt_plugin_dir install
  refresh_state

  ensure_required_commands git node npm jq openclaw
  ensure_uv
  prepare_plugin_source
  install_dependencies_and_build

  collect_configuration
  write_local_config
  write_openclaw_config
  register_plugin
  restart_gateway

  echo ""
  success "安装完成"
  echo "  可在项目目录执行: npm run tool -- test_alert"
}

run_upgrade_flow() {
  prompt_plugin_dir upgrade
  refresh_state

  if [[ "$PLUGIN_SOURCE_READY" != "yes" && "$PLUGIN_GIT_READY" != "yes" ]]; then
    fail "未检测到可升级的项目目录，请先执行新安装。"
  fi

  ensure_required_commands git node npm jq openclaw
  ensure_uv
  prepare_plugin_source
  install_dependencies_and_build

  load_existing_config_defaults
  maybe_reconfigure_for_upgrade
  if [[ "$RECONFIGURE" == "yes" ]]; then
    collect_configuration
  else
    apply_default_config_values
    info "沿用现有配置，不重新提问。"
  fi

  write_local_config
  write_openclaw_config
  register_plugin
  restart_gateway

  echo ""
  success "升级完成"
}

run_uninstall_flow() {
  prompt_plugin_dir uninstall
  refresh_state

  echo ""
  warn "卸载流程只会自动清理插件配置与本地目录，不会自动回滚全局/Agent tools 合并结果。"
  read -r -p "确认开始卸载 tickflow-assist？(y/N): " CONFIRM_UNINSTALL
  if [[ ! "${CONFIRM_UNINSTALL:-n}" =~ ^[yY]$ ]]; then
    info "已取消卸载。"
    return
  fi

  disable_plugin_if_possible
  remove_plugin_entry_from_openclaw_json
  remove_local_config_if_confirmed
  remove_project_dir_if_confirmed

  if [[ "$HAS_OPENCLAW" == "yes" ]]; then
    read -r -p "是否立即重启 OpenClaw Gateway？(Y/n): " SHOULD_RESTART
    if [[ ! "${SHOULD_RESTART:-y}" =~ ^[nN]$ ]]; then
      restart_gateway
    fi
  fi

  echo ""
  success "卸载流程已完成"
}

refresh_paths
show_status_panel
SELECTED_ACTION=""
prompt_main_menu

case "$SELECTED_ACTION" in
  install)
    run_install_flow
    ;;
  upgrade)
    run_upgrade_flow
    ;;
  uninstall)
    run_uninstall_flow
    ;;
  exit)
    info "已退出。"
    ;;
esac
