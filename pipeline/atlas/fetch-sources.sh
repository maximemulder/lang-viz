#!/usr/bin/env bash
set -euo pipefail

project_root="${ATLAS_FETCH_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
lock_file="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sources.lock.tsv"

while IFS=$'\t' read -r target revision repository sparse_paths; do
  if [[ -z "$target" || "$target" == \#* ]]; then
    continue
  fi

  destination="$project_root/$target"
  if [[ -e "$destination" && ! -d "$destination/.git" ]]; then
    echo "Refusing to replace non-Git path: $destination" >&2
    exit 1
  fi

  if [[ -d "$destination/.git" ]]; then
    current_revision="$(git -C "$destination" rev-parse HEAD)"
    if [[ "$current_revision" == "$revision" ]]; then
      echo "Using $target at $revision"
      continue
    fi

    current_repository="$(git -C "$destination" remote get-url origin)"
    if [[ "$current_repository" != "$repository" ]]; then
      echo "Unexpected origin for $destination: $current_repository" >&2
      exit 1
    fi
  else
    mkdir -p "$(dirname "$destination")"
    git init --quiet "$destination"
    git -C "$destination" remote add origin "$repository"
  fi

  echo "Fetching $target at $revision"
  git -C "$destination" fetch --quiet --depth=1 --filter=blob:none origin "$revision"

  if [[ -n "${sparse_paths:-}" ]]; then
    IFS=',' read -r -a paths <<< "$sparse_paths"
    git -C "$destination" sparse-checkout init --no-cone
    git -C "$destination" sparse-checkout set --no-cone "${paths[@]}"
  fi

  git -C "$destination" checkout --quiet --detach FETCH_HEAD
  actual_revision="$(git -C "$destination" rev-parse HEAD)"
  if [[ "$actual_revision" != "$revision" ]]; then
    echo "Expected $revision for $target, got $actual_revision" >&2
    exit 1
  fi
done < "$lock_file"
