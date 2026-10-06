#!/usr/bin/env bash
# Clones Tenantry Core and the Tenantry Pro docs at the tag of the release the skills target
# (scripts/tenantry-version.txt) into a folder, and prints the options that give them to validate.mjs, which checks the
# skills' links to the docs against them. The workflows use it:
#
#   args="$(scripts/fetch-docs.sh "$RUNNER_TEMP")"
#   node scripts/validate.mjs $args
#
# Each repository on its own: a missing tag in one leaves the other's headings checked. Only a missing tag is skipped,
# with a notice; any other failure to reach a repository fails the script.
set -euo pipefail

into="$1"
version="$(tr -d '[:space:]' < "$(dirname "$0")/tenantry-version.txt")"
args=""
for pair in core:tenantry-core pro:tenantry-pro-docs; do
  group="${pair%%:*}" repo="${pair#*:}"
  url="https://github.com/tenantry-org/$repo"
  tags="$(git ls-remote --tags "$url" "refs/tags/v$version")"
  if [[ -z "$tags" ]]; then
    echo "::notice::$repo has no v$version tag yet, so links to the $group docs are checked by page name only." >&2
    continue
  fi
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "v$version" "$url" "$into/$repo" >&2
  args="$args --$group-docs $into/$repo/docs"
done
echo "$args"
