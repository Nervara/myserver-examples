#!/usr/bin/env bash
# test-pubsub.sh — Load test for Redis pub/sub endpoints
# Usage: ./test-pubsub.sh [URL] [NUM_MESSAGES] [NUM_SUBSCRIBERS] [CONCURRENCY]

set -e

URL="${1:-https://022bc518-dotnet.serverops.cloud}"
NUM_MESSAGES="${2:-500}"
NUM_SUBSCRIBERS="${3:-10}"
CONCURRENCY="${4:-50}"
CHANNEL="load-test-channel"
SSE_DIR=$(mktemp -d)
PIDS=()

# macOS-compatible millisecond timer
ms() { python3 -c "import time; print(int(time.time() * 1000))"; }

cleanup() {
    for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
    rm -rf "$SSE_DIR"
}
trap cleanup EXIT

echo "================================================"
echo "  Pub/Sub Load Test"
echo "================================================"
echo "  URL:         $URL"
echo "  Channel:     $CHANNEL"
echo "  Messages:    $NUM_MESSAGES"
echo "  Subscribers: $NUM_SUBSCRIBERS"
echo "  Concurrency: $CONCURRENCY parallel publishers"
echo "================================================"
echo ""

# --- 1. Health check ---
echo "[1/4] Health check..."
HEALTH=$(curl -sf "$URL/health")
echo "  ✓ $HEALTH"
echo ""

# --- 2. Spin up multiple subscribers ---
echo "[2/4] Starting $NUM_SUBSCRIBERS subscribers..."
for i in $(seq 1 "$NUM_SUBSCRIBERS"); do
    OUT="$SSE_DIR/sub_$i.txt"
    curl -sf --max-time 60 -N "$URL/subscribe/$CHANNEL" > "$OUT" 2>/dev/null &
    PIDS+=($!)
    echo "  Subscriber $i started (pid ${PIDS[-1]})"
done
sleep 3  # give subscribers time to connect
echo ""

# --- 3. Publish messages in parallel waves ---
echo "[3/4] Publishing $NUM_MESSAGES messages ($CONCURRENCY concurrent)..."

publish_one() {
    local n=$1
    local url=$2
    local channel=$3
    local resp
    resp=$(curl -sf --max-time 10 -X POST "$url/publish/$channel" \
        -H "Content-Type: text/plain" \
        -d "LoadTest #$n @ $(date +%T)" 2>/dev/null)
    if echo "$resp" | grep -q '"receivers"'; then
        echo "ok"
    else
        echo "fail:$resp"
    fi
}
export -f publish_one

START=$(ms)
RESULTS=$(seq 1 "$NUM_MESSAGES" | xargs -P "$CONCURRENCY" -I{} bash -c 'publish_one "$@"' _ {} "$URL" "$CHANNEL")
END=$(ms)

SUCCESS=$(echo "$RESULTS" | grep -c "^ok$" || true)
FAIL=$(echo "$RESULTS" | grep -c "^fail" || true)
ELAPSED=$(( END - START ))
RPS=$(( SUCCESS * 1000 / (ELAPSED + 1) ))

echo ""
echo "  ✓ Sent:    $NUM_MESSAGES"
echo "  ✓ Success: $SUCCESS"
echo "  ✗ Failed:  $FAIL"
echo "  ⏱ Time:    ${ELAPSED}ms"
echo "  ⚡ Rate:    ~${RPS} req/s"

if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "  Failed responses:"
    echo "$RESULTS" | grep "^fail" | head -5
fi
echo ""

# Let subscribers flush remaining messages
echo "  Waiting for subscribers to drain..."
sleep 4

# Kill subscribers
for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
sleep 1

# --- 4. Verify SSE output ---
echo "[4/4] Verifying subscriber receipts..."
TOTAL_RECEIVED=0
for i in $(seq 1 "$NUM_SUBSCRIBERS"); do
    OUT="$SSE_DIR/sub_$i.txt"
    COUNT=$(grep -c "^data:" "$OUT" 2>/dev/null || echo 0)
    TOTAL_RECEIVED=$((TOTAL_RECEIVED + COUNT))
    PCTG=$(( COUNT * 100 / (SUCCESS + 1) ))
    echo "  Subscriber $i received: $COUNT / $SUCCESS messages (${PCTG}%%)"
done

EXPECTED=$((SUCCESS * NUM_SUBSCRIBERS))
LOSS=$((EXPECTED - TOTAL_RECEIVED))

echo ""
echo "================================================"
echo "  SUMMARY"
echo "================================================"
printf "  Published:       %d / %d\n" "$SUCCESS" "$NUM_MESSAGES"
printf "  Total received:  %d / %d expected\n" "$TOTAL_RECEIVED" "$EXPECTED"
printf "  Message loss:    %d\n" "$LOSS"
printf "  Throughput:      ~%d msg/s\n" "$RPS"
printf "  Duration:        %dms\n" "$ELAPSED"
echo ""
if [ "$FAIL" -eq 0 ] && [ "$LOSS" -eq 0 ]; then
    echo "  ✓ LOAD TEST PASSED — zero loss"
elif [ "$FAIL" -eq 0 ] && [ "$LOSS" -lt $((EXPECTED / 10)) ]; then
    echo "  ⚠ MOSTLY OK — < 10% message loss (late subscribers)"
else
    echo "  ✗ LOAD TEST ISSUES — check server logs"
fi
echo "================================================"
