#!/usr/bin/env bash
# Pull live WC results, rebake them into index.html. Run from repo root.
set -euo pipefail
cd "$(dirname "$0")/.."

TOKEN="${FD_TOKEN:-$(cat .secrets/fd-token)}"
API="https://api.football-data.org/v4/competitions/WC/matches"
OUT="build/matches.json"
HDR="build/headers.tmp"
ATTEMPTS=5

for attempt in $(seq 1 "$ATTEMPTS"); do
  code=$(curl -s --max-time 60 "$API" -H "X-Auth-Token: $TOKEN" \
           -D "$HDR" -o "$OUT" -w "%{http_code}" || echo 000)
  if [ "$code" = "200" ] && grep -q '"matches"' "$OUT"; then
    break
  fi
  if [ "$attempt" = "$ATTEMPTS" ]; then
    echo "Feed unavailable after $ATTEMPTS attempts (last HTTP $code); generate.js will keep existing data."
    break
  fi
  rateWindowResetSeconds=$(awk 'tolower($1)=="x-requestcounter-reset:"{gsub(/\r/,"",$2);print $2}' "$HDR")
  if [ -n "$rateWindowResetSeconds" ]; then wait=$((rateWindowResetSeconds + 2)); else wait=$((attempt * 10)); fi
  echo "Fetch attempt $attempt got HTTP $code; retrying in ${wait}s..."
  sleep "$wait"
done

node build/generate.js "$OUT" index.html
