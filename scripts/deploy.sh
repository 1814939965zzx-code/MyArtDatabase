#!/usr/bin/env bash
# 日常一键部署。服务器上唯一的部署命令：./scripts/deploy.sh
# 配置从 /etc/artdatabase/env 读取（由 setup-server.sh 生成），无需手动传参。
#
# 流程：数据预检 → git fetch + fast-forward → 依赖安装（package.json/package-lock.json
#       或 Node 版本未变、且 node_modules 完整时跳过 npm ci）→ typecheck + test + build
#       → 重启 systemd → 页面/API/数据库/图片校验 → 输出部署成功。
# 任何一步失败都以非零退出并输出恢复指引，绝不“有警告但仍成功”。

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

require_command git
require_command node
require_command npm
require_command curl
require_command grep

[[ -r "${ENV_FILE}" ]] || die "缺少配置 ${ENV_FILE}。请先在服务器执行首次初始化：sudo ./scripts/setup-server.sh"
env_load "${ENV_FILE}" || die "无法读取配置 ${ENV_FILE}"

SERVICE_NAME="${SERVICE_NAME:-artdatabase}"
PORT="${PORT:-3000}"
BRANCH="${BRANCH:-main}"
PUBLIC_URL="${PUBLIC_URL:-}"

[[ -n "${DB_PATH:-}" && -n "${STORE_ROOT:-}" ]] || {
  die "配置不完整：DB_PATH 或 STORE_ROOT 缺失，请检查 ${ENV_FILE}"
}

mkdir -p "${REPO_DIR}/tmp"
if command -v flock >/dev/null 2>&1; then
  exec 9>"${REPO_DIR}/tmp/deploy.lock"
  flock -n 9 || die "另一个部署正在进行"
fi

# ---------------- 前置检查 ----------------
preflight_checks "${REPO_DIR}" "${ENV_FILE}" "${SERVICE_NAME}" "${DB_PATH}" "${STORE_ROOT}"

PRE_PROJECTS="$(db_projects_count "${DB_PATH}")"
PRE_ASSETS="$(db_assets_count "${DB_PATH}")"
log "部署前数据基线：${PRE_PROJECTS} 个项目 / ${PRE_ASSETS} 个素材"

if [[ -n "$(git -C "${REPO_DIR}" status --porcelain --untracked-files=no)" ]]; then
  git -C "${REPO_DIR}" status --short
  die "服务器上存在已跟踪文件的未提交修改，为避免覆盖已中止部署"
fi

# ---------------- 拉取最新代码 ----------------
log "拉取 origin/${BRANCH}"
git -C "${REPO_DIR}" fetch --prune origin "${BRANCH}"
git -C "${REPO_DIR}" switch "${BRANCH}"
git -C "${REPO_DIR}" merge --ff-only "origin/${BRANCH}"

LOCAL_COMMIT="$(git -C "${REPO_DIR}" rev-parse HEAD)"
REMOTE_COMMIT="$(git -C "${REPO_DIR}" rev-parse "origin/${BRANCH}")"
[[ "${LOCAL_COMMIT}" == "${REMOTE_COMMIT}" ]] || {
  die "本地提交与 origin/${BRANCH} 不一致，无法 fast-forward"
}
log "已对齐提交 ${LOCAL_COMMIT}"

require_supported_node

# ---------------- 构建与测试 ----------------
# npm ci 每次都会删除 node_modules 并从 package-lock.json 全量重装（含 postinstall，
# 如 ffmpeg-static 重新下载二进制），所以只在依赖真正变化时执行。指纹文件
# tmp/installed-deps.sha256 记录上次 npm ci 成功时的依赖状态（package.json +
# package-lock.json + Node 版本），且只在成功后写入：中断或失败不会污染它，
# 下次部署仍会安全地全量重装。
log "类型检查、测试并构建前端"
(
  cd "${APP_DIR}"

  DEPS_STATE_FILE="${REPO_DIR}/tmp/installed-deps.sha256"
  deps_fingerprint() {
    node -e '
      const fs = require("node:fs");
      const crypto = require("node:crypto");
      const hash = crypto.createHash("sha256");
      for (const file of ["package.json", "package-lock.json"]) hash.update(fs.readFileSync(file));
      hash.update(process.versions.node); // Node 版本变化会改变 sharp 等原生依赖的 ABI
      process.stdout.write(hash.digest("hex"));
    '
  }
  # npm ls 校验树满足 package.json；sharp 走 optional 平台包、ffmpeg 二进制由
  # postinstall 下载，npm ls 都看不见，需单独探测（与本项目运行时用法一致）。
  deps_usable() {
    npm ls --depth=0 >/dev/null 2>&1 || return 1
    node -e 'require("sharp"); const fs = require("node:fs"); if (!fs.existsSync(require("ffmpeg-static"))) process.exit(1);' || return 1
  }

  if [[ -f "${DEPS_STATE_FILE}" && -d "node_modules" ]] \
    && [[ "$(deps_fingerprint)" == "$(<"${DEPS_STATE_FILE}")" ]] \
    && deps_usable; then
    log "依赖未变化且 node_modules 完整，跳过 npm ci"
  else
    log "依赖清单已变化或依赖树不完整，执行 npm ci"
    npm ci --no-audit --no-fund
    deps_fingerprint > "${DEPS_STATE_FILE}"
  fi

  npm run typecheck
  npm test
  npm run build
)
[[ -s "${DIST_INDEX}" ]] || {
  die "构建完成但未生成 ${DIST_INDEX}"
}

# ---------------- 重启 systemd 服务 ----------------
log "通过 systemd 重启 ${SERVICE_NAME}"
run_as_root systemctl restart "${SERVICE_NAME}"
run_as_root systemctl is-active --quiet "${SERVICE_NAME}" || {
  run_as_root systemctl status "${SERVICE_NAME}" --no-pager || true
  die "systemd 服务 ${SERVICE_NAME} 启动失败"
}

# ---------------- 部署后检查（全部硬失败） ----------------
LOCAL_URL="http://127.0.0.1:${PORT}"

MAIN_PID="$(service_entry_ok "${SERVICE_NAME}" "${SERVER_ENTRY}")"
log "systemd 运行当前入口：PID=${MAIN_PID}"
verify_service_runtime_config "${MAIN_PID}" "${DB_PATH}" "${STORE_ROOT}" "${PORT}"

HOME_HTML="$(fetch_homepage "${LOCAL_URL}")"
verify_api_json "${LOCAL_URL}"
verify_data_counts "${DB_PATH}" "${PRE_PROJECTS}" "${PRE_ASSETS}"
verify_page_assets "${LOCAL_URL}" "${DIST_INDEX}" "${HOME_HTML}"

if [[ -n "${PUBLIC_URL}" ]]; then
  PUBLIC_URL="${PUBLIC_URL%/}"
  public_html="$(curl -fsS "${PUBLIC_URL}/")" || die "公网地址无法访问: ${PUBLIC_URL}"
  public_assets="$(printf '%s' "${public_html}" | grep -oE 'assets/index-[^"[:space:]]+\.(js|css)' | LC_ALL=C sort -u || true)"
  built_assets="$(grep -oE 'assets/index-[^"[:space:]]+\.(js|css)' "${DIST_INDEX}" | LC_ALL=C sort -u || true)"
  [[ "${public_assets}" == "${built_assets}" ]] || die "公网页面仍是旧版，请检查 Nginx/CDN/浏览器缓存"
  log "公网资源校验通过"
fi

log "部署成功"
log "commit=${LOCAL_COMMIT}"
log "url=${LOCAL_URL}"
log "数据库=${DB_PATH}（${PRE_PROJECTS} 个项目 / ${PRE_ASSETS} 个素材）"
