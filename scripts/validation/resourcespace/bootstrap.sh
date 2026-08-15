#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
infra_dir="$project_root/infra/resourcespace"
env_file="$infra_dir/.env"
runtime_dir="$infra_dir/runtime"

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    printf 'Missing required command: docker compose or docker-compose\n' >&2
    return 127
  fi
}

for required_command in docker openssl; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$required_command" >&2
    exit 1
  fi
done

mkdir -p "$runtime_dir"

if [ ! -f "$env_file" ]; then
  db_password=$(openssl rand -hex 24)
  root_password=$(openssl rand -hex 24)
  umask 077
  {
    printf 'RS_PORT=18080\n'
    printf 'MYSQL_DATABASE=resourcespace\n'
    printf 'MYSQL_USER=resourcespace_rw\n'
    printf 'MYSQL_PASSWORD=%s\n' "$db_password"
    printf 'MYSQL_ROOT_PASSWORD=%s\n' "$root_password"
  } > "$env_file"
  printf 'Created %s\n' "$env_file"
fi

if [ ! -f "$runtime_dir/config.php" ]; then
  : > "$runtime_dir/config.php"
  chmod 666 "$runtime_dir/config.php"
  printf 'Created %s\n' "$runtime_dir/config.php"
fi

docker version >/dev/null
compose version >/dev/null
printf 'ResourceSpace validation prerequisites are ready.\n'
