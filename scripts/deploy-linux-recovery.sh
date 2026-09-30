#!/usr/bin/env bash
set -euo pipefail

app_root=""
archive=""
commit=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-root) app_root="$2"; shift 2 ;;
    --archive) archive="$2"; shift 2 ;;
    --commit) commit="$2"; shift 2 ;;
    *) exit 2 ;;
  esac
done

data_path="$app_root/data"
environment_path="$app_root/.env.local"
[[ "$app_root" == /* && -f "$archive" && "$commit" =~ ^[0-9a-f]{40}$ && -f "$data_path/cardbreak.db" && -f "$environment_path" ]] || exit 1

release="$app_root/mangotcg-release-${commit:0:7}-recovered"
[[ ! -e "$release" ]] || exit 1
db_before="$(stat -c '%i:%s:%Y' "$data_path/cardbreak.db")"
mkdir -p "$release"
unzip -q "$archive" -d "$release"
(
  cd "$release"
  npm ci
  npm run build
)
[[ ! -e "$release/data" ]] || exit 1
cp "$environment_path" "$release/.env.local"
ln -s "$data_path" "$release/data"
[[ "$db_before" == "$(stat -c '%i:%s:%Y' "$data_path/cardbreak.db")" ]] || exit 1

candidate="obs-overlay-candidate-${commit:0:7}"
pm2 start npm --name "$candidate" --cwd "$release" -- start -- -H 127.0.0.1 -p 3002
candidate_code=""
for _ in {1..6}; do
  candidate_code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002/admin/login || true)"
  [[ "$candidate_code" == "200" ]] && break
  sleep 2
done
pm2 delete "$candidate" || true
[[ "$candidate_code" == "200" ]] || exit 1

pm2 delete obs-overlay || true
pm2 start npm --name obs-overlay --cwd "$release" -- start -- -H 127.0.0.1 -p 3001
live_code=""
for _ in {1..6}; do
  live_code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/admin/login || true)"
  [[ "$live_code" == "200" ]] && break
  sleep 2
done
[[ "$live_code" == "200" ]] || exit 1
pm2 save
[[ "$db_before" == "$(stat -c '%i:%s:%Y' "$data_path/cardbreak.db")" ]] || exit 1
printf 'recovery_release=%s db_unchanged=true admin_login=%s\n' "${commit:0:7}" "$live_code"
