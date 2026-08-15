#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
validation_env="$project_root/infra/resourcespace/.env.validation"

if [ ! -f "$validation_env" ]; then
  printf 'Missing %s\n' "$validation_env" >&2
  printf 'Create it with RS_BASE_URL, RS_API_USER and RS_API_KEY after ResourceSpace setup.\n' >&2
  exit 1
fi

set -a
. "$validation_env"
set +a

: "${RS_BASE_URL:?RS_BASE_URL is required}"
: "${RS_API_USER:?RS_API_USER is required}"
: "${RS_API_KEY:?RS_API_KEY is required}"

query="user=$RS_API_USER&function=get_system_status"
signature=$(printf '%s' "$RS_API_KEY$query" | openssl dgst -sha256 | awk '{print $NF}')
response=$(curl --fail --silent --show-error \
  --noproxy '*' \
  --get "$RS_BASE_URL/api/" \
  --data-urlencode "user=$RS_API_USER" \
  --data-urlencode 'function=get_system_status' \
  --data-urlencode "sign=$signature")

printf '%s\n' "$response" | jq -e '.status == "OK"' >/dev/null
printf '%s\n' "$response" | jq .
printf 'Signed ResourceSpace API call passed.\n'
