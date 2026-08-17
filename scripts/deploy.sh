#!/usr/bin/env bash

set -Eeuo pipefail

log() {
  printf '[deploy] %s\n' "$*"
}

die() {
  printf '[deploy] 错误: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "缺少必需命令: $1"
}

run_as_root() {
  if [[ ${EUID} -eq 0 ]]; then
    "$@"
  else
    require_command sudo
    sudo "$@"
  fi
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

REPO_DIR="${REPO_DIR:-${DEFAULT_REPO_DIR}}"
APP_DIR="${REPO_DIR}/app"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"
DB_PATH="${DB_PATH:-${REPO_DIR}/data/app.db}"
STORE_ROOT="${STORE_ROOT:-${REPO_DIR}/data/media}"
LOG_FILE="${LOG_FILE:-${REPO_DIR}/app.log}"
SERVICE_NAME="${SERVICE_NAME:-}"
PUBLIC_URL="${PUBLIC_URL:-}"
SERVER_ENTRY="${APP_DIR}/server/index.js"
DIST_INDEX="${APP_DIR}/dist/index.html"
PID_FILE="${REPO_DIR}/tmp/artdatabase.pid"

require_command git
require_command node
require_command npm
require_command curl
require_command grep

[[ "${PORT}" =~ ^[0-9]+$ ]] || die "PORT 必须是数字: ${PORT}"
((PORT >= 1 && PORT <= 65535)) || die "PORT 必须位于 1-65535: ${PORT}"

[[ -d "${REPO_DIR}/.git" ]] || die "不是 Git 仓库: ${REPO_DIR}"
[[ -f "${APP_DIR}/package-lock.json" ]] || die "缺少 ${APP_DIR}/package-lock.json"
[[ -f "${SERVER_ENTRY}" ]] || die "缺少服务入口: ${SERVER_ENTRY}"

mkdir -p "${REPO_DIR}/tmp"
if command -v flock >/dev/null 2>&1; then
  exec 9>"${REPO_DIR}/tmp/deploy.lock"
  flock -n 9 || die "另一个部署正在进行"
fi

if [[ -n "$(git -C "${REPO_DIR}" status --porcelain --untracked-files=no)" ]]; then
  git -C "${REPO_DIR}" status --short
  die "服务器上存在已跟踪文件的未提交修改，为避免覆盖已中止部署"
fi

log "拉取 origin/${BRANCH}"
git -C "${REPO_DIR}" fetch --prune origin "${BRANCH}"
git -C "${REPO_DIR}" switch "${BRANCH}"
git -C "${REPO_DIR}" merge --ff-only "origin/${BRANCH}"

LOCAL_COMMIT="$(git -C "${REPO_DIR}" rev-parse HEAD)"
REMOTE_COMMIT="$(git -C "${REPO_DIR}" rev-parse "origin/${BRANCH}")"
[[ "${LOCAL_COMMIT}" == "${REMOTE_COMMIT}" ]] || die "本地提交与 origin/${BRANCH} 不一致"
log "已对齐提交 ${LOCAL_COMMIT}"

node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 23 || (major === 23 && minor < 4)) {
  console.error(`Node.js ${process.versions.node} 过旧，需要 >= 23.4.0`);
  process.exit(1);
}
'

log "安装锁定依赖并构建前端"
(
  cd "${APP_DIR}"
  npm ci --no-audit --no-fund
  npm run build
)
[[ -s "${DIST_INDEX}" ]] || die "构建完成但未生成 ${DIST_INDEX}"

find_port_pids() {
  if command -v fuser >/dev/null 2>&1; then
    run_as_root fuser -n tcp "${PORT}" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true
  else
    die "需要 fuser 或 lsof 才能安全检查 ${PORT} 端口"
  fi
}

pid_belongs_to_repo() {
  local pid="$1"
  local args
  local cwd
  args="$(ps -p "${pid}" -o args= 2>/dev/null || true)"
  cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"

  [[ "${args}" == *"${SERVER_ENTRY}"* ]] ||
    [[ "${args}" == *"${REPO_DIR}/server/index.js"* ]] ||
    { [[ "${cwd}" == "${APP_DIR}" ]] && [[ "${args}" == *"server/index.js"* ]]; } ||
    { [[ "${cwd}" == "${REPO_DIR}" ]] && [[ "${args}" == *"server/index.js"* ]]; }
}

stop_direct_process() {
  local pids
  local pid
  local remaining
  local args

  pids="$(find_port_pids)"
  [[ -z "${pids//[[:space:]]/}" ]] && return 0

  for pid in ${pids}; do
    args="$(ps -p "${pid}" -o args= 2>/dev/null || true)"
    if ! pid_belongs_to_repo "${pid}"; then
      die "${PORT} 端口被仓库外进程占用，拒绝终止: PID=${pid} ${args}"
    fi
    log "停止旧进程 PID=${pid}: ${args}"
    kill -TERM "${pid}" 2>/dev/null || run_as_root kill -TERM "${pid}"
  done

  for _ in {1..20}; do
    remaining="$(find_port_pids)"
    [[ -z "${remaining//[[:space:]]/}" ]] && break
    sleep 0.5
  done

  remaining="$(find_port_pids)"
  if [[ -n "${remaining//[[:space:]]/}" ]]; then
    for pid in ${remaining}; do
      pid_belongs_to_repo "${pid}" || die "${PORT} 端口被新的未知进程占用: PID=${pid}"
      log "旧进程未正常退出，强制停止 PID=${pid}"
      kill -KILL "${pid}" 2>/dev/null || run_as_root kill -KILL "${pid}"
    done
  fi

  # 给 systemd、PM2 或 Docker 留出复活时间；若旧服务重新占端口则拒绝继续。
  sleep 3
  remaining="$(find_port_pids)"
  if [[ -n "${remaining//[[:space:]]/}" ]]; then
    die "${PORT} 端口被自动重启的旧服务重新占用。请找到它的 systemd/PM2/Docker 配置，或使用 SERVICE_NAME 部署"
  fi
}

restart_with_systemd() {
  require_command systemctl
  log "通过 systemd 重启 ${SERVICE_NAME}"
  run_as_root systemctl restart "${SERVICE_NAME}"
  run_as_root systemctl is-active --quiet "${SERVICE_NAME}" || {
    run_as_root systemctl status "${SERVICE_NAME}" --no-pager || true
    die "systemd 服务 ${SERVICE_NAME} 启动失败"
  }

  local main_pid
  local args
  main_pid="$(run_as_root systemctl show "${SERVICE_NAME}" --property MainPID --value)"
  args="$(ps -p "${main_pid}" -o args= 2>/dev/null || true)"
  [[ "${args}" == *"${SERVER_ENTRY}"* ]] || {
    run_as_root systemctl status "${SERVICE_NAME}" --no-pager || true
    die "systemd 仍未启动新入口。当前 ExecStart: ${args}"
  }
  log "systemd 已启动正确入口，PID=${main_pid}"
}

restart_directly() {
  stop_direct_process
  log "未指定 SERVICE_NAME，使用 nohup 直接启动"
  printf '\n[%s] deploy commit=%s\n' "$(date --iso-8601=seconds)" "${LOCAL_COMMIT}" >>"${LOG_FILE}"
  nohup env \
    NODE_ENV=production \
    DB_PATH="${DB_PATH}" \
    STORE_ROOT="${STORE_ROOT}" \
    PORT="${PORT}" \
    node "${SERVER_ENTRY}" \
    >>"${LOG_FILE}" 2>&1 </dev/null &
  local new_pid=$!
  printf '%s\n' "${new_pid}" >"${PID_FILE}"
  log "已启动 PID=${new_pid}"
}

if [[ -n "${SERVICE_NAME}" ]]; then
  restart_with_systemd
else
  restart_directly
fi

LOCAL_URL="http://127.0.0.1:${PORT}"
HOME_HTML=""
for _ in {1..30}; do
  if HOME_HTML="$(curl -fsS "${LOCAL_URL}/" 2>/dev/null)"; then
    break
  fi
  sleep 1
done

if [[ -z "${HOME_HTML}" ]]; then
  [[ -f "${LOG_FILE}" ]] && tail -50 "${LOG_FILE}" >&2 || true
  die "服务在 30 秒内未通过健康检查: ${LOCAL_URL}"
fi

curl -fsS "${LOCAL_URL}/api/projects" >/dev/null || {
  [[ -f "${LOG_FILE}" ]] && tail -50 "${LOG_FILE}" >&2 || true
  die "首页可访问，但 API 健康检查失败: ${LOCAL_URL}/api/projects"
}

extract_assets() {
  grep -oE 'assets/index-[^"[:space:]]+\.(js|css)' | LC_ALL=C sort -u || true
}

BUILT_ASSETS="$(extract_assets <"${DIST_INDEX}")"
LIVE_ASSETS="$(printf '%s' "${HOME_HTML}" | extract_assets)"
[[ -n "${BUILT_ASSETS}" ]] || die "无法从 ${DIST_INDEX} 提取构建资源名"
[[ "${LIVE_ASSETS}" == "${BUILT_ASSETS}" ]] || {
  printf '[deploy] 构建资源:\n%s\n' "${BUILT_ASSETS}" >&2
  printf '[deploy] 本机服务资源:\n%s\n' "${LIVE_ASSETS}" >&2
  die "本机 ${PORT} 端口提供的不是本次构建结果"
}

if [[ -n "${PUBLIC_URL}" ]]; then
  PUBLIC_URL="${PUBLIC_URL%/}"
  PUBLIC_HTML="$(curl -fsS "${PUBLIC_URL}/")" || die "公网地址无法访问: ${PUBLIC_URL}"
  PUBLIC_ASSETS="$(printf '%s' "${PUBLIC_HTML}" | extract_assets)"
  [[ "${PUBLIC_ASSETS}" == "${BUILT_ASSETS}" ]] || {
    printf '[deploy] 构建资源:\n%s\n' "${BUILT_ASSETS}" >&2
    printf '[deploy] 公网页面资源:\n%s\n' "${PUBLIC_ASSETS}" >&2
    die "公网页面仍是旧版，请检查 Nginx/CDN/浏览器缓存"
  }
fi

log "部署成功"
log "commit=${LOCAL_COMMIT}"
log "url=${LOCAL_URL}"
printf '%s\n' "${BUILT_ASSETS}"
