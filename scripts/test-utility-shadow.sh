#!/usr/bin/env bash
# UFL Phase 0 shadow-spike plumbing guard (docs/RFC-utility-feedback.md §10).
#
# The utility shadow is dormant instrumentation (gated by MEMORIA_UTILITY_SHADOW, off by default).
# This test drives the claude-code adapter over two turns with the shadow on and asserts the reuse
# signal DISCRIMINATES: an assistant reply that reuses the injected memory scores clearly higher
# than an unrelated reply. It guards the plumbing so it does not rot before Phase 1 consumes it.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
export MEMORIA_ADAPTER_STATE_DIR="$TMP_DIR/adapter-state"
SHADOW="$TMP_DIR/shadow.jsonl"
PORT=$((20000 + RANDOM % 10000))
SERVER_URL="http://localhost:${PORT}"
SERVER_PID=""
cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo "[shadow] start server"
MEMORIA_HOME="$TMP_DIR/home" MEMORIA_PORT="$PORT" "$ROOT_DIR/cli" setup --serve --json >"$TMP_DIR/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 30); do curl -sf "$SERVER_URL/v1/health" >/dev/null 2>&1 && break; sleep 0.2; done
curl -sf "$SERVER_URL/v1/health" >/dev/null || { echo "[shadow] server failed to start"; cat "$TMP_DIR/server.log"; exit 1; }

echo "[shadow] seed a distinctive memory"
curl -sf -X POST "$SERVER_URL/v1/remember" -H 'Content-Type: application/json' \
  -d '{"timestamp":"2026-05-20T10:00:00Z","project":"shadow","summary":"connection pooling","events":[{"event_type":"DecisionMade","timestamp":"2026-05-20T10:00:00Z","content":{"decision":"use connection pooling with withDb to avoid reopening the database handle each call"}}]}' >/dev/null

SESS="shadow-sess"
QUERY="how should we do connection pooling"

# Drive one turn: inject (buffers recall under the shadow) then Stop with $1 as the assistant reply.
drive_turn() {
  local assistant="$1" tr="$TMP_DIR/tr-$RANDOM.jsonl"
  echo "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"$SESS\",\"prompt\":\"$QUERY\"}" \
    | MEMORIA_UTILITY_SHADOW="$SHADOW" "$ROOT_DIR/cli" adapter claude-code --server "$SERVER_URL" --project shadow >/dev/null
  printf '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"%s"}]}}\n' "$QUERY" > "$tr"
  printf '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"%s"}]}}\n' "$assistant" >> "$tr"
  echo "{\"hook_event_name\":\"Stop\",\"session_id\":\"$SESS\",\"transcript_path\":\"$tr\"}" \
    | MEMORIA_UTILITY_SHADOW="$SHADOW" "$ROOT_DIR/cli" adapter claude-code --server "$SERVER_URL" --project shadow >/dev/null
}

echo "[shadow] turn 1: assistant reuses the injected memory (expect high reuse)"
drive_turn "you can use connection pooling with withDb to avoid reopening the database handle each call"

echo "[shadow] turn 2: assistant is unrelated (expect low reuse)"
drive_turn "the weather is nice today lets go for a walk in the park and grab some coffee"

echo "[shadow] assert two records and that reuse discriminates"
node -e "
const fs=require('fs');
const raw=fs.readFileSync('$SHADOW','utf8').trim();
const rows=raw.split('\n').filter(Boolean).map((l)=>JSON.parse(l));
const fail=(m)=>{console.error('  ✗ '+m); process.exit(1);};
if (rows.length !== 2) fail('expected 2 shadow records, got '+rows.length);
for (const r of rows) {
  for (const k of ['recallId','top_confidence','reuseScore','reuseScoreFull','hitCount']) {
    if (!(k in r)) fail('record missing field '+k+': '+JSON.stringify(r));
  }
  if (typeof r.reuseScore !== 'number' || r.reuseScore < 0 || r.reuseScore > 1) fail('reuseScore out of [0,1]: '+r.reuseScore);
}
const reused=rows[0].reuseScore, unrelated=rows[1].reuseScore;
if (!(reused > 0.6)) fail('reused turn should score high (>0.6), got '+reused);
if (!(unrelated < 0.4)) fail('unrelated turn should score low (<0.4), got '+unrelated);
if (!(reused - unrelated > 0.3)) fail('signal must discriminate (gap>0.3): reused='+reused+' unrelated='+unrelated);
console.log('  reuse discriminates: reused='+reused.toFixed(3)+' vs unrelated='+unrelated.toFixed(3));
"

echo "[shadow] assert the shadow is OFF by default (no env -> no file written)"
SHADOW2="$TMP_DIR/shadow-off.jsonl"
echo "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"off-sess\",\"prompt\":\"$QUERY\"}" \
  | "$ROOT_DIR/cli" adapter claude-code --server "$SERVER_URL" --project shadow >/dev/null
[ ! -f "$SHADOW2" ] || { echo "  ✗ shadow wrote a file with the env unset"; exit 1; }
echo "  shadow dormant when MEMORIA_UTILITY_SHADOW unset"

echo "[shadow] ok"
