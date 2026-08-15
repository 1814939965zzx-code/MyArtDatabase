#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
infra_dir="$project_root/infra/resourcespace"

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

"$project_root/scripts/validation/resourcespace/bootstrap.sh"

compose \
  --env-file "$infra_dir/.env" \
  -f "$infra_dir/docker-compose.yaml" \
  up -d

rs_port=$(sed -n 's/^RS_PORT=//p' "$infra_dir/.env")
rs_port=${rs_port:-18080}

attempt=1
while [ "$attempt" -le 60 ]; do
  if curl --fail --silent --show-error "http://127.0.0.1:$rs_port/" >/dev/null 2>&1; then
    printf 'ResourceSpace is reachable at http://localhost:%s\n' "$rs_port"
    exit 0
  fi
  sleep 2
  attempt=$((attempt + 1))
done

printf 'ResourceSpace did not become reachable in time.\n' >&2
compose \
  --env-file "$infra_dir/.env" \
  -f "$infra_dir/docker-compose.yaml" \
  ps >&2
exit 1
