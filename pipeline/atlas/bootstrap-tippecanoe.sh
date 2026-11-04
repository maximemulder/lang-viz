#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_dir="$project_root/.tools/tippecanoe-src"
dependency_dir="$project_root/.tools/native-deps"

if [[ ! -d "$source_dir/.git" ]]; then
  echo "Tippecanoe source is missing. Run pipeline/atlas/fetch-sources.sh first." >&2
  exit 1
fi

make_arguments=()
# macOS provides SQLite and zlib headers through the Command Line Tools SDK,
# rather than /usr/include. Clang resolves that SDK automatically.
if [[ "$(uname -s)" != "Darwin" && ! -f /usr/include/sqlite3.h && ! -f /usr/local/include/sqlite3.h ]]; then
  if [[ ! -f "$dependency_dir/usr/include/sqlite3.h" ]]; then
    mkdir -p "$dependency_dir/packages"
    (
      cd "$dependency_dir/packages"
      apt-get download libsqlite3-dev
    )
    sqlite_package="$(find "$dependency_dir/packages" -name 'libsqlite3-dev_*.deb' -print -quit)"
    dpkg-deb --extract "$sqlite_package" "$dependency_dir"
  fi

  make_arguments+=(
    "CXXFLAGS=-I$dependency_dir/usr/include"
    "CFLAGS=-I$dependency_dir/usr/include"
    "LDFLAGS=-L$dependency_dir/usr/lib/x86_64-linux-gnu"
  )
fi

if [[ ${#make_arguments[@]} -gt 0 ]]; then
  make -C "$source_dir" -j"$(getconf _NPROCESSORS_ONLN)" "${make_arguments[@]}" tippecanoe
else
  # Apple's Bash 3.2 treats an empty array expansion as unbound with set -u.
  make -C "$source_dir" -j"$(getconf _NPROCESSORS_ONLN)" tippecanoe
fi
"$source_dir/tippecanoe" --version
