#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
fixture_dir="$project_root/validation-results/resourcespace/fixtures"

mkdir -p "$fixture_dir"

# A valid 1x1 PNG. B is byte-identical under a different filename. C has the
# same visible pixels and one harmless trailing byte, so its full-file hash differs.
printf '%s' '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc00000040101005f55c4890000000049454e44ae426082' \
  | xxd -r -p > "$fixture_dir/image-a.png"
cp "$fixture_dir/image-a.png" "$fixture_dir/image-b-renamed.png"
cp "$fixture_dir/image-a.png" "$fixture_dir/image-c-reexported.png"
printf '\0' >> "$fixture_dir/image-c-reexported.png"

hash_a=$(shasum -a 256 "$fixture_dir/image-a.png" | awk '{print $1}')
hash_b=$(shasum -a 256 "$fixture_dir/image-b-renamed.png" | awk '{print $1}')
hash_c=$(shasum -a 256 "$fixture_dir/image-c-reexported.png" | awk '{print $1}')

test "$hash_a" = "$hash_b"
test "$hash_a" != "$hash_c"

{
  printf 'image-a.png %s\n' "$hash_a"
  printf 'image-b-renamed.png %s\n' "$hash_b"
  printf 'image-c-reexported.png %s\n' "$hash_c"
} > "$fixture_dir/sha256.txt"

printf 'Fixture hash assertions passed.\n'
cat "$fixture_dir/sha256.txt"

