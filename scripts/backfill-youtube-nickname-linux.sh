#!/usr/bin/env bash
set -euo pipefail

app_root="$1"
incoming="$2"
shift 2

[[ "$app_root" == /* && "$incoming" == /root/.mangotcg-incoming/nickname-backfill-* ]] || exit 2
current="$(pm2 show obs-overlay | awk -F '│' '/exec cwd/ {gsub(/^ +| +$/, "", $3); print $3; exit}')"
[[ "$current" == "$app_root"/mangotcg-release-* && -f "$current/data/cardbreak.db" && -f "$current/.env.local" ]] || {
  echo "Production runtime files are unavailable." >&2
  exit 1
}

node "$incoming/backfill-youtube-nickname.mjs" "$current" "$@"
