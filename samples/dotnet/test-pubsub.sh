#!/usr/bin/env bash
# test-pubsub.sh — Load test for Redis pub/sub endpoints
# Usage: ./test-pubsub.sh [URL] [NUM_MESSAGES] [NUM_SUBSCRIBERS] [CONCURRENCY]

set -e

URL="${1:-https://022bc518-dotnet.serverops.cloud}"
NUM_MESSAGES="${2:-50}"
NUM_SUBSCRIBERS="${3:-3}"
CONCURRENCY="${4:-10}"
CHANNEL="load-test-channel"
SSE_DIR=$(mktemp -d)
PIDS=()

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
    curl -sf --max-time 30 -N "$URL/subscribe/$CHANNEL" > "$OUT" &
    PIDS+=($!)
    echo "  Subscriber $i started (pid ${PIDS[-1]})"
done
sleep 2  # give subscribers time to connect
echo ""

# --- 3. Publish messages (with concurrency) ---
echo "[3/4] Publishing $NUM_MESSAGES messages ($CONCURRENCY concurrent)..."
START=$(date +%s%3N)
SUCCESS=0
FAIL=0
COUNTER=0

publish_one() {
    local n=$1
    local resp
    resp=$(curl -sf -X POST "$URL/publish/$CHANNEL" \
        -H "Content-Type: text/plain" \
        -d "Message #$n — $(date +%T.%3N)" 2>/dev/null)
    if echo "$resp" | grep -q '"receivers"'; then
        echo "ok"
    else
        echo "fail"
    fi
}
export -f publish_one
export URL CHANNEL

# Run in parallel batches
RESULTS=$(seq 1 "$NUM_MESSAGES" | xargs -P "$CONCURRENCY" -I{} bash -c 'publish_one "$@"' _ {})
SUCCESS=$(echo "$RESULTS" | grep -c "^ok$" || true)
FAIL=$(echo "$RESULTS" | grep -c "^fail$" || true)

END=$(date +%s%3N)
ELAPSED=$(( END - START ))
RPS=$(( NUM_MESSAGES * 1000 / (ELAPSED + 1) ))

echo ""
echo "  ✓ Sent:    $NUM_MESSAGES"
echo "  ✓ Success: $SUCCESS"
echo "  ✗ Failed:  $FAIL"
echo "  ⏱ Time:    ${ELAPSED}ms"
echo "  ⚡ Rate:    ~${RPS} req/s"
echo ""

# Let subscribers flush
sleep 2

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
    echo "  Subscriber $i received: $COUNT messages"
done

echo ""
echo "================================================"
echo "  SUMMARY"
echo "================================================"
echo "  Published:       $SUCCESS / $NUM_MESSAGES"
echo "  Total received:  $TOTAL_RECEIVED (across $NUM_SUBSCRIBERS subscribers)"
echo "  Expected:        $((SUCCESS * NUM_SUBSCRIBERS))"
echo "  Duration:        ${ELAPSED}ms (~${RPS} msg/s)"
if [ "$FAIL" -eq 0 ] && [ "$TOTAL_RECEIVED" -ge "$SUCCESS" ]; then
    echo ""
    echo "  ✓ LOAD TEST PASSED"
else
    echo ""
    echo "  ✗ LOAD TEST ISSUES DETECTED"
fi
echo "================================================"
