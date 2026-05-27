#!/usr/bin/env bash
# Polyglot connectivity smoke test.
# Usage: smoke.sh https://your-bun-discovery.fqdn
# Exits 0 only if every probed DB returns ok=true. Skips chips that report
# "<TYPE>_URL not set" so partial deployments don't false-fail.
set -u

BASE="${1:?usage: smoke.sh <base-url>}"
DBS=(postgres mysql mariadb mongo redis clickhouse keydb dragonfly)
fail=0 skipped=0 ok=0

for t in "${DBS[@]}"; do
  body=$(curl -sS -m 10 -w "\n__HTTP__%{http_code}" "$BASE/health/$t") || {
    printf 'FAIL %-11s transport\n' "$t"; fail=$((fail+1)); continue;
  }
  http=${body##*__HTTP__}
  body=${body%__HTTP__*}
  status=$(echo "$body" | jq -r .ok 2>/dev/null || echo unknown)
  lat=$(echo "$body" | jq -r .latencyMs 2>/dev/null || echo 0)
  err=$(echo "$body" | jq -r .error 2>/dev/null || echo "")

  if [[ "$err" == *"_URL not set"* ]]; then
    printf 'SKIP %-11s (env var not configured)\n' "$t"
    skipped=$((skipped+1))
  elif [[ "$status" == "true" ]]; then
    printf 'OK   %-11s %4sms\n' "$t" "$lat"
    ok=$((ok+1))
  else
    printf 'FAIL %-11s http=%s err=%s\n' "$t" "$http" "$err"
    fail=$((fail+1))
  fi
done

echo "---"
echo "ok=$ok skipped=$skipped fail=$fail"
exit $((fail > 0 ? 1 : 0))
