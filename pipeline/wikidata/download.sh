#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
query_dir="$project_root/pipeline/wikidata/queries"
output_dir="$project_root/datasets/wikidata"
endpoint="https://query.wikidata.org/sparql"
user_agent="COMP6411D-language-atlas/1.0 (course research)"

mkdir -p "$output_dir"

for table in languages speaker_counts official_status writing_systems; do
  echo "Downloading $table.csv"
  temporary_path="$output_dir/$table.csv.tmp"
  curl --retry 4 --retry-all-errors --connect-timeout 30 --max-time 600 \
    --fail --silent --show-error --location --get "$endpoint" \
    --header "Accept: text/csv" \
    --header "User-Agent: $user_agent" \
    --data-urlencode "query@$query_dir/$table.sparql" \
    --output "$temporary_path"
  mv "$temporary_path" "$output_dir/$table.csv"
done

date -u +%Y-%m-%dT%H:%M:%SZ > "$output_dir/retrieved_at.txt"
