#!/usr/bin/env bash
# 部署脚本测试：lib 函数单测 + setup-server 迁移决策(dry-run) + check-production 正反用例 + deploy 端到端。
# 用法：bash scripts/test-deploy.sh   （不需要 root；systemd 用 PATH 里的 fake 实现代替）
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LIB="${ROOT}/lib-deploy.sh"
REAL_REPO="$(cd -- "${ROOT}/.." && pwd)"
TMP="$(mktemp -d /tmp/artdb-deploy-test-XXXXXX)"
FAILURES=0
PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "${pid}" 2>/dev/null || true; done
  rm -rf "${TMP}"
}
trap cleanup EXIT

pass() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s: %s\n' "$1" "$2"; FAILURES=$((FAILURES + 1)); }
check() {
  if [[ "$3" == "$2" ]]; then pass "$1"; else fail "$1" "期望[$2] 实际[$3]"; fi
}
check_exit() { # name expected_exit actual_exit
  if [[ "$3" -eq "$2" ]]; then pass "$1"; else fail "$1" "期望退出码 $2，实际 $3"; fi
}

# ---------- fake systemctl / sudo ----------
FAKEBIN="${TMP}/fakebin"
mkdir -p "${FAKEBIN}"
cat >"${FAKEBIN}/sudo" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "-u" ]]; then shift 2; fi
if [[ "${1:-}" == "--" ]]; then shift; fi
exec "$@"
EOF
cat >"${FAKEBIN}/systemctl" <<'EOF'
#!/usr/bin/env bash
cmd="$1"; shift || true
case "${cmd}" in
  cat) printf '[Unit]\nDescription=fake unit\n' ;;
  show)
    prop=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --property) prop="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    case "${prop}" in
      MainPID) printf '%s\n' "${FAKE_MAINPID:-}" ;;
      User) printf '%s\n' "${FAKE_SERVICE_USER:-artdatabase}" ;;
      Environment) printf '%s\n' "${FAKE_UNIT_ENV:-}" ;;
    esac
    ;;
  is-active) exit 0 ;;
  restart | daemon-reload | enable) exit 0 ;;
  status) printf 'fake status: active\n'; exit 0 ;;
  *) exit 0 ;;
esac
EOF
cat >"${FAKEBIN}/ps" <<'EOF'
#!/usr/bin/env bash
# fake ps：模拟系统 ps 返回服务进程命令行（沙箱环境 /bin/ps 不可用）
printf '%s\n' "${FAKE_PS_ARGS:-}"
EOF
chmod +x "${FAKEBIN}/sudo" "${FAKEBIN}/systemctl" "${FAKEBIN}/ps"

make_db() { # path label(empty|demo|real)
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1]);
    db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, description TEXT, created_at TEXT, updated_at TEXT)");
    db.exec("CREATE TABLE assets (id TEXT PRIMARY KEY, name TEXT, file_name TEXT, thumbnail_url TEXT, storage_key TEXT, thumbnail_key TEXT, tags TEXT, description TEXT, notes TEXT, source_url TEXT, file_size INTEGER, width INTEGER, height INTEGER, mime_type TEXT, created_at TEXT, deleted_at TEXT)");
    if (process.argv[2] === "demo") {
      db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run("project-visual-direction", "示例项目");
    } else if (process.argv[2] === "real") {
      db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run("11111111-2222-3333-4444-555555555555", "真实项目");
    } else if (process.argv[2] === "asset-only") {
      db.prepare("INSERT INTO assets (id, name, file_name) VALUES (?, ?, ?)").run("asset-only", "全局素材", "asset.jpg");
    } else if (process.argv[2] === "local-media") {
      db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run("11111111-2222-3333-4444-555555555555", "真实项目");
      db.prepare("INSERT INTO assets (id, name, file_name, storage_key, thumbnail_key) VALUES (?, ?, ?, ?, ?)")
        .run("asset-local", "本地素材", "asset.jpg", "file-a", "file-a");
    }
  ' "$1" "$2"
}

echo "== 1. lib 函数单测 =="
source "${LIB}"

mkdir -p "${TMP}/env"
cat >"${TMP}/env/prod.env" <<EOF
PORT=3000
DB_PATH=/var/lib/artdatabase/app.db
STORE_ROOT=/var/lib/artdatabase/media
SERVICE_NAME=artdatabase
RUN_USER=artdatabase
SEED_DEMO=1
EOF
LOADED="$(env -i bash -c "source \"${LIB}\"; env_load \"${TMP}/env/prod.env\"; printf '%s|%s|%s|%s' \"\${PORT}\" \"\${DB_PATH}\" \"\${SERVICE_NAME}\" \"\${SEED_DEMO:-unset}\"")"
check "env_load 加载白名单字段" "3000|/var/lib/artdatabase/app.db|artdatabase|unset" "${LOADED}"
LOADED_PRE="$(env -i PORT=9999 bash -c "source \"${LIB}\"; env_load \"${TMP}/env/prod.env\"; printf '%s' \"\${PORT}\"")"
check "env_load 环境变量优先" "9999" "${LOADED_PRE}"

mkdir -p "${TMP}/dbs"
make_db "${TMP}/dbs/empty.db" empty
make_db "${TMP}/dbs/demo.db" demo
make_db "${TMP}/dbs/real.db" real
make_db "${TMP}/dbs/asset-only.db" asset-only
make_db "${TMP}/dbs/local-media.db" local-media
check "quick_check ok" "ok" "$(db_quick_check "${TMP}/dbs/real.db")"
check "projects 计数 real" "1" "$(db_projects_count "${TMP}/dbs/real.db")"
check "projects 计数 empty" "0" "$(db_projects_count "${TMP}/dbs/empty.db")"
check "assets 计数" "0" "$(db_assets_count "${TMP}/dbs/real.db")"
check "has_demo demo=yes" "yes" "$(db_has_demo "${TMP}/dbs/demo.db")"
check "has_demo real=no" "no" "$(db_has_demo "${TMP}/dbs/real.db")"
if db_is_empty "${TMP}/dbs/empty.db"; then pass "is_empty empty=true"; else fail "is_empty empty=true" "返回 false"; fi
if db_is_empty "${TMP}/dbs/real.db"; then fail "is_empty real=false" "返回 true"; else pass "is_empty real=false"; fi
if db_is_empty "${TMP}/dbs/asset-only.db"; then fail "is_empty asset-only=false" "返回 true"; else pass "is_empty asset-only=false"; fi

if validate_service_name "artdatabase-prod_1"; then pass "合法 systemd 服务名"; else fail "合法 systemd 服务名" "被拒绝"; fi
if validate_service_name 'bad;touch-x'; then fail "非法 systemd 服务名" "未被拒绝"; else pass "非法 systemd 服务名"; fi

sqlite_backup "${TMP}/dbs/real.db" "${TMP}/dbs/real-backup.db"
check "SQLite 一致性备份" "1" "$(db_projects_count "${TMP}/dbs/real-backup.db")"

mkdir -p "${TMP}/media-source/blobs" "${TMP}/media-source/thumbs"
printf 'blob' >"${TMP}/media-source/blobs/a"
printf 'thumb' >"${TMP}/media-source/thumbs/a"
copy_media_tree "${TMP}/media-source" "${TMP}/media-target"
check "媒体树复制原图" "yes" "$([[ -f "${TMP}/media-target/blobs/a" ]] && echo yes || echo no)"
check "媒体树复制缩略图" "yes" "$([[ -f "${TMP}/media-target/thumbs/a" ]] && echo yes || echo no)"
set +e
bash -c 'source "$1"; copy_media_tree "$2" "$3"' _ "${LIB}" "${TMP}/media-source" "${TMP}/media-target" >/dev/null 2>&1
RC_MEDIA_OVERWRITE=$?
set -e
check_exit "媒体复制拒绝覆盖非空目录" 1 "${RC_MEDIA_OVERWRITE}"

mkdir -p "${TMP}/verified-media/blobs" "${TMP}/verified-media/thumbs"
printf 'blob' >"${TMP}/verified-media/blobs/file-a"
printf 'thumb' >"${TMP}/verified-media/thumbs/file-a"
check "媒体完整性校验通过" "1" "$(verify_media_files "${TMP}/dbs/local-media.db" "${TMP}/verified-media")"
mkdir -p "${TMP}/missing-media/blobs" "${TMP}/missing-media/thumbs"
printf 'blob' >"${TMP}/missing-media/blobs/file-a"
set +e
verify_media_files "${TMP}/dbs/local-media.db" "${TMP}/missing-media" >/dev/null 2>&1
RC_MISSING_MEDIA=$?
set -e
check_exit "媒体完整性拒绝缺失缩略图" 1 "${RC_MISSING_MEDIA}"

if path_inside_repo "/repo/data/app.db" "/repo"; then pass "path_inside_repo 仓库内=true"; else fail "path_inside_repo 仓库内=true" "返回 false"; fi
if path_inside_repo "/var/lib/artdatabase/app.db" "/repo"; then fail "path_inside_repo 仓库外=false" "返回 true"; else pass "path_inside_repo 仓库外=false"; fi

mkdir -p "${TMP}/probe1/data" "${TMP}/probe1/app/data"
cp "${TMP}/dbs/real.db" "${TMP}/probe1/data/app.db"
PROBES="$(DATA_DIR="${TMP}/probe1/none" probe_databases "${TMP}/probe1")"
check "probe 仅仓库 data/ 一个" "${TMP}/probe1/data/app.db" "${PROBES}"
PROBES2="$(DATA_DIR="${TMP}/probe1/none" probe_databases "${TMP}/probe1" >/dev/null; true)"
mkdir -p "${TMP}/probe2"
cp "${TMP}/dbs/real.db" "${TMP}/probe2/data-app.db" 2>/dev/null || true
PROBES3="$(DATA_DIR="${TMP}/probe2/var" probe_databases "${TMP}/probe2")"
check "probe 无任何库为空" "" "${PROBES3}"

echo "== 2. setup-server 迁移决策（--dry-run）=="
SETUP="${ROOT}/setup-server.sh"
mkdir -p "${TMP}/repo/.git" "${TMP}/repo/app/server"
touch "${TMP}/repo/.git/HEAD" "${TMP}/repo/app/server/index.js"
git -C "${TMP}/repo" init -q 2>/dev/null || true

# 单个旧库（app/data）→ 输出备份与迁移
mkdir -p "${TMP}/repo/app/data"
cp "${TMP}/dbs/real.db" "${TMP}/repo/app/data/app.db"
mkdir -p "${TMP}/repo/app/data/media/blobs" "${TMP}/repo/app/data/media/thumbs"
printf 'old-blob' >"${TMP}/repo/app/data/media/blobs/old-file"
OUT="$(DATA_DIR="${TMP}/var1" REPO_DIR="${TMP}/repo" bash "${SETUP}" --dry-run 2>&1)"
check "单库迁移包含一致性备份" "yes" "$(printf '%s' "${OUT}" | grep -q '一致性备份' && echo yes || echo no)"
check "单库迁移包含安全复制" "yes" "$(printf '%s' "${OUT}" | grep -q '复制备份到生产库' && echo yes || echo no)"
check "单库迁移包含媒体复制" "yes" "$(printf '%s' "${OUT}" | grep -q '复制媒体目录' && echo yes || echo no)"
check "dry-run 不移动原文件" "yes" "$([[ -s "${TMP}/repo/app/data/app.db" ]] && echo yes || echo no)"

# 多个旧库 → 停止
mkdir -p "${TMP}/repo/data"
cp "${TMP}/dbs/demo.db" "${TMP}/repo/data/app.db"
set +e
OUT2="$(DATA_DIR="${TMP}/var2" REPO_DIR="${TMP}/repo" bash "${SETUP}" --dry-run 2>&1)"
RC2=$?
set -e
check_exit "多库共存退出码非 0" 1 "${RC2}"
check "多库共存提示" "yes" "$(printf '%s' "${OUT2}" | grep -q '多个数据库' && echo yes || echo no)"
rm -f "${TMP}/repo/app/data/app.db" "${TMP}/repo/data/app.db"

# 无库且未确认 → 停止
set +e
OUT3="$(DATA_DIR="${TMP}/var3" REPO_DIR="${TMP}/repo" bash "${SETUP}" --dry-run 2>&1)"
RC3=$?
set -e
check_exit "无库未确认退出码非 0" 1 "${RC3}"
check "无库未确认提示 INIT_EMPTY_DB" "yes" "$(printf '%s' "${OUT3}" | grep -q 'INIT_EMPTY_DB=1' && echo yes || echo no)"

# 无库 + INIT_EMPTY_DB=1 → 允许
OUT4="$(DATA_DIR="${TMP}/var4" INIT_EMPTY_DB=1 REPO_DIR="${TMP}/repo" bash "${SETUP}" --dry-run 2>&1)"
check "INIT_EMPTY_DB 允许空库" "yes" "$(printf '%s' "${OUT4}" | grep -q '创建空库' && echo yes || echo no)"

set +e
OUT_BAD_NAME="$(DATA_DIR="${TMP}/var5" INIT_EMPTY_DB=1 REPO_DIR="${TMP}/repo" bash "${SETUP}" --dry-run '--service-name=bad;name' 2>&1)"
RC_BAD_NAME=$?
set -e
check_exit "setup 拒绝非法服务名" 1 "${RC_BAD_NAME}"

echo "== 3. check-production 只读检查 =="
CHECK="${ROOT}/check-production.sh"
PC_PORT=$(( (RANDOM % 2000) + 4000 ))

# 启动真实服务（真实仓库代码），供正向用例使用
mkdir -p "${TMP}/pc/media"
DB_PATH="${TMP}/pc/app.db" STORE_ROOT="${TMP}/pc/media" PORT="${PC_PORT}" node "${REAL_REPO}/app/server/index.js" &
PC_PID=$!
PIDS+=("${PC_PID}")
for _ in $(seq 1 20); do curl -fsS "http://127.0.0.1:${PC_PORT}/api/projects" >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS -X POST "http://127.0.0.1:${PC_PORT}/api/projects" -H 'content-type: application/json' -d '{"name":"真实项目"}' >/dev/null

cat >"${TMP}/pc/env" <<EOF
PORT=${PC_PORT}
DB_PATH=${TMP}/pc/app.db
STORE_ROOT=${TMP}/pc/media
SERVICE_NAME=artdatabase
EOF

run_check() { # 期望退出码, 期望输出片段, env_file, REPO_DIR(默认真实仓库)
  local expect_rc="$1" expect_text="$2" envfile="$3" repo_dir="${4:-${REAL_REPO}}"
  local out rc
  set +e
  out="$(PATH="${FAKEBIN}:${PATH}" FAKE_MAINPID="${PC_PID}" FAKE_PS_ARGS="node ${REAL_REPO}/app/server/index.js" ENV_FILE="${envfile}" REPO_DIR="${repo_dir}" bash "${CHECK}" 2>&1)"
  rc=$?
  set -e
  check_exit "check ${expect_text} 退出码" "${expect_rc}" "${rc}"
  if [[ -n "${expect_text}" ]]; then
    check "check ${expect_text} 输出" "yes" "$(printf '%s' "${out}" | grep -q "${expect_text}" && echo yes || echo no)"
  fi
}

run_check 0 "生产检查通过" "${TMP}/pc/env"

# 空库
make_db "${TMP}/pc-empty.db" empty
cat >"${TMP}/pc/env-empty" <<EOF
PORT=${PC_PORT}
DB_PATH=${TMP}/pc-empty.db
STORE_ROOT=${TMP}/pc/media
SERVICE_NAME=artdatabase
EOF
run_check 1 "数据库为空库" "${TMP}/pc/env-empty"

# 示例库
make_db "${TMP}/pc-demo.db" demo
cat >"${TMP}/pc/env-demo" <<EOF
PORT=${PC_PORT}
DB_PATH=${TMP}/pc-demo.db
STORE_ROOT=${TMP}/pc/media
SERVICE_NAME=artdatabase
EOF
run_check 1 "包含示例项目" "${TMP}/pc/env-demo"

# 数据库缺失
cat >"${TMP}/pc/env-missing-db" <<EOF
PORT=${PC_PORT}
DB_PATH=${TMP}/pc/nope.db
STORE_ROOT=${TMP}/pc/media
SERVICE_NAME=artdatabase
EOF
run_check 1 "数据库文件不存在" "${TMP}/pc/env-missing-db"

# 数据库位于仓库内（REPO_DIR 取含库目录本身）
mkdir -p "${TMP}/inrepo/data"
cp "${TMP}/pc/app.db" "${TMP}/inrepo/data/app.db"
cat >"${TMP}/pc/env-inrepo" <<EOF
PORT=${PC_PORT}
DB_PATH=${TMP}/inrepo/data/app.db
STORE_ROOT=${TMP}/pc/media
SERVICE_NAME=artdatabase
EOF
run_check 1 "数据库位于仓库内" "${TMP}/pc/env-inrepo" "${TMP}/inrepo"

# SEED_DEMO=1
cat >"${TMP}/pc/env-seed" <<EOF
PORT=${PC_PORT}
DB_PATH=${TMP}/pc/app.db
STORE_ROOT=${TMP}/pc/media
SERVICE_NAME=artdatabase
SEED_DEMO=1
EOF
run_check 1 "SEED_DEMO=1" "${TMP}/pc/env-seed"

# 媒体目录缺失
cat >"${TMP}/pc/env-nomedia" <<EOF
PORT=${PC_PORT}
DB_PATH=${TMP}/pc/app.db
STORE_ROOT=${TMP}/pc/nomedia
SERVICE_NAME=artdatabase
EOF
run_check 1 "媒体目录不存在" "${TMP}/pc/env-nomedia"

# 服务以 root 运行
set +e
OUT_ROOT="$(PATH="${FAKEBIN}:${PATH}" FAKE_MAINPID="${PC_PID}" FAKE_SERVICE_USER="root" ENV_FILE="${TMP}/pc/env" REPO_DIR="${REAL_REPO}" bash "${CHECK}" 2>&1)"
RC_ROOT=$?
set -e
check_exit "root 用户运行退出码非 0" 1 "${RC_ROOT}"
check "root 用户运行提示" "yes" "$(printf '%s' "${OUT_ROOT}" | grep -q '以 root 用户运行' && echo yes || echo no)"

# 配置缺失
set +e
OUT_NOENV="$(PATH="${FAKEBIN}:${PATH}" ENV_FILE="${TMP}/pc/not-exists" REPO_DIR="${REAL_REPO}" bash "${CHECK}" 2>&1)"
RC_NOENV=$?
set -e
check_exit "缺少 env 文件退出码非 0" 1 "${RC_NOENV}"

echo "== 4. deploy 端到端（fake systemctl）=="
# 用当前工作树构建"新版本"，推到裸仓库，再克隆为"服务器副本"
NEWVER="${TMP}/newver"
mkdir -p "${NEWVER}"
(cd "${REAL_REPO}" && tar --exclude=.git --exclude=node_modules --exclude=app/dist --exclude=app/data --exclude=app/node_modules --exclude=tmp -cf - .) | (cd "${NEWVER}" && tar -xf -)
git -C "${NEWVER}" init -q
git -C "${NEWVER}" add -A
git -C "${NEWVER}" -c user.email=t@t -c user.name=t commit -qm "new version"
git init -q --bare "${TMP}/dep-bare.git"
git -C "${TMP}/dep-bare.git" symbolic-ref HEAD refs/heads/main
git -C "${NEWVER}" remote add origin "${TMP}/dep-bare.git"
git -C "${NEWVER}" push -q origin main
git clone -q "${TMP}/dep-bare.git" "${TMP}/dep-repo"
# 服务器副本需要依赖才能运行（真实服务器上已有 node_modules）
(
  cd "${TMP}/dep-repo/app"
  npm ci --no-audit --no-fund >/dev/null 2>&1
)

DEP_PORT=$(( (RANDOM % 2000) + 6000 ))
mkdir -p "${TMP}/dep-data/media" "${TMP}/dep"
cat >"${TMP}/dep/env" <<EOF
PORT=${DEP_PORT}
DB_PATH=${TMP}/dep-data/app.db
STORE_ROOT=${TMP}/dep-data/media
SERVICE_NAME=artdatabase
EOF
DB_PATH="${TMP}/dep-data/app.db" STORE_ROOT="${TMP}/dep-data/media" PORT="${DEP_PORT}" node "${TMP}/dep-repo/app/server/index.js" &
DEP_PID=$!
PIDS+=("${DEP_PID}")
for _ in $(seq 1 20); do curl -fsS "http://127.0.0.1:${DEP_PORT}/api/projects" >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS -X POST "http://127.0.0.1:${DEP_PORT}/api/projects" -H 'content-type: application/json' -d '{"name":"生产项目"}' >/dev/null

set +e
DEP_OUT="$(PATH="${FAKEBIN}:${PATH}" FAKE_MAINPID="${DEP_PID}" FAKE_PS_ARGS="node ${TMP}/dep-repo/app/server/index.js" ENV_FILE="${TMP}/dep/env" REPO_DIR="${TMP}/dep-repo" bash "${TMP}/dep-repo/scripts/deploy.sh" 2>&1)"
DEP_RC=$?
set -e
check_exit "deploy 端到端退出码 0" 0 "${DEP_RC}"
check "deploy 输出部署成功" "yes" "$(printf '%s' "${DEP_OUT}" | grep -q '部署成功' && echo yes || echo no)"
check "deploy 无错误输出" "yes" "$(printf '%s' "${DEP_OUT}" | grep -q '\[deploy\] 错误' && echo no || echo yes)"
check "deploy 输出 commit" "yes" "$(printf '%s' "${DEP_OUT}" | grep -q 'commit=' && echo yes || echo no)"

# deploy：env 文件缺失必须直接失败
set +e
DEP_NOENV="$(PATH="${FAKEBIN}:${PATH}" ENV_FILE="${TMP}/dep/not-exists" REPO_DIR="${TMP}/dep-repo" bash "${TMP}/dep-repo/scripts/deploy.sh" 2>&1)"
DEP_NOENV_RC=$?
set -e
check_exit "deploy 缺 env 退出码非 0" 1 "${DEP_NOENV_RC}"

echo
if [[ ${FAILURES} -eq 0 ]]; then
  echo "全部通过"
else
  echo "${FAILURES} 项失败"
  exit 1
fi
