#!/usr/bin/env bash
# 首次初始化（只执行一次）：创建非 root 服务用户、把数据固定到 /var/lib/artdatabase/、
# 探测并迁移旧数据库、写入 /etc/artdatabase/env、生成 systemd unit、启动并验证服务。
#
# 用法：
#   sudo ./scripts/setup-server.sh                          # 默认服务名 artdatabase，端口 3000
#   sudo ./scripts/setup-server.sh --service-name=artdb --port=8080
#   sudo INIT_EMPTY_DB=1 ./scripts/setup-server.sh          # 确认无旧库、创建空库时用
#   ./scripts/setup-server.sh --dry-run                     # 只预览将要执行的操作（无需 root）
#
# 安全规则：
#   - 多个旧数据库同时存在时停止，绝不自动猜测；
#   - 迁移前先把数据库备份到 /var/lib/artdatabase/backups/；
#   - 未发现旧库且未显式 INIT_EMPTY_DB=1 时停止，绝不悄悄创建空库；
#   - 本脚本绝不删除仓库内任何数据文件。

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib-deploy.sh
source "${SCRIPT_DIR}/lib-deploy.sh"

SERVICE_NAME="artdatabase"
PORT="3000"
INIT_EMPTY_DB="${INIT_EMPTY_DB:-0}"
DRY=0

for arg in "$@"; do
  case "${arg}" in
    --service-name=*) SERVICE_NAME="${arg#*=}" ;;
    --port=*) PORT="${arg#*=}" ;;
    --init-empty-db) INIT_EMPTY_DB=1 ;;
    --dry-run) DRY=1 ;;
    *) die "未知参数: ${arg}（用法：--service-name=NAME --port=N --init-empty-db --dry-run）" ;;
  esac
done

[[ "${PORT}" =~ ^[0-9]+$ ]] || die "PORT 必须是数字: ${PORT}"

# 非 root 且非 dry-run 时，通过 sudo 重新以 root 执行（参数原样保留）
if [[ ${EUID} -ne 0 && ${DRY} -eq 0 ]]; then
  require_command sudo
  exec sudo INIT_EMPTY_DB="${INIT_EMPTY_DB}" bash "$0" "$@"
fi

REPO_DIR="${REPO_DIR:-$(cd -- "${SCRIPT_DIR}/.." && pwd)}"
APP_DIR="${REPO_DIR}/app"
SERVER_ENTRY="${APP_DIR}/server/index.js"
DIST_INDEX="${APP_DIR}/dist/index.html"
DATA_DIR="${DATA_DIR:-/var/lib/artdatabase}"
DB_PATH="${DATA_DIR}/app.db"
STORE_ROOT="${DATA_DIR}/media"
BACKUP_DIR="${DATA_DIR}/backups"
SERVICE_USER="artdatabase"
ENV_FILE="${ENV_FILE:-/etc/artdatabase/env}"
UNIT_FILE="${UNIT_FILE:-/etc/systemd/system/${SERVICE_NAME}.service}"

require_command git
require_command node
require_command curl
[[ ${DRY} -eq 1 ]] || require_command systemctl
[[ -d "${REPO_DIR}/.git" ]] || die "不是 Git 仓库: ${REPO_DIR}"
[[ -f "${SERVER_ENTRY}" ]] || die "缺少服务入口: ${SERVER_ENTRY}"
if [[ ${DRY} -eq 0 ]]; then
  [[ -d "/etc/systemd/system" ]] || die "未找到 /etc/systemd/system，本脚本仅支持 systemd 环境"
fi

NODE_BIN="$(command -v node)"

log "目标：服务名=${SERVICE_NAME} 端口=${PORT} 数据目录=${DATA_DIR}"
log "仓库：${REPO_DIR}"

do_or_print() {
  if [[ ${DRY} -eq 1 ]]; then
    printf '[setup][dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

# ---- 1. 创建非 root 服务用户 ----
if id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  log "服务用户已存在：${SERVICE_USER}"
else
  log "创建系统用户 ${SERVICE_USER}（无登录 shell）"
  do_or_print useradd --system --no-create-home \
    --home-dir "${DATA_DIR}" \
    --shell "$(command -v nologin 2>/dev/null || echo /bin/false)" \
    "${SERVICE_USER}"
fi

# ---- 2. 数据目录 ----
do_or_print mkdir -p "${DATA_DIR}" "${STORE_ROOT}" "${BACKUP_DIR}"

# ---- 3. 探测并迁移旧数据库 ----
EXISTING_DB=()
while IFS= read -r line; do
  EXISTING_DB+=("${line}")
done < <(probe_databases "${REPO_DIR}")

if [[ ${#EXISTING_DB[@]} -gt 1 ]]; then
  printf '[setup] 错误: 发现多个数据库，为避免猜错已停止：\n' >&2
  printf '  - %s\n' "${EXISTING_DB[@]}" >&2
  printf '%s\n' "请人工确认真实数据所在，删除其余副本后重新执行本脚本。" >&2
  exit 1
elif [[ ${#EXISTING_DB[@]} -eq 1 ]]; then
  SRC_DB="${EXISTING_DB[0]}"
  if [[ "${SRC_DB}" == "${DB_PATH}" ]]; then
    log "数据库已就位于 ${DB_PATH}"
  else
    STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
    BACKUP_FILE="${BACKUP_DIR}/${STAMP}-app.db"
    log "备份旧数据库：${SRC_DB} → ${BACKUP_FILE}"
    do_or_print cp -p "${SRC_DB}" "${BACKUP_FILE}"
    log "迁移数据库：${SRC_DB} → ${DB_PATH}"
    do_or_print mv -f "${SRC_DB}" "${DB_PATH}"

    case "${SRC_DB}" in
      "${REPO_DIR}/app/data/app.db") SRC_MEDIA="${REPO_DIR}/app/data/media" ;;
      "${REPO_DIR}/data/app.db") SRC_MEDIA="${REPO_DIR}/data/media" ;;
      *) SRC_MEDIA="" ;;
    esac
    if [[ -n "${SRC_MEDIA}" && -d "${SRC_MEDIA}" ]]; then
      if [[ -e "${STORE_ROOT}" ]]; then
        log "警告: ${STORE_ROOT} 已存在，未覆盖；原媒体目录仍在 ${SRC_MEDIA}"
      else
        log "迁移媒体目录：${SRC_MEDIA} → ${STORE_ROOT}"
        do_or_print mv "${SRC_MEDIA}" "${STORE_ROOT}"
      fi
    fi
  fi
else
  if [[ "${INIT_EMPTY_DB}" != "1" ]]; then
    printf '%s\n' \
      "[setup] 未发现任何现有数据库（/var/lib/artdatabase/app.db、${REPO_DIR}/app/data/app.db、${REPO_DIR}/data/app.db）" \
      "[setup] 为避免路径配置错误时悄悄创建空库，已停止。" \
      "[setup] 如确认这是全新部署、需要创建空库，请明确执行：" \
      "[setup]   sudo INIT_EMPTY_DB=1 ./scripts/setup-server.sh" \
      "[setup] 或确认旧库位置后，把它放到 /var/lib/artdatabase/app.db 再重试。" >&2
    exit 1
  fi
  log "已确认创建空库（INIT_EMPTY_DB=1）：${DB_PATH}"
fi

# ---- 4. 写入 /etc/artdatabase/env ----
log "写入 ${ENV_FILE}"
do_or_print bash -c "mkdir -p /etc/artdatabase && cat >${ENV_FILE} <<EOF
# artdatabase 生产配置（由 setup-server.sh 生成，勿手改路径）
PORT=${PORT}
DB_PATH=${DB_PATH}
STORE_ROOT=${STORE_ROOT}
SERVICE_NAME=${SERVICE_NAME}
RUN_USER=${SERVICE_USER}
EOF
chmod 0644 ${ENV_FILE}"

# ---- 5. 生成 systemd unit ----
log "写入 ${UNIT_FILE}"
do_or_print bash -c "cat >${UNIT_FILE} <<EOF
[Unit]
Description=MyArtDatabase (${SERVICE_NAME})
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${NODE_BIN} ${SERVER_ENTRY}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF"

if [[ ${DRY} -eq 1 ]]; then
  log "dry-run 结束：以上为将要执行的操作，未做任何修改"
  exit 0
fi

# ---- 6. 数据目录属主与仓库可读性 ----
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}"
if ! sudo -u "${SERVICE_USER}" test -r "${SERVER_ENTRY}" 2>/dev/null; then
  log "警告: 服务用户 ${SERVICE_USER} 无法读取仓库入口 ${SERVER_ENTRY}"
  log "      请开放仓库路径的读取权限（例如：chmod o+x /home/admin），否则服务启动后无法加载代码"
fi

# ---- 7. 启动并验证 ----
systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"
for _ in {1..20}; do
  systemctl is-active --quiet "${SERVICE_NAME}" && break
  sleep 0.5
done
systemctl is-active --quiet "${SERVICE_NAME}" || {
  systemctl status "${SERVICE_NAME}" --no-pager || true
  die "服务 ${SERVICE_NAME} 启动失败，请检查上面的状态输出"
}

LOCAL_URL="http://127.0.0.1:${PORT}"
for _ in {1..30}; do
  if curl -fsS "${LOCAL_URL}/api/projects" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "${LOCAL_URL}/api/projects" >/dev/null 2>&1 || {
  systemctl status "${SERVICE_NAME}" --no-pager || true
  die "服务已启动但 API 健康检查失败：${LOCAL_URL}/api/projects"
}

log "初始化完成"
log "服务=${SERVICE_NAME} PID=$(systemctl show "${SERVICE_NAME}" --property MainPID --value)"
log "数据库=${DB_PATH}"
log "媒体目录=${STORE_ROOT}"
log "配置=${ENV_FILE}"
log "日常部署只需一条命令：cd ${REPO_DIR} && ./scripts/deploy.sh"
log "服务器上禁止执行：git clean -fdx / rm -rf 仓库 / 重新 clone（会删除仓库内数据；生产数据在 ${DATA_DIR} 不受影响，但旧库可能仍在仓库内）"
