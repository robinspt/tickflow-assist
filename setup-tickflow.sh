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
MIN_NODE_VERSION="22.16.0"
MIN_OPENCLAW_VERSION="2026.3.22"

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

trim_version_prefix() {
  local value="${1#v}"
  value="${value#V}"
  printf '%s\n' "$value"
}

extract_version_token() {
  local value="$1"
  printf '%s\n' "$value" | grep -Eo '[0-9]+(\.[0-9]+){2,3}' | head -n1 || true
}

version_gte() {
  local current="$(trim_version_prefix "$1")"
  local required="$(trim_version_prefix "$2")"
  local current_parts required_parts max_len idx current_part required_part

  IFS='.' read -r -a current_parts <<< "$current"
  IFS='.' read -r -a required_parts <<< "$required"
  max_len=${#current_parts[@]}
  if [[ ${#required_parts[@]} -gt $max_len ]]; then
    max_len=${#required_parts[@]}
  fi

  for ((idx = 0; idx < max_len; idx++)); do
    current_part=${current_parts[$idx]:-0}
    required_part=${required_parts[$idx]:-0}
    ((10#$current_part > 10#$required_part)) && return 0
    ((10#$current_part < 10#$required_part)) && return 1
  done

  return 0
}

detect_node_version() {
  command_installed node || return 1
  node --version 2>/dev/null | tr -d '[:space:]'
}

detect_openclaw_version() {
  local openclaw_cmd="$1"
  local raw=""

  [[ -z "$openclaw_cmd" ]] && return 1
  raw=$("$openclaw_cmd" --version 2>/dev/null | head -n1 || true)
  extract_version_token "$raw"
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
    discord) printf '%s' "Discord user:User id" ;;
    qqbot) printf '%s' "qqbot:c2c:OPENID" ;;
    wecom) printf '%s' "企业微信 userId（单聊）/ chatId 或群 ID（群聊）" ;;
    *) printf '%s' "OpenClaw target" ;;
  esac
}

prompt_manual_alert_channel() {
  echo "  1) telegram   (默认 / Default)"
  echo "  2) discord"
  echo "  3) qqbot"
  echo "  4) wecom"
  DEFAULT_CHANNEL_CHOICE=1
  case "$DEFAULT_ALERT_CHANNEL" in
    discord) DEFAULT_CHANNEL_CHOICE=2 ;;
    qqbot) DEFAULT_CHANNEL_CHOICE=3 ;;
    wecom) DEFAULT_CHANNEL_CHOICE=4 ;;
    *) DEFAULT_CHANNEL_CHOICE=1 ;;
  esac
  while true; do
    read -r -p "  请选择推送通道 (1-4) [默认 ${DEFAULT_CHANNEL_CHOICE}]: " CH_CHOICE
    CH_CHOICE=${CH_CHOICE:-$DEFAULT_CHANNEL_CHOICE}
    case "$CH_CHOICE" in
      1) ALERT_CHANNEL="telegram"; return 0 ;;
      2) ALERT_CHANNEL="discord"; return 0 ;;
      3) ALERT_CHANNEL="qqbot"; return 0 ;;
      4) ALERT_CHANNEL="wecom"; return 0 ;;
      *) warn "无效选择，请输入 1-4。" ;;
    esac
  done
}

discover_configured_alert_channels() {
  if [[ "$HAS_JQ" != "yes" ]] || [[ ! -f "$OPENCLAW_JSON" ]]; then
    return 0
  fi

  jq -r '
    (.channels // {})
    | to_entries[]
    | select(.value | type == "object")
    | select((.value.enabled // true) == true)
    | .key as $channel
    | if (.value.accounts? | type) == "object" and ((.value.accounts | keys | length) > 0) then
        [
          .value.accounts
          | to_entries[]
          | select(.value | type == "object")
          | select((.value.enabled // true) == true)
          | .key
        ] as $accounts
        | select(($accounts | length) > 0)
        | "\($channel)|\($accounts | join(","))"
      else
        select((.value.enabled // true) == true)
        | "\($channel)|"
      end
  ' "$OPENCLAW_JSON" 2>/dev/null || true
}

discover_channel_accounts() {
  local channel="$1"

  if [[ "$HAS_JQ" != "yes" ]] || [[ ! -f "$OPENCLAW_JSON" ]]; then
    return 0
  fi

  jq -r --arg channel "$channel" '
    if ((.channels[$channel].enabled // true) == true) then
      (.channels[$channel].accounts // {})
    else
      {}
    end
    | if type == "object" then
        to_entries[]
        | select(.value | type == "object")
        | select((.value.enabled // true) == true)
        | .key
      else
        empty
      end
  ' "$OPENCLAW_JSON" 2>/dev/null || true
}

select_alert_account_for_channel() {
  local channel="$1"
  local configured_default_account=""
  local default_choice=1
  local idx=0
  local account=""

  if [[ "$DEFAULT_ALERT_CHANNEL" == "$channel" ]]; then
    configured_default_account="$DEFAULT_ALERT_ACCOUNT"
  fi

  mapfile -t ALERT_CHANNEL_ACCOUNTS < <(discover_channel_accounts "$channel")

  if [[ ${#ALERT_CHANNEL_ACCOUNTS[@]} -eq 0 ]]; then
    ALERT_ACCOUNT="$configured_default_account"
    if [[ -z "$ALERT_ACCOUNT" && ( "$channel" == "qqbot" || "$channel" == "wecom" ) ]]; then
      ALERT_ACCOUNT="default"
    fi
    return 0
  fi

  if [[ ${#ALERT_CHANNEL_ACCOUNTS[@]} -eq 1 ]]; then
    ALERT_ACCOUNT="${ALERT_CHANNEL_ACCOUNTS[0]}"
    success "已选择账号: $ALERT_ACCOUNT"
    return 0
  fi

  echo "  检测到该通道已配置多个账号："
  for account in "${ALERT_CHANNEL_ACCOUNTS[@]}"; do
    idx=$((idx + 1))
    echo "  ${idx}) ${account}"
    if [[ -n "$configured_default_account" && "$account" == "$configured_default_account" ]]; then
      default_choice=$idx
    fi
  done

  while true; do
    read -r -p "  请选择账号 (1-${#ALERT_CHANNEL_ACCOUNTS[@]}) [默认 ${default_choice}]: " ACCOUNT_CHOICE
    ACCOUNT_CHOICE=${ACCOUNT_CHOICE:-$default_choice}
    if [[ "$ACCOUNT_CHOICE" =~ ^[0-9]+$ ]] && [[ "$ACCOUNT_CHOICE" -ge 1 ]] && [[ "$ACCOUNT_CHOICE" -le ${#ALERT_CHANNEL_ACCOUNTS[@]} ]]; then
      ALERT_ACCOUNT="${ALERT_CHANNEL_ACCOUNTS[$((ACCOUNT_CHOICE - 1))]}"
      success "已选择账号: $ALERT_ACCOUNT"
      return 0
    fi
    warn "无效选择，请输入 1-${#ALERT_CHANNEL_ACCOUNTS[@]}。"
  done
}

prompt_alert_channel_from_openclaw_config() {
  local idx=0
  local manual_choice=0
  local default_choice=1
  local line=""
  local channel=""
  local accounts=""
  local label=""

  mapfile -t CONFIGURED_ALERT_CHANNEL_LINES < <(discover_configured_alert_channels)
  if [[ ${#CONFIGURED_ALERT_CHANNEL_LINES[@]} -eq 0 ]]; then
    return 1
  fi

  echo "  检测到 openclaw.json 中已有通道配置："
  ALERT_CHANNEL_OPTIONS=()
  for line in "${CONFIGURED_ALERT_CHANNEL_LINES[@]}"; do
    channel="${line%%|*}"
    accounts="${line#*|}"
    idx=$((idx + 1))
    ALERT_CHANNEL_OPTIONS+=("$channel")
    if [[ -n "$accounts" ]]; then
      label="${channel} (accounts: ${accounts})"
    else
      label="$channel"
    fi
    echo "  ${idx}) ${label}"
    if [[ "$channel" == "$DEFAULT_ALERT_CHANNEL" ]]; then
      default_choice=$idx
    fi
  done

  manual_choice=$((idx + 1))
  echo "  ${manual_choice}) 重新输入其他通道"

  while true; do
    read -r -p "  请选择推送通道 (1-${manual_choice}) [默认 ${default_choice}]: " CHANNEL_SELECT
    CHANNEL_SELECT=${CHANNEL_SELECT:-$default_choice}
    if [[ "$CHANNEL_SELECT" == "$manual_choice" ]]; then
      return 1
    fi
    if [[ "$CHANNEL_SELECT" =~ ^[0-9]+$ ]] && [[ "$CHANNEL_SELECT" -ge 1 ]] && [[ "$CHANNEL_SELECT" -le ${#ALERT_CHANNEL_OPTIONS[@]} ]]; then
      ALERT_CHANNEL="${ALERT_CHANNEL_OPTIONS[$((CHANNEL_SELECT - 1))]}"
      select_alert_account_for_channel "$ALERT_CHANNEL"
      return 0
    fi
    warn "无效选择，请输入 1-${manual_choice}。"
  done
}

parent_dir() {
  local path="$1"
  dirname "$path"
}

canonicalize_dir_path() {
  local path="$1"
  if [[ -d "$path" ]]; then
    (
      cd "$path" >/dev/null 2>&1 && pwd -P
    )
  fi
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
  NODE_VERSION_VALUE=""
  NODE_VERSION_OK="unknown"
  OPENCLAW_VERSION_VALUE=""
  OPENCLAW_VERSION_OK="unknown"

  command_installed git && HAS_GIT="yes"
  command_installed node && HAS_NODE="yes"
  if [[ "$HAS_NODE" == "yes" ]]; then
    NODE_VERSION_VALUE=$(detect_node_version || true)
    if [[ -n "$NODE_VERSION_VALUE" ]]; then
      if version_gte "$NODE_VERSION_VALUE" "$MIN_NODE_VERSION"; then
        NODE_VERSION_OK="yes"
      else
        NODE_VERSION_OK="no"
      fi
    fi
  fi
  command_installed npm && HAS_NPM="yes"
  command_installed uv && HAS_UV="yes"
  command_installed jq && HAS_JQ="yes"
  maybe_fix_openclaw_path >/dev/null 2>&1 || true
  if OPENCLAW_CMD="$(resolve_openclaw_command)"; then
    HAS_OPENCLAW="yes"
    OPENCLAW_VERSION_VALUE=$(detect_openclaw_version "$OPENCLAW_CMD" || true)
    if [[ -n "$OPENCLAW_VERSION_VALUE" ]]; then
      if version_gte "$OPENCLAW_VERSION_VALUE" "$MIN_OPENCLAW_VERSION"; then
        OPENCLAW_VERSION_OK="yes"
      else
        OPENCLAW_VERSION_OK="no"
      fi
    fi
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
  print_status_row "node" "$HAS_NODE" "${NODE_VERSION_VALUE:-}"
  print_status_row "npm" "$HAS_NPM"
  print_status_row "uv" "$HAS_UV"
  print_status_row "jq" "$HAS_JQ"
  print_status_row "openclaw" "$HAS_OPENCLAW" "${OPENCLAW_VERSION_VALUE:-${OPENCLAW_PATH_HINT:-}}"
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
  if [[ "$NODE_VERSION_OK" == "no" ]]; then
    warn "检测到 Node ${NODE_VERSION_VALUE}。TickFlow Assist 0.2.0 面向 OpenClaw v${MIN_OPENCLAW_VERSION}+，建议 Node >= ${MIN_NODE_VERSION}。"
    echo ""
  fi
  if [[ "$OPENCLAW_VERSION_OK" == "no" ]]; then
    warn "检测到 OpenClaw ${OPENCLAW_VERSION_VALUE}。TickFlow Assist 0.2.0 仅支持 OpenClaw >= v${MIN_OPENCLAW_VERSION}。"
    echo ""
  fi
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

ensure_supported_runtime_versions() {
  refresh_state

  if [[ "$NODE_VERSION_OK" == "no" ]]; then
    fail "当前 Node 版本 ${NODE_VERSION_VALUE} 过低。请升级到 >= ${MIN_NODE_VERSION} 后再安装/升级 TickFlow Assist 0.2.0。"
  fi

  if [[ "$OPENCLAW_VERSION_OK" == "no" ]]; then
    fail "当前 OpenClaw 版本 ${OPENCLAW_VERSION_VALUE:-unknown} 过低。TickFlow Assist 0.2.0 需要 OpenClaw >= v${MIN_OPENCLAW_VERSION}。请先升级 OpenClaw。"
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

has_chinese_fonts() {
  command_installed fc-list || return 1
  fc-list :lang=zh family 2>/dev/null | grep -q .
}

detect_linux_distro() {
  local ids=()
  local id_like=""

  if [[ ! -f /etc/os-release ]]; then
    printf '%s\n' "unknown"
    return 0
  fi

  # shellcheck disable=SC1091
  . /etc/os-release
  ids+=("${ID:-}")
  id_like="${ID_LIKE:-}"
  if [[ -n "$id_like" ]]; then
    # shellcheck disable=SC2206
    ids+=($id_like)
  fi

  for item in "${ids[@]}"; do
    case "${item,,}" in
      debian|ubuntu) printf '%s\n' "debian"; return 0 ;;
      rhel|fedora|centos|rocky|almalinux) printf '%s\n' "rhel"; return 0 ;;
      arch|manjaro) printf '%s\n' "arch"; return 0 ;;
      alpine) printf '%s\n' "alpine"; return 0 ;;
    esac
  done

  printf '%s\n' "unknown"
}

run_font_setup_command() {
  local description="$1"
  shift

  if $DRY_RUN; then
    dry "$*"
    return 0
  fi

  info "$description"
  if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
    "$@"
  elif command_installed sudo; then
    sudo "$@"
  else
    return 1
  fi
}

print_manual_font_help() {
  local distro="$1"
  warn "自动安装中文字体失败，PNG 告警卡中的中文可能显示异常。"
  echo "  可手动执行："
  case "$distro" in
    debian)
      echo "    sudo apt-get update"
      echo "    sudo apt-get install -y fontconfig fonts-noto-cjk"
      echo "    fc-cache -fv"
      ;;
    rhel)
      echo "    sudo dnf install -y fontconfig google-noto-sans-cjk-ttc-fonts"
      echo "    fc-cache -fv"
      ;;
    arch)
      echo "    sudo pacman -Sy --noconfirm fontconfig noto-fonts-cjk"
      echo "    fc-cache -fv"
      ;;
    alpine)
      echo "    sudo apk add fontconfig font-noto-cjk"
      echo "    fc-cache -fv"
      ;;
    *)
      echo "    请安装 fontconfig 和任意可用的中文字体包（例如 Noto Sans CJK）"
      echo "    安装后执行: fc-cache -fv"
      ;;
  esac
}

ensure_alert_fonts() {
  local distro="unknown"
  local attempted="no"

  if [[ "${OSTYPE:-}" != linux* ]]; then
    return 0
  fi

  if has_chinese_fonts; then
    success "已检测到中文字体，可正常渲染 PNG 告警卡"
    return 0
  fi

  distro=$(detect_linux_distro)
  warn "未检测到可用的中文字体，开始尝试安装 Noto CJK 字体（用于 PNG 告警卡）..."

  case "$distro" in
    debian)
      attempted="yes"
      run_font_setup_command "更新 apt 软件索引..." apt-get update || true
      run_font_setup_command "安装 fontconfig 与 Noto CJK 字体..." apt-get install -y fontconfig fonts-noto-cjk || true
      ;;
    rhel)
      attempted="yes"
      if command_installed dnf; then
        run_font_setup_command "安装 fontconfig 与 Noto CJK 字体..." dnf install -y fontconfig google-noto-sans-cjk-ttc-fonts || true
        if ! has_chinese_fonts; then
          run_font_setup_command "尝试备用字体包..." dnf install -y fontconfig google-noto-cjk-fonts || true
        fi
      elif command_installed yum; then
        run_font_setup_command "安装 fontconfig 与 Noto CJK 字体..." yum install -y fontconfig google-noto-sans-cjk-ttc-fonts || true
        if ! has_chinese_fonts; then
          run_font_setup_command "尝试备用字体包..." yum install -y fontconfig google-noto-cjk-fonts || true
        fi
      fi
      ;;
    arch)
      attempted="yes"
      run_font_setup_command "安装 fontconfig 与 Noto CJK 字体..." pacman -Sy --noconfirm fontconfig noto-fonts-cjk || true
      ;;
    alpine)
      attempted="yes"
      run_font_setup_command "安装 fontconfig 与 Noto CJK 字体..." apk add fontconfig font-noto-cjk || true
      ;;
  esac

  if command_installed fc-cache; then
    if $DRY_RUN; then
      dry "fc-cache -fv"
    else
      fc-cache -fv >/dev/null 2>&1 || true
    fi
  fi

  if has_chinese_fonts || $DRY_RUN; then
    success "中文字体已就绪（PNG 告警卡）"
    return 0
  fi

  if [[ "$attempted" == "no" ]]; then
    warn "当前系统发行版未匹配到自动安装方案。"
  fi
  print_manual_font_help "$distro"
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
    dry "install Chinese fonts for PNG alerts if missing"
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
    info "3) ensure Chinese fonts for PNG alerts..."
    ensure_alert_fonts
    info "4) npm run build..."
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
  EXISTING_LOCAL_MX_SEARCH_API_URL=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.mxSearchApiUrl')
  EXISTING_LOCAL_MX_SEARCH_API_KEY=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.mxSearchApiKey')
  EXISTING_LOCAL_JIN10_MCP_URL=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.jin10McpUrl')
  EXISTING_LOCAL_JIN10_API_TOKEN=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.jin10ApiToken')
  EXISTING_LOCAL_JIN10_FLASH_POLL_INTERVAL=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.jin10FlashPollInterval')
  EXISTING_LOCAL_JIN10_FLASH_RETENTION_DAYS=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.jin10FlashRetentionDays')
  EXISTING_LOCAL_JIN10_FLASH_NIGHT_ALERT=$(read_json_compact "$LOCAL_CONFIG_PATH" 'if (.plugin? | type) == "object" and (.plugin | has("jin10FlashNightAlert")) then .plugin.jin10FlashNightAlert else empty end')
  EXISTING_LOCAL_LLM_BASE_URL=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.llmBaseUrl')
  EXISTING_LOCAL_LLM_KEY=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.llmApiKey')
  EXISTING_LOCAL_LLM_MODEL=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.llmModel')
  EXISTING_LOCAL_REQUEST_INTERVAL=$(read_json_value "$LOCAL_CONFIG_PATH" '.plugin.requestInterval')
  EXISTING_LOCAL_DAILY_UPDATE_NOTIFY=$(read_json_compact "$LOCAL_CONFIG_PATH" 'if (.plugin? | type) == "object" and (.plugin | has("dailyUpdateNotify")) then .plugin.dailyUpdateNotify else empty end')
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
  EXISTING_OPENCLAW_MX_SEARCH_API_URL=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.mxSearchApiUrl')
  EXISTING_OPENCLAW_MX_SEARCH_API_KEY=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.mxSearchApiKey')
  EXISTING_OPENCLAW_JIN10_MCP_URL=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.jin10McpUrl')
  EXISTING_OPENCLAW_JIN10_API_TOKEN=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.jin10ApiToken')
  EXISTING_OPENCLAW_JIN10_FLASH_POLL_INTERVAL=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.jin10FlashPollInterval')
  EXISTING_OPENCLAW_JIN10_FLASH_RETENTION_DAYS=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.jin10FlashRetentionDays')
  EXISTING_OPENCLAW_JIN10_FLASH_NIGHT_ALERT=$(read_json_compact "$OPENCLAW_JSON" 'if (.plugins.entries["tickflow-assist"].config? | type) == "object" and (.plugins.entries["tickflow-assist"].config | has("jin10FlashNightAlert")) then .plugins.entries["tickflow-assist"].config.jin10FlashNightAlert else empty end')
  EXISTING_OPENCLAW_LLM_BASE_URL=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.llmBaseUrl')
  EXISTING_OPENCLAW_LLM_KEY=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.llmApiKey')
  EXISTING_OPENCLAW_LLM_MODEL=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.llmModel')
  EXISTING_OPENCLAW_REQUEST_INTERVAL=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.requestInterval')
  EXISTING_OPENCLAW_DAILY_UPDATE_NOTIFY=$(read_json_compact "$OPENCLAW_JSON" 'if (.plugins.entries["tickflow-assist"].config? | type) == "object" and (.plugins.entries["tickflow-assist"].config | has("dailyUpdateNotify")) then .plugins.entries["tickflow-assist"].config.dailyUpdateNotify else empty end')
  EXISTING_OPENCLAW_ALERT_CHANNEL=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.alertChannel')
  EXISTING_OPENCLAW_ALERT_ACCOUNT=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.alertAccount')
  EXISTING_OPENCLAW_ALERT_TARGET=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.alertTarget')
  EXISTING_OPENCLAW_OPENCLAW_BIN=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.openclawCliBin')
  EXISTING_OPENCLAW_PYTHON_BIN=$(read_json_value "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.pythonBin')
  EXISTING_OPENCLAW_PYTHON_ARGS=$(read_json_compact "$OPENCLAW_JSON" '.plugins.entries["tickflow-assist"].config.pythonArgs // ["run","python"]')

  DEFAULT_TICKFLOW_API_URL=${EXISTING_LOCAL_TICKFLOW_API_URL:-${EXISTING_OPENCLAW_TICKFLOW_API_URL:-https://api.tickflow.org}}
  DEFAULT_TICKFLOW_KEY=${EXISTING_LOCAL_TICKFLOW_KEY:-$EXISTING_OPENCLAW_TICKFLOW_KEY}
  DEFAULT_TICKFLOW_LEVEL=${EXISTING_LOCAL_TICKFLOW_LEVEL:-${EXISTING_OPENCLAW_TICKFLOW_LEVEL:-Free}}
  DEFAULT_MX_SEARCH_API_URL=${EXISTING_LOCAL_MX_SEARCH_API_URL:-${EXISTING_OPENCLAW_MX_SEARCH_API_URL:-https://mkapi2.dfcfs.com/finskillshub/api/claw}}
  DEFAULT_MX_SEARCH_API_KEY=${EXISTING_LOCAL_MX_SEARCH_API_KEY:-$EXISTING_OPENCLAW_MX_SEARCH_API_KEY}
  DEFAULT_JIN10_MCP_URL=${EXISTING_LOCAL_JIN10_MCP_URL:-${EXISTING_OPENCLAW_JIN10_MCP_URL:-https://mcp.jin10.com/mcp}}
  DEFAULT_JIN10_API_TOKEN=${EXISTING_LOCAL_JIN10_API_TOKEN:-$EXISTING_OPENCLAW_JIN10_API_TOKEN}
  DEFAULT_JIN10_FLASH_POLL_INTERVAL=${EXISTING_LOCAL_JIN10_FLASH_POLL_INTERVAL:-${EXISTING_OPENCLAW_JIN10_FLASH_POLL_INTERVAL:-300}}
  DEFAULT_JIN10_FLASH_RETENTION_DAYS=${EXISTING_LOCAL_JIN10_FLASH_RETENTION_DAYS:-${EXISTING_OPENCLAW_JIN10_FLASH_RETENTION_DAYS:-7}}
  DEFAULT_JIN10_FLASH_NIGHT_ALERT=${EXISTING_LOCAL_JIN10_FLASH_NIGHT_ALERT:-${EXISTING_OPENCLAW_JIN10_FLASH_NIGHT_ALERT:-false}}
  DEFAULT_LLM_BASE_URL=${EXISTING_LOCAL_LLM_BASE_URL:-${EXISTING_OPENCLAW_LLM_BASE_URL:-https://api.openai.com/v1}}
  DEFAULT_LLM_KEY=${EXISTING_LOCAL_LLM_KEY:-$EXISTING_OPENCLAW_LLM_KEY}
  DEFAULT_LLM_MODEL=${EXISTING_LOCAL_LLM_MODEL:-${EXISTING_OPENCLAW_LLM_MODEL:-gpt-4o}}
  DEFAULT_REQUEST_INTERVAL=${EXISTING_LOCAL_REQUEST_INTERVAL:-${EXISTING_OPENCLAW_REQUEST_INTERVAL:-30}}
  DEFAULT_DAILY_UPDATE_NOTIFY=${EXISTING_LOCAL_DAILY_UPDATE_NOTIFY:-${EXISTING_OPENCLAW_DAILY_UPDATE_NOTIFY:-true}}
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
  MX_SEARCH_API_URL="$DEFAULT_MX_SEARCH_API_URL"
  MX_SEARCH_API_KEY="$DEFAULT_MX_SEARCH_API_KEY"
  JIN10_MCP_URL="$DEFAULT_JIN10_MCP_URL"
  JIN10_API_TOKEN="$DEFAULT_JIN10_API_TOKEN"
  JIN10_FLASH_POLL_INTERVAL="$DEFAULT_JIN10_FLASH_POLL_INTERVAL"
  JIN10_FLASH_RETENTION_DAYS="$DEFAULT_JIN10_FLASH_RETENTION_DAYS"
  JIN10_FLASH_NIGHT_ALERT="$DEFAULT_JIN10_FLASH_NIGHT_ALERT"
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
  echo -e "${BOLD}--- 东方财富妙想 Skills 配置（可选） ---${NC}"
  echo "获取 API Key：https://marketing.dfcfs.com/views/finskillshub/"
  echo "用于 mx_search / mx_select_stock；当前每个技能每日限额 50 次。"
  read -r -p "  妙想 Skills 接口基础地址 [默认 ${DEFAULT_MX_SEARCH_API_URL}]: " MX_SEARCH_API_URL
  MX_SEARCH_API_URL=${MX_SEARCH_API_URL:-$DEFAULT_MX_SEARCH_API_URL}

  if [[ -n "$DEFAULT_MX_SEARCH_API_KEY" ]]; then
    echo "当前妙想 Skills API Key：[已保存过]"
    read -r -p "  输入新的妙想 Skills API Key (直接回车保持不变): " MX_SEARCH_API_KEY
    MX_SEARCH_API_KEY=${MX_SEARCH_API_KEY:-$DEFAULT_MX_SEARCH_API_KEY}
  else
    read -r -p "  妙想 Skills API Key（可选，直接回车跳过）: " MX_SEARCH_API_KEY
    MX_SEARCH_API_KEY=${MX_SEARCH_API_KEY:-}
  fi

  echo ""
  echo -e "${BOLD}--- Jin10 快讯监控配置（可选） ---${NC}"
  read -r -p "  Jin10 MCP 地址 [默认 ${DEFAULT_JIN10_MCP_URL}]: " JIN10_MCP_URL
  JIN10_MCP_URL=${JIN10_MCP_URL:-$DEFAULT_JIN10_MCP_URL}

  if [[ -n "$DEFAULT_JIN10_API_TOKEN" ]]; then
    echo "当前 Jin10 API Token：[已保存过]"
    read -r -p "  输入新的 Jin10 API Token（直接回车保持不变，可留空禁用）: " JIN10_API_TOKEN
    JIN10_API_TOKEN=${JIN10_API_TOKEN:-$DEFAULT_JIN10_API_TOKEN}
  else
    read -r -p "  Jin10 API Token（可选，直接回车跳过）: " JIN10_API_TOKEN
    JIN10_API_TOKEN=${JIN10_API_TOKEN:-}
  fi

  read -r -p "  Jin10 快讯轮询间隔秒数 [默认 ${DEFAULT_JIN10_FLASH_POLL_INTERVAL}]: " JIN10_FLASH_POLL_INTERVAL
  JIN10_FLASH_POLL_INTERVAL=${JIN10_FLASH_POLL_INTERVAL:-$DEFAULT_JIN10_FLASH_POLL_INTERVAL}

  read -r -p "  Jin10 快讯保留天数 [默认 ${DEFAULT_JIN10_FLASH_RETENTION_DAYS}]: " JIN10_FLASH_RETENTION_DAYS
  JIN10_FLASH_RETENTION_DAYS=${JIN10_FLASH_RETENTION_DAYS:-$DEFAULT_JIN10_FLASH_RETENTION_DAYS}

  echo ""
  echo -e "  ${BOLD}Jin10 夜间静默${NC}"
  echo "  1) 关闭夜间静默（24小时告警）"
  echo "  2) 开启夜间静默（22:00~06:00 不告警）"
  if [[ "$DEFAULT_JIN10_FLASH_NIGHT_ALERT" == "true" ]]; then
    DEFAULT_NIGHT_ALERT_CHOICE=1
  else
    DEFAULT_NIGHT_ALERT_CHOICE=2
  fi
  while true; do
    read -r -p "  请选择 (1-2) [默认 ${DEFAULT_NIGHT_ALERT_CHOICE}]: " NIGHT_ALERT_CHOICE
    NIGHT_ALERT_CHOICE=${NIGHT_ALERT_CHOICE:-$DEFAULT_NIGHT_ALERT_CHOICE}
    case "$NIGHT_ALERT_CHOICE" in
      1) JIN10_FLASH_NIGHT_ALERT="true"; break ;;
      2) JIN10_FLASH_NIGHT_ALERT="false"; break ;;
      *) warn "无效选择，请输入 1-2。" ;;
    esac
  done

  echo ""
  echo -e "${BOLD}--- LLM 配置 ---${NC}"
  read -r -p "  LLM API Base URL [默认 ${DEFAULT_LLM_BASE_URL}]: " LLM_BASE_URL
  LLM_BASE_URL=${LLM_BASE_URL:-$DEFAULT_LLM_BASE_URL}

  if [[ -n "$DEFAULT_LLM_KEY" ]]; then
    read -r -p "  LLM API Key (vLLM / Ollama 可随便填；直接回车保持不变): " LLM_API_KEY
    LLM_API_KEY=${LLM_API_KEY:-$DEFAULT_LLM_KEY}
  else
    read -r -p "  LLM API Key (vLLM / Ollama 可随便填): " LLM_API_KEY
    LLM_API_KEY=${LLM_API_KEY:-"YOUR_LLM_API_KEY"}
  fi

  read -r -p "  LLM 模型名 [默认 ${DEFAULT_LLM_MODEL}]: " LLM_MODEL
  LLM_MODEL=${LLM_MODEL:-$DEFAULT_LLM_MODEL}

  echo ""
  echo -e "${BOLD}--- 告警投递配置 ---${NC}"
  if ! prompt_alert_channel_from_openclaw_config; then
    prompt_manual_alert_channel
    select_alert_account_for_channel "$ALERT_CHANNEL"
  fi
  success "已选择通道: $ALERT_CHANNEL"

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
    --arg mxUrl "$MX_SEARCH_API_URL" \
    --arg mxKey "$MX_SEARCH_API_KEY" \
    --arg jin10Url "$JIN10_MCP_URL" \
    --arg jin10Token "$JIN10_API_TOKEN" \
    --argjson jin10PollInt "$JIN10_FLASH_POLL_INTERVAL" \
    --argjson jin10Retention "$JIN10_FLASH_RETENTION_DAYS" \
    --argjson jin10NightAlert "$JIN10_FLASH_NIGHT_ALERT" \
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
        mxSearchApiUrl: $mxUrl,
        mxSearchApiKey: $mxKey,
        jin10McpUrl: $jin10Url,
        jin10ApiToken: $jin10Token,
        jin10FlashPollInterval: $jin10PollInt,
        jin10FlashRetentionDays: $jin10Retention,
        jin10FlashNightAlert: $jin10NightAlert,
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

    AGENT_TOOLS_JSON='{"profile":"full","allow":["tickflow-assist"],"deny":[]}'
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
    --arg mxUrl "$MX_SEARCH_API_URL" \
    --arg mxKey "$MX_SEARCH_API_KEY" \
    --arg jin10Url "$JIN10_MCP_URL" \
    --arg jin10Token "$JIN10_API_TOKEN" \
    --argjson jin10PollInt "$JIN10_FLASH_POLL_INTERVAL" \
    --argjson jin10Retention "$JIN10_FLASH_RETENTION_DAYS" \
    --argjson jin10NightAlert "$JIN10_FLASH_NIGHT_ALERT" \
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
        mxSearchApiUrl: $mxUrl,
        mxSearchApiKey: $mxKey,
        jin10McpUrl: $jin10Url,
        jin10ApiToken: $jin10Token,
        jin10FlashPollInterval: $jin10PollInt,
        jin10FlashRetentionDays: $jin10Retention,
        jin10FlashNightAlert: $jin10NightAlert,
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
    --arg plugin_id "$PLUGIN_ID" \
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

    def object_keys($value):
      if ($value | type) == "object" then
        ($value | keys)
      else
        []
      end;

    (.agents.defaults.tools // {}) as $legacyDefaultTools |
    .plugins //= {} |
    .plugins.enabled = (.plugins.enabled // true) |
    .plugins.entries //= {} |
    .plugins.entries["tickflow-assist"] = $pcfg |
    .plugins.allow = (
      if (.plugins.allow? | type) == "array" and (.plugins.allow | length) > 0 then
        (
          .plugins.allow
          + [$plugin_id]
        )
      else
        (
          object_keys(.plugins.entries)
          + object_keys(.plugins.installs)
          + [$plugin_id]
        )
      end
      | unique
    ) |
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
    read -r -p "检测到已有配置，是否重新填写配置？(Y/n): " SHOULD_RECONFIGURE
    if [[ "${SHOULD_RECONFIGURE:-y}" =~ ^[nN]$ ]]; then
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
  local plugin_dir_real=""

  if [[ "$HAS_JQ" != "yes" ]]; then
    fail "卸载流程需要 jq 来安全修改 openclaw.json。"
  fi

  if [[ ! -f "$OPENCLAW_JSON" ]]; then
    info "未找到 $OPENCLAW_JSON，跳过配置清理。"
    return
  fi

  plugin_dir_real=$(canonicalize_dir_path "$PLUGIN_DIR" || true)
  BACKUP_FILE="$OPENCLAW_JSON.backup.$(date +%Y%m%d_%H%M%S)"
  if $DRY_RUN; then
    dry "cp \"$OPENCLAW_JSON\" \"$BACKUP_FILE\""
    dry "从 \"$OPENCLAW_JSON\" 删除 plugins.entries / plugins.allow / plugins.installs / plugins.load.paths 中的 \"$PLUGIN_ID\" 相关配置"
    return
  fi

  cp "$OPENCLAW_JSON" "$BACKUP_FILE"
  TMP_OPENCLAW_JSON="$OPENCLAW_JSON.tmp"
  jq --arg plugin_id "$PLUGIN_ID" --arg plugin_dir "$PLUGIN_DIR" --arg plugin_dir_real "$plugin_dir_real" '
    def normalize_path:
      tostring | sub("/+$"; "");

    if .plugins.entries? then
      del(.plugins.entries[$plugin_id])
    else
      .
    end
    | if (.plugins.allow? | type) == "array" then
        .plugins.allow = (.plugins.allow | map(select(. != $plugin_id)))
      else
        .
      end
    | if .plugins.installs? then
        del(.plugins.installs[$plugin_id])
      else
        .
      end
    | if (.plugins.load.paths? | type) == "array" then
        .plugins.load.paths = (
          .plugins.load.paths
          | map(
              select(
                ((. | normalize_path) != ($plugin_dir | normalize_path))
                and (
                  ($plugin_dir_real | length) == 0
                  or ((. | normalize_path) != ($plugin_dir_real | normalize_path))
                )
              )
            )
        )
      else
        .
      end
    | if (.plugins.entries? | type) == "object" and (.plugins.entries | length) == 0 then
        .plugins |= del(.entries)
      else
        .
      end
    | if (.plugins.load.paths? | type) == "array" and (.plugins.load.paths | length) == 0 then
        .plugins.load |= . + { paths: [] }
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
  local plugin_dir_real=""

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

  plugin_dir_real=$(canonicalize_dir_path "$PLUGIN_DIR" || true)
  cd "$HOME" >/dev/null 2>&1 || true
  rm -rf "$PLUGIN_DIR"

  if [[ -e "$PLUGIN_DIR" ]]; then
    warn "目录仍存在，请手动检查：$PLUGIN_DIR"
    return
  fi

  if [[ -n "$plugin_dir_real" && -e "$plugin_dir_real" ]]; then
    warn "目录真实路径仍存在，请手动检查：$plugin_dir_real"
    return
  fi

  success "已删除项目目录：$PLUGIN_DIR"
}

run_install_flow() {
  prompt_plugin_dir install
  refresh_state

  ensure_required_commands git node npm jq openclaw
  ensure_supported_runtime_versions
  ensure_uv
  prepare_plugin_source
  install_dependencies_and_build

  collect_configuration
  write_local_config
  register_plugin
  write_openclaw_config
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
  ensure_supported_runtime_versions
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
  register_plugin
  write_openclaw_config
  restart_gateway

  echo ""
  success "升级完成"
}

run_uninstall_flow() {
  prompt_plugin_dir uninstall
  refresh_state

  echo ""
  warn "卸载会清理插件配置、allowlist、installs、load.paths 和本地目录。"
  warn "但不会自动回滚安装时写入的 .tools 或 agents.list[].tools，避免误删你原本的 Agent tools 配置。"
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
