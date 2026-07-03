#!/usr/bin/env bash
# HTTP contract coverage for endpoints not exercised by other tests:
#   GET /v1/sessions/:id/summary, POST/GET /v1/sources, POST /v1/wiki/build,
#   POST /v1/wiki/file-query, POST /v1/wiki/lint — plus their 400/404 error paths.
# Also covers the SDK read methods behind these routes (summarizeSession, listSources).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
PORT=$((20000 + RANDOM % 10000))
SERVER_URL="http://localhost:${PORT}"
SERVER_PID=""

cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo "[http] start server"
MEMORIA_HOME="$TMP_DIR/home" MEMORIA_PORT="$PORT" "$ROOT_DIR/cli" setup --serve --json >"$TMP_DIR/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 30); do curl -sf "$SERVER_URL/v1/health" >/dev/null 2>&1 && break; sleep 0.2; done
curl -sf "$SERVER_URL/v1/health" >/dev/null || { echo "[http] server failed to start"; cat "$TMP_DIR/server.log"; exit 1; }

assert_ok() {
    node -e "const d=JSON.parse(process.argv[1]); if(!d||d.ok!==true){throw new Error('expected ok=true, got: '+process.argv[1])}" "$1"
}
assert_status() {
    local want="$1"; shift
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' "$@")
    [ "$code" = "$want" ] || { echo "  ✗ expected HTTP $want, got $code"; exit 1; }
}

echo "[http] POST /v1/remember -> capture session id"
REMEMBER=$(curl -sf -X POST "$SERVER_URL/v1/remember" -H 'Content-Type: application/json' \
    -d '{"project":"http","summary":"HTTP contract test session","events":[{"event_type":"DecisionMade","timestamp":"2026-06-01T00:00:00Z","content":{"decision":"cover HTTP endpoints with tests"}}]}')
assert_ok "$REMEMBER"
SID=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).data.sessionId))" "$REMEMBER")
echo "  session_id=$SID"

echo "[http] GET /v1/sessions/:id/summary"
SUMMARY=$(curl -sf "$SERVER_URL/v1/sessions/$SID/summary")
node -e "const d=JSON.parse(process.argv[1]); if(!d.ok || d.data.sessionId!=='$SID' || !(d.data.eventCount>=1)){throw new Error('bad summary: '+process.argv[1])}" "$SUMMARY"
echo "  summary ok (eventCount>=1)"

echo "[http] GET /v1/sessions/:id/summary (unknown -> 404)"
assert_status 404 "$SERVER_URL/v1/sessions/does-not-exist-xyz/summary"
echo "  404 ok"

echo "[http] POST /v1/sources"
SRCFILE="$TMP_DIR/note.md"
printf '# Research Note\n\nMemoria HTTP source ingest coverage.\n' > "$SRCFILE"
SRC=$(curl -sf -X POST "$SERVER_URL/v1/sources" -H 'Content-Type: application/json' -d "{\"filePath\":\"$SRCFILE\",\"title\":\"HTTP Note\"}")
assert_ok "$SRC"
echo "  source added"

echo "[http] POST /v1/sources (missing filePath -> 400)"
assert_status 400 -X POST "$SERVER_URL/v1/sources" -H 'Content-Type: application/json' -d '{}'
echo "  400 ok"

echo "[http] GET /v1/sources"
LIST=$(curl -sf "$SERVER_URL/v1/sources")
node -e "const d=JSON.parse(process.argv[1]); if(!d.ok || !Array.isArray(d.data) || d.data.length<1){throw new Error('expected >=1 source: '+process.argv[1])}" "$LIST"
echo "  list ok (>=1)"

echo "[http] POST /v1/wiki/build"
assert_ok "$(curl -sf -X POST "$SERVER_URL/v1/wiki/build")"
echo "  wiki build ok"

echo "[http] POST /v1/wiki/file-query"
assert_ok "$(curl -sf -X POST "$SERVER_URL/v1/wiki/file-query" -H 'Content-Type: application/json' -d '{"query":"HTTP endpoints","title":"HTTP Coverage Brief","kind":"synthesis"}')"
echo "  file-query ok"

echo "[http] POST /v1/wiki/file-query (missing query -> 400)"
assert_status 400 -X POST "$SERVER_URL/v1/wiki/file-query" -H 'Content-Type: application/json' -d '{"title":"x"}'
echo "  400 ok"

echo "[http] POST /v1/wiki/lint"
assert_ok "$(curl -sf -X POST "$SERVER_URL/v1/wiki/lint" -H 'Content-Type: application/json' -d '{}')"
echo "  wiki lint ok"

echo "[http] Zod boundary rejects malformed bodies with 400"
# wrong type on a required field (query as number) — old hand-validation only checked presence
assert_status 400 -X POST "$SERVER_URL/v1/recall" -H 'Content-Type: application/json' -d '{"query":123}'
# invalid enum value for recall mode
assert_status 400 -X POST "$SERVER_URL/v1/recall" -H 'Content-Type: application/json' -d '{"query":"x","mode":"bogus"}'
# wrong type on a nested field (events must be an array)
assert_status 400 -X POST "$SERVER_URL/v1/remember" -H 'Content-Type: application/json' -d '{"events":"not-an-array"}'
echo "  malformed bodies rejected (400)"

echo "[http] ok"
