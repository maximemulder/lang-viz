#!/usr/bin/env bash
set -euo pipefail

project_root="${ATLAS_FETCH_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
destination="$project_root/datasets/dlac/raw"
mkdir -p "$destination"

# Public files in Crissman, Digital Language Atlas of China, Dataverse V6.0.
# File IDs and checksums pin the production input independently of later releases.
while read -r file_id checksum filename; do
  target="$destination/$filename"
  if [[ -f "$target" ]] && echo "$checksum  $target" | sha256sum --check --status; then
    echo "Using verified $filename"
    continue
  fi
  temporary="$(mktemp "$destination/.download.XXXXXX")"
  trap 'rm -f "$temporary"' EXIT
  curl --fail --location --silent --show-error --retry 2 --max-time 120 \
    "https://dataverse.harvard.edu/api/access/datafile/$file_id" -o "$temporary"
  echo "$checksum  $temporary" | sha256sum --check --status
  mv "$temporary" "$target"
  trap - EXIT
  echo "Fetched and verified $filename"
done <<'FILES'
2423709 7cb94506f9e18d457b1234f99cbd42a11a4ce52552f33d97c07c3e47a956c5bb ACSN_MajorLanguages_pgn.zip
2423710 c6eb362135346a1a295b447e2adf576c3444581c2de18de5ef8abec1fbb404bb DLAC.Metadata.doc
FILES
