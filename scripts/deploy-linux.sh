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
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ "$app_root" == /* && -f "$archive" && "$commit" =~ ^[0-9a-f]{40}$ ]] || {
  echo "Invalid deployment arguments." >&2
  exit 2
}

current="$(pm2 show obs-overlay | awk -F '│' '/exec cwd/ {gsub(/^ +| +$/, "", $3); print $3; exit}')"
[[ "$current" == "$app_root"/mangotcg-release-* && -f "$current/data/cardbreak.db" && -f "$current/.env.local" ]] || {
  echo "Current MangoTCG runtime files are unavailable." >&2
  exit 1
}

release="$app_root/mangotcg-release-${commit:0:7}-live"
[[ ! -e "$release" ]] || {
  echo "Release target already exists." >&2
  exit 1
}

data_target="$(readlink -f "$current/data")"
db_before="$(stat -c '%i:%s:%Y' "$data_target/cardbreak.db")"
mkdir -p "$release"
unzip -q "$archive" -d "$release"
cp -a "$current/node_modules" "$release/node_modules"
cp "$current/.env.local" "$release/.env.local"
[[ ! -e "$release/data" ]] || {
  echo "Candidate release unexpectedly contains runtime data." >&2
  exit 1
}
(
  cd "$release"
  npm run build
)
if [[ -e "$release/data" ]]; then
  [[ ! -L "$release/data" ]] || {
    echo "Candidate build linked runtime data unexpectedly." >&2
    exit 1
  }
  rm -rf -- "$release/data"
fi
ln -s "$data_target" "$release/data"
[[ "$db_before" == "$(stat -c '%i:%s:%Y' "$data_target/cardbreak.db")" ]] || {
  echo "Database changed during candidate build." >&2
  exit 1
}

candidate="obs-overlay-candidate-${commit:0:7}"
pm2 start npm --name "$candidate" --cwd "$release" -- start -- -H 127.0.0.1 -p 3002
candidate_code=""
for _ in {1..6}; do
  candidate_code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002/admin/login || true)"
  [[ "$candidate_code" == "200" ]] && break
  sleep 2
done
pm2 delete "$candidate" || true
[[ "$candidate_code" == "200" ]] || {
  echo "Candidate health check failed." >&2
  exit 1
}

pm2 delete obs-overlay
pm2 start npm --name obs-overlay --cwd "$release" -- start -- -H 127.0.0.1 -p 3001
live_code=""
for _ in {1..6}; do
  live_code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/admin/login || true)"
  [[ "$live_code" == "200" ]] && break
  sleep 2
done
if [[ "$live_code" != "200" ]]; then
  pm2 delete obs-overlay || true
  pm2 start npm --name obs-overlay --cwd "$current" -- start -- -H 127.0.0.1 -p 3001
  echo "Live health check failed; restored the previous release." >&2
  exit 1
fi
pm2 save
[[ "$db_before" == "$(stat -c '%i:%s:%Y' "$data_target/cardbreak.db")" ]] || {
  echo "Database changed during deployment." >&2
  exit 1
}
printf 'release=%s db_unchanged=true admin_login=%s\n' "${commit:0:7}" "$live_code"
