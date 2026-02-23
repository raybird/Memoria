#!/bin/bash
# test-bootstrap.sh
# Simulates AI agent self-installation of Memoria (Phase 1.5 verification)
# Tests: preflight --json, setup --json, setup --serve --json, SDK health poll

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}") /.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

CLI="$ROOT_DIR/cli"

echo "[bootstrap] Step 1: preflight --json"
PREFLIGHT_OUTPUT=$(MEMORIA_HOME="$TMP" "$CLI" preflight --json)
echo "$PREFLIGHT_OUTPUT"
OK=$(echo "$PREFLIGHT_OUTPUT" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); process.exit(JSON.parse(r).ok ? 0 : 1)" 2>/dev/null) || {
  echo "✗ preflight --json: ok != true"
  exit 1
}
echo "✓ preflight --json passed"

echo ""
echo "[bootstrap] Step 2: setup --json (no serve)"
PASS_COUNT=0
FAIL_COUNT=0
while IFS= read -r line; do
  STEP=$(echo "$line" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); const o=JSON.parse(r.trim()); process.stdout.write(o.step||'')" 2>/dev/null || true)
  STEP_OK=$(echo "$line" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); process.exit(JSON.parse(r.trim()).ok ? 0 : 1)" 2>/dev/null && echo "yes" || echo "no")
  if [ "$STEP_OK" = "yes" ]; then
    echo "  ✓ step[$STEP]"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  ✗ step[$STEP] FAILED: $line"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done < <(MEMORIA_HOME="$TMP" "$CLI" setup --json 2>&1)

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "✗ setup --json: $FAIL_COUNT step(s) failed"
  exit 1
fi
echo "✓ setup --json: $PASS_COUNT steps passed"

echo ""
echo "[bootstrap] Step 3: verify database created"
if [ ! -f "$TMP/.memory/sessions.db" ]; then
  echo "✗ sessions.db was not created"
  exit 1
fi
echo "✓ sessions.db exists"

echo ""
echo "[bootstrap] Step 4: setup --serve --json (background)"
SERVE_PORT=13917
MEMORIA_HOME="$TMP" "$CLI" setup --serve --port "$SERVE_PORT" --json &
SERVE_PID=$!
trap 'rm -rf "$TMP"; kill "$SERVE_PID" 2>/dev/null || true' EXIT

# Wait for server to be ready (up to 10s)
echo "  Waiting for server on port $SERVE_PORT..."
READY=0
for i in $(seq 1 20); do
  if curl -sf "http://localhost:$SERVE_PORT/v1/health" > /dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" -eq 0 ]; then
  echo "✗ Server did not become ready within 10 seconds"
  exit 1
fi

echo ""
echo "[bootstrap] Step 5: GET /v1/health"
HEALTH=$(curl -sf "http://localhost:$SERVE_PORT/v1/health")
echo "$HEALTH" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); const o=JSON.parse(r); process.exit((o.ok && o.data && o.data.ok) ? 0 : 1)" 2>/dev/null || {
  echo "✗ /v1/health: response not ok"
  echo "  Response: $HEALTH"
  exit 1
}
echo "✓ /v1/health returned ok"

echo ""
echo "[bootstrap] Step 6: POST /v1/remember (sample session)"
SESSION_FILE="$ROOT_DIR/examples/session.sample.json"
REMEMBER=$(curl -sf -X POST "http://localhost:$SERVE_PORT/v1/remember" \
  -H "Content-Type: application/json" \
  -d "@$SESSION_FILE")
echo "$REMEMBER" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); process.exit(JSON.parse(r).ok ? 0 : 1)" 2>/dev/null || {
  echo "✗ /v1/remember failed"
  echo "  Response: $REMEMBER"
  exit 1
}
SESSION_ID=$(echo "$REMEMBER" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); process.stdout.write(JSON.parse(r).data.sessionId||'')" 2>/dev/null || true)
echo "✓ /v1/remember ok (sessionId: $SESSION_ID)"

echo ""
echo "[bootstrap] Step 7: POST /v1/recall"
RECALL=$(curl -sf -X POST "http://localhost:$SERVE_PORT/v1/recall" \
  -H "Content-Type: application/json" \
  -d '{"query":"decision","top_k":3}')
echo "$RECALL" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); process.exit(JSON.parse(r).ok ? 0 : 1)" 2>/dev/null || {
  echo "✗ /v1/recall failed"
  echo "  Response: $RECALL"
  exit 1
}
echo "✓ /v1/recall ok"

kill "$SERVE_PID" 2>/dev/null || true

echo ""
echo "[bootstrap] ok"
