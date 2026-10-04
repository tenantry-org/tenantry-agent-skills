#!/usr/bin/env bash
# Builds every ```csharp block in AGENTS.md, README.md and the skills against the Tenantry packages, restored the way
# an application restores them, and fails on any compiler error, reported at the block's line in the markdown. Ported
# from Tenantry Core's scripts/check-doc-snippets.sh. Needs the .NET 10 SDK.
#
#   scripts/check-snippets.sh
#
# Settings, all optional:
#   TENANTRY_VERSION         the Tenantry Core version to build against (default 0.7.0), from nuget.org
#   TENANTRY_CORE_PACKAGES   a folder of Tenantry Core packages to take Tenantry.* from instead of nuget.org, such as
#                            an unreleased version packed from source; TENANTRY_VERSION is then read from it
#   TENANTRY_PRO_PACKAGES    a folder of Tenantry Pro packages. Only with it are the tenantry-pro skill's blocks built,
#                            since the Pro packages are on a private feed
#   SKIP_UNPUBLISHED=1       exit successfully, with a notice, when TENANTRY_VERSION is not on nuget.org yet (CI uses
#                            this until the version the skills target is released)
#
# Mark a block that is not meant to compile (another library's code, or only the shape of something) with
# ```csharp no-compile.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
here="$repo/scripts/snippets"

version_of() {
  local nupkgs=("$1"/$2.[0-9]*.nupkg)
  [[ -e "${nupkgs[0]}" ]] || { echo "No $2 package in $1" >&2; exit 1; }
  unzip -p "${nupkgs[0]}" '*.nuspec' | sed -n 's:.*<version>\(.*\)</version>.*:\1:p' | head -n 1
}

core_packages="${TENANTRY_CORE_PACKAGES:+$(cd "$TENANTRY_CORE_PACKAGES" && pwd)}"
pro_packages="${TENANTRY_PRO_PACKAGES:+$(cd "$TENANTRY_PRO_PACKAGES" && pwd)}"
if [[ -n "$core_packages" ]]; then
  version="$(version_of "$core_packages" Tenantry.Core)"
else
  version="${TENANTRY_VERSION:-0.7.0}"
  if [[ "${SKIP_UNPUBLISHED:-}" == 1 ]] &&
     ! curl -fsSL https://api.nuget.org/v3-flatcontainer/tenantry.core/index.json | grep -q "\"$version\""; then
    echo "::notice::Tenantry.Core $version is not on nuget.org yet, so the skills' code blocks were not built."
    exit 0
  fi
fi

work="$(mktemp -d)"
trap '[[ -n "${KEEP_WORK:-}" ]] || rm -rf "$work"' EXIT

{
  echo '<?xml version="1.0" encoding="utf-8"?>'
  echo '<configuration>'
  echo '  <packageSources>'
  echo '    <clear />'
  [[ -n "$core_packages" ]] && echo "    <add key=\"tenantry-core\" value=\"$core_packages\" />"
  [[ -n "$pro_packages" ]] && echo "    <add key=\"tenantry-pro\" value=\"$pro_packages\" />"
  echo '    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />'
  echo '  </packageSources>'
  echo '  <packageSourceMapping>'
  if [[ -n "$core_packages" ]]; then
    echo '    <packageSource key="tenantry-core">'
    for pattern in Tenantry.Core Tenantry.EfCore Tenantry.AspNetCore Tenantry.Http Tenantry.Caching Tenantry.Options; do
      echo "      <package pattern=\"$pattern\" />"
    done
    echo '    </packageSource>'
  fi
  if [[ -n "$pro_packages" ]]; then
    echo '    <packageSource key="tenantry-pro">'
    echo '      <package pattern="Tenantry.Pro" />'
    echo '      <package pattern="Tenantry.Pro.*" />'
    echo '    </packageSource>'
  fi
  echo '    <packageSource key="nuget.org">'
  echo '      <package pattern="*" />'
  echo '    </packageSource>'
  echo '  </packageSourceMapping>'
  echo '</configuration>'
} > "$work/nuget.config"

# An empty cache, so the Tenantry packages come from where this script says and not from an earlier restore.
export NUGET_PACKAGES="$work/packages"

build() {
  local mode="$1"; shift
  local dir="$work/$mode"
  mkdir -p "$dir"
  cp "$here"/Snippets.csproj "$here"/*.cs "$here"/global.json "$work/nuget.config" "$dir"/
  (cd "$repo" && dotnet run scripts/extract-snippets.cs -- "$repo" "$dir/Blocks" "$mode")
  dotnet restore "$dir/Snippets.csproj" --configfile "$dir/nuget.config" "$@" -v quiet
  if ! dotnet build "$dir/Snippets.csproj" --no-restore "$@" -nologo -v quiet \
      -clp:ErrorsOnly -clp:NoSummary > "$dir/build.log" 2>&1; then
    # Errors carry the markdown's path through #line; show it relative to the repository, once each.
    sed -e "s:$repo/::g" -e 's: \[[^]]*\.csproj\]$::' "$dir/build.log" | sort -u >&2
    echo "The skills' $mode code blocks do not build against Tenantry $version" >&2
    exit 1
  fi
  echo "The skills' $mode code blocks build against Tenantry $version"
}

build core -p:TenantryVersion="$version"
if [[ -n "$pro_packages" ]]; then
  build pro -p:TenantryVersion="$version" -p:IncludePro=true -p:TenantryProVersion="$(version_of "$pro_packages" Tenantry.Pro)"
else
  echo "TENANTRY_PRO_PACKAGES is not set, so the tenantry-pro skill's code blocks were not built."
fi
