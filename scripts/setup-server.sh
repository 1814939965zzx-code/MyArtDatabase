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
#   - 迁移前先停止同名旧服务，再用 SQLite Online Backup API 生成一致性备份；
#   - 未发现旧库且未显式 INIT_EMPTY_DB=1 时停止，绝不悄悄创建空库；
#   - 旧数据库和旧媒体目录均原地保留，便于回退。

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
((PORT >= 1 && PORT <= 65535)) || die "PORT 必须位于 1-65535: ${PORT}"
validate_service_name "${SERVICE_NAME}" || die "非法服务名：${SERVICE_NAME}"

# 非 root 且非 dry-run 时，通过 sudo 重新以 root 执行（参数原样保留）
if [[ ${EUID} -ne 0 && ${DRY} -eq 0 ]]; then
  require_command sudo
  exec sudo INIT_EMPTY_DB="${INIT_EMPTY_DB}" bash "$0" "$@"
fi

REPO_DIR="${REPO_DIR:-$(cd -- "${SCRIPT_DIR}/.." && pwd)}"
APP_DIR="${REPO_DIR}/app"
SERVER_ENTRY="${APP_DIR}/server/index.js"
SERVER_DB="${APP_DIR}/server/db.js"
DIST_INDEX="${APP_DIR}/dist/index.html"
DATA_DIR="${DATA_DIR:-/var/lib/artdatabase}"
DB_PATH="${DATA_DIR}/app.db"
STORE_ROOT="${DATA_DIR}/media"
BACKUP_DIR="${DATA_DIR}/backups"
SERVICE_USER="artdatabase"
ENV_FILE="${ENV_FILE:-/etc/artdatabase/env}"
UNIT_FILE="${UNIT_FILE:-/etc/systemd/system/${SERVICE_NAME}.service}"

path_inside_repo "${DB_PATH}" "${REPO_DIR}" && die "生产数据目录不能位于 Git 仓库内：${DATA_DIR}"

require_command git
require_command node
require_command curl
require_command npm
require_supported_node
[[ ${DRY} -eq 1 ]] || require_command systemctl
[[ -d "${REPO_DIR}/.git" ]] || die "不是 Git 仓库: ${REPO_DIR}"
[[ -f "${SERVER_ENTRY}" ]] || die "缺少服务入口: ${SERVER_ENTRY}"
if [[ ${DRY} -eq 0 ]]; then
  [[ -d "/etc/systemd/system" ]] || die "未找到 /etc/systemd/system，本脚本仅支持 systemd 环境"
fi

NODE_BIN="$(command -v node)"
OLD_SERVICE_WAS_ACTIVE=0
OLD_UNIT_BACKUP=""
OLD_ENV_BACKUP=""

restore_service_on_failure() {
  local rc=$?
  if [[ ${rc} -ne 0 && ${DRY} -eq 0 ]]; then
    if [[ -n "${OLD_UNIT_BACKUP}" && -s "${OLD_UNIT_BACKUP}" ]]; then
      log "初始化失败，恢复原 systemd unit"
      install -m 0644 "${OLD_UNIT_BACKUP}" "${UNIT_FILE}" || true
    fi
    if [[ -n "${OLD_ENV_BACKUP}" && -s "${OLD_ENV_BACKUP}" ]]; then
      log "初始化失败，恢复原生产配置"
      install -m 0644 "${OLD_ENV_BACKUP}" "${ENV_FILE}" || true
    fi
    systemctl daemon-reload >/dev/null 2>&1 || true
    if [[ ${OLD_SERVICE_WAS_ACTIVE} -eq 1 ]]; then
      log "初始化失败，尝试恢复启动原服务 ${SERVICE_NAME}"
      systemctl start "${SERVICE_NAME}" >/dev/null 2>&1 || true
    fi
  fi
  exit "${rc}"
}
trap restore_service_on_failure EXIT

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

# ---- 2. 数据目录（不提前创建 media，避免干扰迁移判断） ----
do_or_print mkdir -p "${DATA_DIR}" "${BACKUP_DIR}"
SETUP_STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"

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
  if [[ ${DRY} -eq 0 ]]; then
    [[ "$(db_quick_check "${SRC_DB}")" == "ok" ]] || die "旧数据库 quick_check 失败：${SRC_DB}"
    [[ "$(db_has_demo "${SRC_DB}")" != "yes" ]] || die "旧数据库包含示例项目，请先确认真实数据：${SRC_DB}"
    if db_is_empty "${SRC_DB}" && [[ "${INIT_EMPTY_DB}" != "1" ]]; then
      die "发现的数据库为空库：${SRC_DB}。确认为全新部署时请使用 INIT_EMPTY_DB=1"
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

# ---- 4. 首次安装依赖并构建，确保全新 clone 可以直接启动 ----
if [[ ${DRY} -eq 1 ]]; then
  log "dry-run：将以仓库所有者身份执行 npm ci / typecheck / test / build"
else
  REPO_OWNER="${REPO_OWNER:-$(stat -c '%U' "${REPO_DIR}")}"
  [[ -n "${REPO_OWNER}" ]] || die "无法确定仓库所有者：${REPO_DIR}"
  log "首次构建（用户=${REPO_OWNER}）"
  if [[ "${REPO_OWNER}" == "root" ]]; then
    (cd "${APP_DIR}" && npm ci --no-audit --no-fund && npm run typecheck && npm test && npm run build)
  else
    require_command runuser
    runuser -u "${REPO_OWNER}" -- bash -c 'cd "$1" && npm ci --no-audit --no-fund && npm run typecheck && npm test && npm run build' _ "${APP_DIR}"
  fi
  [[ -s "${DIST_INDEX}" ]] || die "首次构建未生成 ${DIST_INDEX}"
fi

# ---- 5. 停止旧服务，一致性备份并复制数据（保留原文件） ----
if [[ ${DRY} -eq 0 ]] && systemctl cat "${SERVICE_NAME}" >/dev/null 2>&1 \
  && systemctl is-active --quiet "${SERVICE_NAME}"; then
  OLD_SERVICE_WAS_ACTIVE=1
  log "停止旧服务 ${SERVICE_NAME}，避免迁移期间继续写入"
  systemctl stop "${SERVICE_NAME}"
fi

if [[ ${#EXISTING_DB[@]} -eq 1 ]]; then
  BACKUP_FILE="${BACKUP_DIR}/${SETUP_STAMP}-app.db"
  log "一致性备份：${SRC_DB} → ${BACKUP_FILE}"
  do_or_print sqlite_backup "${SRC_DB}" "${BACKUP_FILE}"

  if [[ "${SRC_DB}" != "${DB_PATH}" ]]; then
    log "复制备份到生产库：${BACKUP_FILE} → ${DB_PATH}（原库保留）"
    do_or_print cp -p "${BACKUP_FILE}" "${DB_PATH}"
  else
    log "数据库已就位于 ${DB_PATH}"
  fi

  case "${SRC_DB}" in
    "${REPO_DIR}/app/data/app.db") SRC_MEDIA="${REPO_DIR}/app/data/media" ;;
    "${REPO_DIR}/data/app.db") SRC_MEDIA="${REPO_DIR}/data/media" ;;
    *) SRC_MEDIA="" ;;
  esac
  if [[ -n "${SRC_MEDIA}" && -d "${SRC_MEDIA}" ]]; then
    log "复制媒体目录：${SRC_MEDIA} → ${STORE_ROOT}（原目录保留）"
    do_or_print copy_media_tree "${SRC_MEDIA}" "${STORE_ROOT}"
  else
    do_or_print mkdir -p "${STORE_ROOT}"
  fi
else
  do_or_print mkdir -p "${STORE_ROOT}"
fi

if [[ ${DRY} -eq 0 && ! -s "${DB_PATH}" && "${INIT_EMPTY_DB}" == "1" ]]; then
  log "创建带完整 schema 的空生产库：${DB_PATH}"
  node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const { openDatabase } = await import(pathToFileURL(process.argv[1]).href);
    openDatabase(process.argv[2], { seedDemo: false }).close();
  ' "${SERVER_DB}" "${DB_PATH}"
fi

if [[ ${DRY} -eq 0 && -s "${DB_PATH}" ]]; then
  [[ "$(db_quick_check "${DB_PATH}")" == "ok" ]] || die "迁移后数据库 quick_check 失败：${DB_PATH}"
  verify_media_files "${DB_PATH}" "${STORE_ROOT}" >/dev/null || die "迁移后媒体文件与数据库不一致"
fi

# ---- 6. 写入 /etc/artdatabase/env ----
log "写入 ${ENV_FILE}"
if [[ ${DRY} -eq 1 ]]; then
  log "dry-run：将安全写入 ${ENV_FILE}"
else
  if [[ -s "${ENV_FILE}" ]]; then
    OLD_ENV_BACKUP="${BACKUP_DIR}/${SETUP_STAMP}-production.env"
    cp -p "${ENV_FILE}" "${OLD_ENV_BACKUP}"
  fi
  ENV_TMP="$(mktemp)"
  printf '# artdatabase 生产配置（由 setup-server.sh 生成，勿手改路径）\nNODE_ENV=production\nPORT=%s\nDB_PATH=%s\nSTORE_ROOT=%s\nSERVICE_NAME=%s\nRUN_USER=%s\n' \
    "${PORT}" "${DB_PATH}" "${STORE_ROOT}" "${SERVICE_NAME}" "${SERVICE_USER}" >"${ENV_TMP}"
  install -d -m 0755 "$(dirname "${ENV_FILE}")"
  install -m 0644 "${ENV_TMP}" "${ENV_FILE}"
  rm -f "${ENV_TMP}"
fi

# ---- 7. 生成 systemd unit ----
log "写入 ${UNIT_FILE}"
if [[ ${DRY} -eq 1 ]]; then
  log "dry-run：将安全写入 ${UNIT_FILE}"
else
  if [[ -s "${UNIT_FILE}" ]]; then
    OLD_UNIT_BACKUP="${BACKUP_DIR}/${SETUP_STAMP}-${SERVICE_NAME}.service"
    cp -p "${UNIT_FILE}" "${OLD_UNIT_BACKUP}"
  fi
  UNIT_TMP="$(mktemp)"
  printf '%s\n' \
    '[Unit]' \
    "Description=MyArtDatabase (${SERVICE_NAME})" \
    'After=network.target' \
    '' \
    '[Service]' \
    'Type=simple' \
    "User=${SERVICE_USER}" \
    "Group=${SERVICE_USER}" \
    "WorkingDirectory=${APP_DIR}" \
    "EnvironmentFile=${ENV_FILE}" \
    "ExecStart=${NODE_BIN} ${SERVER_ENTRY}" \
    'Restart=on-failure' \
    'RestartSec=3' \
    '' \
    '[Install]' \
    'WantedBy=multi-user.target' >"${UNIT_TMP}"
  install -m 0644 "${UNIT_TMP}" "${UNIT_FILE}"
  rm -f "${UNIT_TMP}"
fi

if [[ ${DRY} -eq 1 ]]; then
  log "dry-run 结束：以上为将要执行的操作，未做任何修改"
  exit 0
fi

# ---- 8. 数据目录属主与仓库可读性 ----
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}"
runuser -u "${SERVICE_USER}" -- test -r "${SERVER_ENTRY}" 2>/dev/null \
  || die "服务用户 ${SERVICE_USER} 无法读取仓库入口 ${SERVER_ENTRY}；请修正仓库父目录权限后重试"
runuser -u "${SERVICE_USER}" -- test -r "${DB_PATH}" -a -w "$(dirname "${DB_PATH}")" -a -r "${STORE_ROOT}" -a -w "${STORE_ROOT}" 2>/dev/null \
  || die "服务用户 ${SERVICE_USER} 无法读写生产数据目录 ${DATA_DIR}"

# ---- 9. 启动并验证 ----
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"
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
  if curl -fsS "${LOCAL_URL}/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "${LOCAL_URL}/api/health" >/dev/null 2>&1 || {
  systemctl status "${SERVICE_NAME}" --no-pager || true
  die "服务已启动但 API 健康检查失败：${LOCAL_URL}/api/health"
}

ACTUAL_USER="$(systemctl show "${SERVICE_NAME}" --property User --value)"
[[ "${ACTUAL_USER}" == "${SERVICE_USER}" ]] || die "服务实际运行用户不符：${ACTUAL_USER}"
MAIN_PID="$(systemctl show "${SERVICE_NAME}" --property MainPID --value)"
ACTUAL_ARGS="$(ps -p "${MAIN_PID}" -o args= 2>/dev/null || true)"
[[ "${ACTUAL_ARGS}" == *"${SERVER_ENTRY}"* ]] || die "服务未运行当前仓库入口：${ACTUAL_ARGS}"
verify_service_runtime_config "${MAIN_PID}" "${DB_PATH}" "${STORE_ROOT}" "${PORT}"
verify_api_json "${LOCAL_URL}"
verify_api_counts_match_db "${LOCAL_URL}" "${DB_PATH}"

log "初始化完成"
log "服务=${SERVICE_NAME} PID=$(systemctl show "${SERVICE_NAME}" --property MainPID --value)"
log "数据库=${DB_PATH}"
log "媒体目录=${STORE_ROOT}"
log "配置=${ENV_FILE}"
log "日常部署只需一条命令：cd ${REPO_DIR} && ./scripts/deploy.sh"
log "服务器上禁止执行：git clean -fdx / rm -rf 仓库 / 重新 clone（会删除仓库内数据；生产数据在 ${DATA_DIR} 不受影响，但旧库可能仍在仓库内）"
trap - EXIT
