#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_dir="$project_root/.tools/tippecanoe-src"
dependency_dir="$project_root/.tools/native-deps"

if [[ ! -d "$source_dir/.git" ]]; then
  mkdir -p "$project_root/.tools"
  git clone --depth 1 https://github.com/felt/tippecanoe.git "$source_dir"
fi

make_arguments=()
if [[ ! -f /usr/include/sqlite3.h && ! -f /usr/local/include/sqlite3.h ]]; then
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

make -C "$source_dir" -j"$(getconf _NPROCESSORS_ONLN)" "${make_arguments[@]}"
"$source_dir/tippecanoe" --version
