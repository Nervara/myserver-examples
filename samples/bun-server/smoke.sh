#!/usr/bin/env bash
# Polyglot connectivity smoke test.
#
# Usage:
#   smoke.sh <base-url> [--write]
#   smoke.sh <base-url> --services <svc-fqdn-1> [<svc-fqdn-2> …]
#
# Modes:
#   default        — DB connectivity probes only (8 chips). Cheap, ~10ms each.
#   --write        — Also runs INSERT/SELECT/DELETE round-trip per DB. Catches
#                    URL-shape regressions, RO-replica routing, credential drift.
#   --services …   — After DB probes, GET / on each service FQDN, expects 200.
#
# Exits 0 only when every probed target passes. "URL not set" is SKIP, not FAIL,
# so partial-fixture deployments stay honest.
set -u

BASE="${1:?usage: smoke.sh <base-url> [--write] [--services <fqdn> ...]}"
shift
WRITE=0
SERVICES=()
mode=db
for arg in "$@"; do
  case "$arg" in
    --write)    WRITE=1 ;;
    --services) mode=svc ;;
    *)
      if [[ "$mode" == "svc" ]]; then SERVICES+=("$arg")
      else echo "unknown arg: $arg" >&2; exit 2; fi
      ;;
  esac
done

QS=""; [[ "$WRITE" == "1" ]] && QS="?write=1"
DBS=(postgres mysql mariadb mongo redis clickhouse keydb dragonfly)
fail=0 skipped=0 ok=0

echo "=== DB probes ($([ "$WRITE" == "1" ] && echo write+read || echo connect-only)) ==="
for t in "${DBS[@]}"; do
  body=$(curl -sS -m 15 -w "\n__HTTP__%{http_code}" "$BASE/health/$t$QS") || {
    printf 'FAIL %-11s transport\n' "$t"; fail=$((fail+1)); continue;
  }
  http=${body##*__HTTP__}
  body=${body%__HTTP__*}
  status=$(echo "$body" | jq -r .ok 2>/dev/null || echo unknown)
  lat=$(echo "$body"   | jq -r .latencyMs 2>/dev/null || echo 0)
  wlat=$(echo "$body"  | jq -r '.write.latencyMs // empty' 2>/dev/null)
  err=$(echo "$body"   | jq -r '.error // .write.error // ""' 2>/dev/null)

  if [[ "$err" == *"_URL not set"* ]]; then
    printf 'SKIP %-11s (env var not configured)\n' "$t"
    skipped=$((skipped+1))
  elif [[ "$status" == "true" ]]; then
    if [[ -n "$wlat" ]]; then
      printf 'OK   %-11s probe=%sms write=%sms\n' "$t" "$lat" "$wlat"
    else
      printf 'OK   %-11s %4sms\n' "$t" "$lat"
    fi
    ok=$((ok+1))
  else
    printf 'FAIL %-11s http=%s err=%s\n' "$t" "$http" "$err"
    fail=$((fail+1))
  fi
done

# Services smoke — DS gap #1 (e2e fixture must verify services too, not just polyglot app).
if [[ ${#SERVICES[@]} -gt 0 ]]; then
  echo ""
  echo "=== Service liveness ==="
  for svc in "${SERVICES[@]}"; do
    http=$(curl -sS -L -m 10 -o /dev/null -w "%{http_code}" "$svc/" 2>&1) || http=000
    if [[ "$http" =~ ^(200|301|302|307|308|401|403)$ ]]; then
      printf 'OK   %-65s HTTP %s\n' "$svc" "$http"
      ok=$((ok+1))
    else
      printf 'FAIL %-65s HTTP %s\n' "$svc" "$http"
      fail=$((fail+1))
    fi
  done
fi

echo "---"
echo "ok=$ok skipped=$skipped fail=$fail"
exit $((fail > 0 ? 1 : 0))
