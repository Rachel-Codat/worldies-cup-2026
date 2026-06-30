#!/usr/bin/env bash
# Pull live WC results, rebake them into index.html. Run from repo root.
set -e
cd "$(dirname "$0")/.."
TOKEN="$(cat .secrets/fd-token)"
curl -s --max-time 60 "https://api.football-data.org/v4/competitions/WC/matches" \
  -H "X-Auth-Token: $TOKEN" -o build/matches.json
node build/generate.js build/matches.json index.html
