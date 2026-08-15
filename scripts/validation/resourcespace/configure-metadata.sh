#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
validation_env="$project_root/infra/resourcespace/.env.validation"

if [ ! -f "$validation_env" ]; then
  printf 'Missing %s\n' "$validation_env" >&2
  exit 1
fi

set -a
. "$validation_env"
set +a

: "${RS_BASE_URL:?RS_BASE_URL is required}"
: "${RS_API_USER:?RS_API_USER is required}"
: "${RS_API_KEY:?RS_API_KEY is required}"

api_call() {
  query=$1
  method=${2:-GET}
  signature=$(printf '%s' "$RS_API_KEY$query" | openssl dgst -sha256 | awk '{print $NF}')
  curl --noproxy '*' --fail --silent --show-error -X "$method" \
    "$RS_BASE_URL/api/?$query&sign=$signature"
}

lookup_query="user=$RS_API_USER&function=get_resource_type_fields&by_resource_types=1&find=artdatabase_source_url"
fields=$(api_call "$lookup_query")
if [ "$(printf '%s' "$fields" | jq 'length')" -eq 0 ]; then
  create_query="user=$RS_API_USER&function=create_resource_type_field&name=artdatabase_source_url&resource_types=1&type=0"
  api_call "$create_query" POST | jq -e '.status == "success"' >/dev/null
  printf 'Created ResourceSpace metadata field: artdatabasesourceurl\n'
else
  printf 'ResourceSpace metadata field is ready: artdatabasesourceurl\n'
fi
