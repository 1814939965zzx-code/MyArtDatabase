#!/usr/bin/env bash
# 部署共享函数库：被 scripts/deploy.sh、scripts/check-production.sh、scripts/setup-server.sh 引用。
# 本文件只定义纯函数，不执行任何副作用。

log() { printf '[deploy] %s\n' "$*"; }
die() {
  printf '[deploy] 错误: %s\n' "$*" >&2
  if [[ "${SHOW_RECOVERY_HINTS:-0}" == "1" ]]; then
    recovery_hint
  fi
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "缺少必需命令: $1"
}

require_supported_node() {
  node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 23 || (major === 23 && minor < 4)) {
      console.error(`Node.js ${process.versions.node} 过旧，需要 >= 23.4.0`);
      process.exit(1);
    }
  ' || die "Node.js 版本检查失败"
}

run_as_root() {
  if [[ ${EUID} -eq 0 ]]; then
    "$@"
  else
    require_command sudo
    sudo "$@"
  fi
}

run_as_user() {
  local user="${1:?}"
  shift
  if [[ ${EUID} -eq 0 ]]; then
    require_command runuser
    runuser -u "${user}" -- "$@"
  else
    require_command sudo
    sudo -u "${user}" -- "$@"
  fi
}

recovery_hint() {
  printf '%s\n' \
    "恢复指引：查看日志 sudo journalctl -u ${SERVICE_NAME:-artdatabase} -n 100 --no-pager" \
    "数据备份位于 ${DATA_BACKUP_DIR:-/var/lib/artdatabase/backups/}，可执行 ls 查看" \
    "回滚代码：git -C ${REPO_DIR:-<仓库>} log --oneline -5" >&2
}

# 从配置文件加载部署参数；已在环境中显式设置的值优先（便于测试与覆盖）。
# 白名单之外的内容（如 SEED_DEMO）不会进入环境。
env_load() {
  local file="${1:?}"
  [[ -r "${file}" ]] || return 1
  local key value
  while IFS='=' read -r key value; do
    case "${key}" in
      '' | '#'*) continue ;;
      PORT | DB_PATH | STORE_ROOT | SERVICE_NAME | RUN_USER | BRANCH | PUBLIC_URL)
        if [[ -z "${!key+x}" ]]; then
          export "${key}=${value}"
        fi
        ;;
    esac
  done <"${file}"
  return 0
}

# 数据库只读检查（node:sqlite，无需 sqlite3 CLI）
db_quick_check() {
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    const row = db.prepare("PRAGMA quick_check").get();
    console.log(Object.values(row)[0]);
  ' "$1"
}

db_projects_count() {
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    console.log(db.prepare("SELECT COUNT(*) c FROM projects").get().c);
  ' "$1"
}

db_assets_count() {
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    console.log(db.prepare("SELECT COUNT(*) c FROM assets WHERE deleted_at IS NULL").get().c);
  ' "$1"
}

db_all_assets_count() {
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    console.log(db.prepare("SELECT COUNT(*) c FROM assets").get().c);
  ' "$1"
}

# 是否包含示例项目（示例数据 id 固定，真实项目为 UUID，不会误判）
db_has_demo() {
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    const row = db.prepare("SELECT COUNT(*) c FROM projects WHERE id IN (?, ?)")
      .get("project-visual-direction", "project-material-language");
    console.log(row.c > 0 ? "yes" : "no");
  ' "$1"
}

db_is_empty() {
  [[ "$(db_projects_count "$1")" -eq 0 && "$(db_all_assets_count "$1")" -eq 0 ]]
}

# 使用 SQLite Online Backup API 生成一致性备份，避免直接 cp 活跃数据库。
sqlite_backup() {
  local source_db="${1:?}" target_db="${2:?}"
  node -e '
    const { DatabaseSync, backup } = require("node:sqlite");
    const source = new DatabaseSync(process.argv[1], { readOnly: true });
    backup(source, process.argv[2])
      .then(() => source.close())
      .catch((error) => { console.error(error.message); process.exit(1); });
  ' "${source_db}" "${target_db}"
}

validate_service_name() {
  [[ "${1:-}" =~ ^[A-Za-z0-9_.@-]+$ ]]
}

# 保留旧媒体目录作为回退，目标非空时拒绝猜测或覆盖。
copy_media_tree() {
  local source_dir="${1:?}" target_dir="${2:?}"
  local target_parent stage_dir
  [[ -d "${source_dir}" ]] || return 0
  if [[ -d "${target_dir}" && -n "$(find "${target_dir}" -mindepth 1 -print -quit 2>/dev/null)" ]]; then
    die "目标媒体目录非空，拒绝覆盖：${target_dir}"
  fi
  target_parent="$(dirname "${target_dir}")"
  mkdir -p "${target_parent}"
  stage_dir="$(mktemp -d "${target_parent}/.media-stage.XXXXXX")"
  cp -a "${source_dir}/." "${stage_dir}/"
  [[ ! -d "${target_dir}" ]] || rmdir "${target_dir}"
  mv "${stage_dir}" "${target_dir}"
}

# 校验数据库中所有本地原图/缩略图记录均有对应文件（包含软删除素材）。
verify_media_files() {
  local db_path="${1:?}" store_root="${2:?}"
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const { existsSync } = require("node:fs");
    const path = require("node:path");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    const root = process.argv[2];
    const rows = db.prepare("SELECT id, storage_key, thumbnail_key FROM assets").all();
    const missing = [];
    for (const row of rows) {
      if (row.storage_key && !existsSync(path.join(root, "blobs", row.storage_key))) {
        missing.push(`${row.id}:blobs/${row.storage_key}`);
      }
      if (row.thumbnail_key && !existsSync(path.join(root, "thumbs", row.thumbnail_key))) {
        missing.push(`${row.id}:thumbs/${row.thumbnail_key}`);
      }
    }
    if (missing.length) {
      console.error(missing.slice(0, 10).join("\n"));
      if (missing.length > 10) console.error(`... 共 ${missing.length} 个缺失文件`);
      process.exit(1);
    }
    console.log(rows.filter((row) => row.storage_key || row.thumbnail_key).length);
  ' "${db_path}" "${store_root}"
}

# 路径是否位于仓库内（部署数据必须在仓库外，避免被 git clean / 重建删除）
path_inside_repo() {
  local path="${1:?}"
  local repo="${2:?}"
  [[ "${path}" == "${repo}" || "${path}" == "${repo}"/* ]]
}

# 探测三个候选位置的现有数据库；按 DATA_DIR → app/data → data 顺序输出
probe_databases() {
  local repo="${1:?}"
  local data_dir="${DATA_DIR:-/var/lib/artdatabase}"
  [[ -s "${data_dir}/app.db" ]] && printf '%s\n' "${data_dir}/app.db"
  [[ -s "${repo}/app/data/app.db" ]] && printf '%s\n' "${repo}/app/data/app.db"
  [[ -s "${repo}/data/app.db" ]] && printf '%s\n' "${repo}/data/app.db"
  return 0
}

# 探测三个候选位置的媒体目录
probe_media_dirs() {
  local repo="${1:?}"
  local data_dir="${DATA_DIR:-/var/lib/artdatabase}"
  [[ -d "${data_dir}/media" ]] && printf '%s\n' "${data_dir}/media"
  [[ -d "${repo}/app/data/media" ]] && printf '%s\n' "${repo}/app/data/media"
  [[ -d "${repo}/data/media" ]] && printf '%s\n' "${repo}/data/media"
  return 0
}

# 前置检查：配置、数据库、媒体目录、systemd 服务。任一失败即退出。
preflight_checks() {
  local repo_dir="$1" env_file="$2" service_name="$3" db_path="$4" store_root="$5"
  log "前置检查…"
  run_as_root systemctl cat "${service_name}" >/dev/null 2>&1 || {
    die "systemd 服务 ${service_name} 不存在，请先执行 sudo ./scripts/setup-server.sh"
  }

  path_inside_repo "${db_path}" "${repo_dir}" && {
    die "数据库位于仓库内：${db_path}。生产数据必须在仓库外（/var/lib/artdatabase/），请执行 sudo ./scripts/setup-server.sh 迁移"
  }

  path_inside_repo "${store_root}" "${repo_dir}" && {
    die "媒体目录位于仓库内：${store_root}。生产媒体必须在仓库外（/var/lib/artdatabase/media/）"
  }

  [[ -s "${db_path}" ]] || {
    die "数据库文件不存在或为空：${db_path}"
  }

  local check
  check="$(db_quick_check "${db_path}")"
  [[ "${check}" == "ok" ]] || {
    die "SQLite quick_check 失败（${check}）：${db_path}"
  }

  grep -q '^SEED_DEMO=1' "${env_file}" 2>/dev/null && {
    die "配置 ${env_file} 中存在 SEED_DEMO=1，生产环境禁止示例数据，请删除该行"
  }
  [[ "${SEED_DEMO:-}" != "1" ]] || {
    die "环境中存在 SEED_DEMO=1，生产环境禁止示例数据"
  }
  local unit_env
  unit_env="$(run_as_root systemctl show "${service_name}" --property Environment --value 2>/dev/null || true)"
  printf '%s' "${unit_env}" | grep -q 'SEED_DEMO=1' && {
    die "systemd unit 中存在 SEED_DEMO=1，请运行 sudo ./scripts/setup-server.sh 重新生成"
  }

  db_is_empty "${db_path}" && {
    die "数据库为空库（0 个项目且 0 个素材）。请先在界面创建数据，或从备份恢复"
  }
  [[ "$(db_has_demo "${db_path}")" == "yes" ]] && {
    die "数据库包含示例项目（project-visual-direction / project-material-language）。请删除示例数据或确认 DB_PATH 指向真实数据库"
  }

  [[ -d "${store_root}" && -r "${store_root}" ]] || {
    die "媒体目录不存在或不可读：${store_root}"
  }

  local svc_user
  svc_user="$(run_as_root systemctl show "${service_name}" --property User --value 2>/dev/null || true)"
  [[ -n "${svc_user}" && "${svc_user}" != "root" ]] || {
    die "服务以 root 用户运行（User=${svc_user:-未设置}）。请运行 sudo ./scripts/setup-server.sh 生成非 root unit"
  }
  run_as_user "${svc_user}" test -r "${db_path}" -a -w "$(dirname "${db_path}")" -a -r "${store_root}" -a -w "${store_root}" || {
    die "服务用户 ${svc_user} 无法读写数据库或媒体目录"
  }

  local media_count
  media_count="$(verify_media_files "${db_path}" "${store_root}")" || {
    die "媒体文件与数据库不一致，请从旧目录或备份恢复上述文件"
  }
  log "媒体完整性通过：${media_count} 条本地素材记录"
  log "前置检查通过"
}

# 校验 systemd 主进程运行的是当前代码入口；通过则输出 PID
service_entry_ok() {
  local service_name="$1" server_entry="$2"
  local main_pid args
  main_pid="$(run_as_root systemctl show "${service_name}" --property MainPID --value)"
  [[ -n "${main_pid}" && "${main_pid}" != "0" ]] || {
    die "服务 ${service_name} 未运行（MainPID 为空）"
  }
  args="$(ps -p "${main_pid}" -o args= 2>/dev/null || true)"
  [[ "${args}" == *"${server_entry}"* ]] || {
    die "服务未运行当前代码入口（PID=${main_pid}）：${args}"
  }
  printf '%s' "${main_pid}"
}

# Linux 生产机上核对运行中进程实际采用的关键配置，防止只看 unit 文件而命中旧进程。
verify_service_runtime_config() {
  local main_pid="${1:?}" db_path="${2:?}" store_root="${3:?}" port="${4:?}"
  local environ_file="/proc/${main_pid}/environ"
  run_as_root test -r "${environ_file}" 2>/dev/null || return 0
  local runtime_env
  runtime_env="$(run_as_root cat "${environ_file}" | tr '\0' '\n')"
  printf '%s\n' "${runtime_env}" | grep -Fxq "DB_PATH=${db_path}" \
    || die "运行中服务的 DB_PATH 与生产配置不一致"
  printf '%s\n' "${runtime_env}" | grep -Fxq "STORE_ROOT=${store_root}" \
    || die "运行中服务的 STORE_ROOT 与生产配置不一致"
  printf '%s\n' "${runtime_env}" | grep -Fxq "PORT=${port}" \
    || die "运行中服务的 PORT 与生产配置不一致"
}

# 抓取首页并做 30 秒健康等待；失败即退出
fetch_homepage() {
  local local_url="$1"
  local html=""
  for _ in {1..30}; do
    if html="$(curl -fsS "${local_url}/" 2>/dev/null)"; then break; fi
    sleep 1
  done
  [[ -n "${html}" ]] || {
    die "服务在 30 秒内未通过首页健康检查：${local_url}"
  }
  printf '%s' "${html}"
}

verify_api_json() {
  local local_url="$1"
  curl -fsS "${local_url}/api/health" 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => { s += d; });
    process.stdin.on("end", () => {
      try { const parsed = JSON.parse(s); if (parsed.ok !== true) process.exit(1); }
      catch { process.exit(1); }
    });
  ' || {
    die "${local_url}/api/health 返回的不是有效健康 JSON"
  }
}

# 页面资源哈希与本次构建一致
verify_page_assets() {
  local local_url="$1" dist_index="$2" home_html="$3"
  local built live
  built="$(grep -oE 'assets/index-[^"[:space:]]+\.(js|css)' "${dist_index}" | LC_ALL=C sort -u || true)"
  live="$(printf '%s' "${home_html}" | grep -oE 'assets/index-[^"[:space:]]+\.(js|css)' | LC_ALL=C sort -u || true)"
  [[ -n "${built}" ]] || die "无法从 ${dist_index} 提取构建资源名"
  [[ "${live}" == "${built}" ]] || {
    printf '[deploy] 构建资源:\n%s\n[deploy] 本机服务资源:\n%s\n' "${built}" "${live}" >&2
    die "本机 ${local_url} 提供的不是本次构建结果"
  }
}

# 部署后数据基线一致性（deploy.sh 使用）
verify_data_counts() {
  local db_path="$1" pre_projects="$2" pre_assets="$3"
  local post_projects post_assets
  post_projects="$(db_projects_count "${db_path}")"
  post_assets="$(db_assets_count "${db_path}")"
  [[ "${post_projects}" == "${pre_projects}" && "${post_assets}" == "${pre_assets}" ]] || {
    die "部署后数据异常：项目 ${pre_projects}→${post_projects}，素材 ${pre_assets}→${post_assets}。请立即检查并恢复备份"
  }
  log "数据校验通过：${post_projects} 个项目 / ${post_assets} 个素材（与部署前一致）"
}

# 账号系统启用后，业务接口需要登录，项目数不再通过未授权接口暴露。
# 该检查改为：API 健康可用（/api/health）+ 数据库计数可读，二者一致由
# verify_service_runtime_config（进程 DB_PATH 与生产配置一致）保证。
verify_api_counts_match_db() {
  local local_url="$1" db_path="$2"
  local db_count
  curl -fsS "${local_url}/api/health" >/dev/null 2>&1 || die "API 健康检查失败：${local_url}/api/health"
  db_count="$(db_projects_count "${db_path}")"
  [[ "${db_count}" != "?" ]] || die "数据库项目数不可读：${db_path}"
  log "API 健康可用，数据库 ${db_count} 个项目"
}
