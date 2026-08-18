#!/usr/bin/env bash
# 只读生产检查：不拉代码、不构建、不重启，仅验证当前部署是否健康。
# 任何一项不满足都以非零退出并输出恢复指引。
#
# 用法：./scripts/check-production.sh

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib-deploy.sh
source "${SCRIPT_DIR}/lib-deploy.sh"
SHOW_RECOVERY_HINTS=1

REPO_DIR="${REPO_DIR:-$(cd -- "${SCRIPT_DIR}/.." && pwd)}"
APP_DIR="${REPO_DIR}/app"
SERVER_ENTRY="${APP_DIR}/server/index.js"
DIST_INDEX="${APP_DIR}/dist/index.html"
ENV_FILE="${ENV_FILE:-/etc/artdatabase/env}"

require_command node
require_command curl
require_command grep
require_supported_node

[[ -r "${ENV_FILE}" ]] || die "缺少配置 ${ENV_FILE}。请先执行 sudo ./scripts/setup-server.sh"
env_load "${ENV_FILE}" || die "无法读取配置 ${ENV_FILE}"

SERVICE_NAME="${SERVICE_NAME:-artdatabase}"
PORT="${PORT:-3000}"

[[ -n "${DB_PATH:-}" && -n "${STORE_ROOT:-}" ]] || {
  die "配置不完整：DB_PATH 或 STORE_ROOT 缺失，请检查 ${ENV_FILE}"
}

log "开始只读生产检查（${ENV_FILE}）"

preflight_checks "${REPO_DIR}" "${ENV_FILE}" "${SERVICE_NAME}" "${DB_PATH}" "${STORE_ROOT}"

LOCAL_URL="http://127.0.0.1:${PORT}"

MAIN_PID="$(service_entry_ok "${SERVICE_NAME}" "${SERVER_ENTRY}")"
log "systemd 运行当前入口：PID=${MAIN_PID}"
verify_service_runtime_config "${MAIN_PID}" "${DB_PATH}" "${STORE_ROOT}" "${PORT}"

HOME_HTML="$(fetch_homepage "${LOCAL_URL}")"
verify_api_json "${LOCAL_URL}"
verify_api_counts_match_db "${LOCAL_URL}" "${DB_PATH}"
verify_page_assets "${LOCAL_URL}" "${DIST_INDEX}" "${HOME_HTML}"

[[ -d "${STORE_ROOT}" ]] || {
  die "媒体目录不存在：${STORE_ROOT}"
}
log "媒体目录可读：${STORE_ROOT}"

log "生产检查通过"
log "commit=$(git -C "${REPO_DIR}" rev-parse HEAD 2>/dev/null || echo 未知)"
log "url=${LOCAL_URL}"
