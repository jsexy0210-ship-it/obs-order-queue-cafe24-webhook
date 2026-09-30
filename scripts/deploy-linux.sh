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

app_root="${app_root%/}"
current="$(pm2 show obs-overlay | awk -F '│' '/exec cwd/ {gsub(/^ +| +$/, "", $3); print $3; exit}')"
current="${current%/}"
current_ready=false
if [[ "$current" == "$app_root"/mangotcg-release-* && -f "$current/data/cardbreak.db" && -f "$current/.env.local" && -d "$current/node_modules" ]]; then
  current_ready=true
  data_target="$(readlink -f "$current/data")"
  environment_source="$current/.env.local"
else
  # 삭제된 릴리스의 Node 프로세스가 아직 살아 있으면 열려 있는 SQLite 파일과
  # 실행 환경만 서버 내부에서 복구합니다. 비밀값이나 DB 내용은 출력하지 않습니다.
  runtime_pid="$(pm2 pid obs-overlay 2>/dev/null | head -n 1 || true)"
  if [[ "$runtime_pid" =~ ^[0-9]+$ && -d "/proc/$runtime_pid/fd" ]]; then
    mkdir -p "$app_root/data"
    for fd in "/proc/$runtime_pid"/fd/*; do
      [[ -L "$fd" ]] || continue
      fd_target="$(readlink "$fd" || true)"
      case "$fd_target" in
        */cardbreak.db|*/cardbreak.db\ \(deleted\)) cp "$fd" "$app_root/data/cardbreak.db" || true ;;
        */cardbreak.db-wal|*/cardbreak.db-wal\ \(deleted\)) cp "$fd" "$app_root/data/cardbreak.db-wal" || true ;;
        */cardbreak.db-shm|*/cardbreak.db-shm\ \(deleted\)) cp "$fd" "$app_root/data/cardbreak.db-shm" || true ;;
      esac
    done

    if [[ ! -f "$app_root/.env.local" ]]; then
      umask 077
      recovery_env="$(mktemp "$app_root/.env.local.recovery.XXXXXX")"
      printf 'NODE_ENV=production\n' > "$recovery_env"
      recovered_required=0
      for key in ADMIN_PRIMARY_ID ADMIN_PRIMARY_PASSWORD ADMIN_SECONDARY_ID ADMIN_SECONDARY_PASSWORD CAFE24_MALL_ID CAFE24_CLIENT_ID CAFE24_CLIENT_SECRET CAFE24_REDIRECT_URI CAFE24_TOKEN_ENCRYPTION_KEY CAFE24_WEBHOOK_TOKEN CAFE24_OAUTH_SCOPES CAFE24_REWARD_LIVE_ENABLED CAFE24_NATIVE_REWARDS_DISABLED CAFE24_REWARD_START_AT; do
        value="$(tr '\0' '\n' < "/proc/$runtime_pid/environ" | sed -n "s/^${key}=//p" | head -n 1)"
        if [[ -n "$value" ]]; then
          printf '%s=%s\n' "$key" "$value" >> "$recovery_env"
          case "$key" in
            ADMIN_PRIMARY_ID|ADMIN_PRIMARY_PASSWORD|ADMIN_SECONDARY_ID|ADMIN_SECONDARY_PASSWORD|CAFE24_MALL_ID|CAFE24_CLIENT_ID|CAFE24_CLIENT_SECRET|CAFE24_REDIRECT_URI|CAFE24_TOKEN_ENCRYPTION_KEY|CAFE24_WEBHOOK_TOKEN) recovered_required=$((recovered_required + 1)) ;;
          esac
        fi
      done
      if [[ "$recovered_required" -eq 10 ]]; then
        mv "$recovery_env" "$app_root/.env.local"
      else
        rm -f -- "$recovery_env"
      fi
    fi
  fi

  # 후보 복사 중 중단된 경우에도 원본 데이터와 환경파일만 남아 있으면 새
  # 릴리스를 다시 만들 수 있습니다. DB 파일 자체는 절대 새로 만들지 않습니다.
  data_target="$(readlink -f "$app_root/data")"
  environment_source="$app_root/.env.local"
  [[ -f "$data_target/cardbreak.db" && -f "$environment_source" ]] || {
    echo "Recovery database present: $([[ -f "$data_target/cardbreak.db" ]] && echo yes || echo no)"
    echo "Recovery environment present: $([[ -f "$environment_source" ]] && echo yes || echo no)"
    echo "Current MangoTCG runtime and recovery files are unavailable." >&2
    exit 1
  }
  echo "Current release is unavailable; rebuilding from the original runtime data."
fi

release="$app_root/mangotcg-release-${commit:0:7}-live"

# 운영 중인 릴리스와 원본 data 링크만 보존하고, 전환에 쓰이지 않는 이전 코드
# 릴리스는 새 후보를 만들기 전에 정리합니다. data는 각 릴리스 안의 심볼릭 링크라
# 삭제 대상 폴더를 지워도 원본 DB에는 영향을 주지 않습니다.
shopt -s nullglob
for old_release in "$app_root"/mangotcg-release-*; do
  [[ "${old_release%/}" == "$current" ]] && continue
  [[ -d "$old_release" && ! -L "$old_release" ]] || continue
  rm -rf --one-file-system -- "$old_release"
done
shopt -u nullglob

[[ ! -e "$release" ]] || {
  echo "Release target already exists." >&2
  exit 1
}

db_before="$(stat -c '%i:%s:%Y' "$data_target/cardbreak.db")"
mkdir -p "$release"
unzip -q "$archive" -d "$release"
if [[ "$current_ready" == true ]]; then
  cp -al "$current/node_modules" "$release/node_modules"
else
  (
    cd "$release"
    npm ci
  )
fi
cp "$environment_source" "$release/.env.local"
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
  if [[ "$current_ready" == true ]]; then
    pm2 start npm --name obs-overlay --cwd "$current" -- start -- -H 127.0.0.1 -p 3001
    echo "Live health check failed; restored the previous release." >&2
  else
    echo "Live health check failed; the previous release was unavailable." >&2
  fi
  exit 1
fi
pm2 save
[[ "$db_before" == "$(stat -c '%i:%s:%Y' "$data_target/cardbreak.db")" ]] || {
  echo "Database changed during deployment." >&2
  exit 1
}
printf 'release=%s db_unchanged=true admin_login=%s\n' "${commit:0:7}" "$live_code"
