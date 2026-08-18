#!/usr/bin/env bash
# 部署共享函数库：被 scripts/deploy.sh、scripts/check-production.sh、scripts/setup-server.sh 引用。
# 本文件只定义纯函数，不执行任何副作用。

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] 错误: %s\n' "$*" >&2; exit 1; }

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
    const db = new DatabaseSync(process.argv[1]);
    const row = db.prepare("PRAGMA quick_check").get();
    console.log(Object.values(row)[0]);
  ' "$1"
}

db_projects_count() {
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1]);
    console.log(db.prepare("SELECT COUNT(*) c FROM projects").get().c);
  ' "$1"
}

db_assets_count() {
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1]);
    console.log(db.prepare("SELECT COUNT(*) c FROM assets WHERE deleted_at IS NULL").get().c);
  ' "$1"
}

# 是否包含示例项目（示例数据 id 固定，真实项目为 UUID，不会误判）
db_has_demo() {
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1]);
    const row = db.prepare("SELECT COUNT(*) c FROM projects WHERE id IN (?, ?)")
      .get("project-visual-direction", "project-material-language");
    console.log(row.c > 0 ? "yes" : "no");
  ' "$1"
}

db_is_empty() {
  [[ "$(db_projects_count "$1")" -eq 0 ]]
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
    recovery_hint
  }

  path_inside_repo "${db_path}" "${repo_dir}" && {
    die "数据库位于仓库内：${db_path}。生产数据必须在仓库外（/var/lib/artdatabase/），请执行 sudo ./scripts/setup-server.sh 迁移"
    recovery_hint
  }

  [[ -s "${db_path}" ]] || {
    die "数据库文件不存在或为空：${db_path}"
    recovery_hint
  }

  local check
  check="$(db_quick_check "${db_path}")"
  [[ "${check}" == "ok" ]] || {
    die "SQLite quick_check 失败（${check}）：${db_path}"
    recovery_hint
  }

  grep -q '^SEED_DEMO=1' "${env_file}" 2>/dev/null && {
    die "配置 ${env_file} 中存在 SEED_DEMO=1，生产环境禁止示例数据，请删除该行"
    recovery_hint
  }
  [[ "${SEED_DEMO:-}" != "1" ]] || {
    die "环境中存在 SEED_DEMO=1，生产环境禁止示例数据"
    recovery_hint
  }
  local unit_env
  unit_env="$(run_as_root systemctl show "${service_name}" --property Environment --value 2>/dev/null || true)"
  printf '%s' "${unit_env}" | grep -q 'SEED_DEMO=1' && {
    die "systemd unit 中存在 SEED_DEMO=1，请运行 sudo ./scripts/setup-server.sh 重新生成"
    recovery_hint
  }

  db_is_empty "${db_path}" && {
    die "数据库为空库（0 个项目）。前置条件要求库中已有真实数据；请先在界面创建数据，或从备份恢复"
    recovery_hint
  }
  [[ "$(db_has_demo "${db_path}")" == "yes" ]] && {
    die "数据库包含示例项目（project-visual-direction / project-material-language）。请删除示例数据或确认 DB_PATH 指向真实数据库"
    recovery_hint
  }

  [[ -d "${store_root}" && -r "${store_root}" ]] || {
    die "媒体目录不存在或不可读：${store_root}"
    recovery_hint
  }

  local svc_user
  svc_user="$(run_as_root systemctl show "${service_name}" --property User --value 2>/dev/null || true)"
  [[ -n "${svc_user}" && "${svc_user}" != "root" ]] || {
    die "服务以 root 用户运行（User=${svc_user:-未设置}）。请运行 sudo ./scripts/setup-server.sh 生成非 root unit"
    recovery_hint
  }
  log "前置检查通过"
}

# 校验 systemd 主进程运行的是当前代码入口；通过则输出 PID
service_entry_ok() {
  local service_name="$1" server_entry="$2"
  local main_pid args
  main_pid="$(run_as_root systemctl show "${service_name}" --property MainPID --value)"
  [[ -n "${main_pid}" && "${main_pid}" != "0" ]] || {
    die "服务 ${service_name} 未运行（MainPID 为空）"
    recovery_hint
  }
  args="$(ps -p "${main_pid}" -o args= 2>/dev/null || true)"
  [[ "${args}" == *"${server_entry}"* ]] || {
    die "服务未运行当前代码入口（PID=${main_pid}）：${args}"
    recovery_hint
  }
  printf '%s' "${main_pid}"
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
    recovery_hint
  }
  printf '%s' "${html}"
}

verify_api_json() {
  local local_url="$1"
  curl -fsS "${local_url}/api/projects" 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => { s += d; });
    process.stdin.on("end", () => {
      try { JSON.parse(s); } catch { process.exit(1); }
    });
  ' || {
    die "${local_url}/api/projects 返回的不是有效 JSON"
    recovery_hint
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
    recovery_hint
  }
  log "数据校验通过：${post_projects} 个项目 / ${post_assets} 个素材（与部署前一致）"
}

# API 项目数与数据库一致（check-production.sh 使用，只读）
verify_api_counts_match_db() {
  local local_url="$1" db_path="$2"
  local api_count db_count
  api_count="$(curl -fsS "${local_url}/api/projects" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).projects||[]).length)}catch{console.log("?")}})')"
  db_count="$(db_projects_count "${db_path}")"
  [[ "${api_count}" == "${db_count}" && "${api_count}" != "?" ]] || {
    die "API 项目数（${api_count}）与数据库（${db_count}）不一致"
    recovery_hint
  }
  log "API 与数据库一致：${db_count} 个项目"
}
