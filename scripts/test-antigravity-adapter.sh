#!/usr/bin/env bash
# End-to-end test for the Antigravity CLI adapter hook handler.
#
# Antigravity delivers the conversation via `transcript_path` (not payload fields)
# and requires FLAT injection output (`additionalContext`, no hookSpecificOutput).
# Spawns a Memoria HTTP server, drives PreInvocation + Stop with a synthetic
# transcript, and verifies the round trip.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
# Isolate cross-process hook state so throttle/dedupe/prompt-buffer don't leak across test runs.
export MEMORIA_ADAPTER_STATE_DIR="$TMP_DIR/adapter-state"
PORT=$((20000 + RANDOM % 10000))
SERVER_URL="http://localhost:${PORT}"
SERVER_PID=""

cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo "[antigravity] start server"
MEMORIA_HOME="$TMP_DIR/home" MEMORIA_PORT="$PORT" "$ROOT_DIR/cli" setup --serve --json >"$TMP_DIR/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 30); do
    if curl -sf "$SERVER_URL/v1/health" >/dev/null 2>&1; then break; fi
    sleep 0.2
done
curl -sf "$SERVER_URL/v1/health" >/dev/null || { echo "[antigravity] server failed to start"; cat "$TMP_DIR/server.log"; exit 1; }

echo "[antigravity] seed memory (so recall has something to return)"
curl -sf -X POST "$SERVER_URL/v1/remember" -H 'Content-Type: application/json' \
    -d '{"timestamp":"2026-05-20T10:00:00Z","project":"antigravity","summary":"用 npm publish 取代 install.sh","events":[{"event_type":"DecisionMade","timestamp":"2026-05-20T10:00:00Z","content":{"decision":"用 npm publish 取代 install.sh"}}]}' \
    >/dev/null

# Antigravity recovers user/assistant text from the transcript, not payload fields.
TRANSCRIPT="$TMP_DIR/transcript.jsonl"
cat >"$TRANSCRIPT" <<'EOF'
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"npm publish 要怎麼設定？"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"設定 NPM_TOKEN secret 並在 tag push 觸發 release。"}]}}
EOF

echo "[antigravity] PreInvocation -> FLAT additionalContext (no hookSpecificOutput) referencing seeded memory"
PRE_JSON="$(node -e "console.log(JSON.stringify({hook_event_name:'PreInvocation', session_id:'sess-agy-1', transcript_path: '${TRANSCRIPT}'}))")"
OUT=$(echo "$PRE_JSON" | "$ROOT_DIR/cli" adapter antigravity --server "$SERVER_URL" --project antigravity)
echo "$OUT" | node -e "
const out = JSON.parse(require('fs').readFileSync(0, 'utf8'));
if (typeof out?.additionalContext !== 'string') { console.error('missing top-level additionalContext: ' + JSON.stringify(out)); process.exit(1); }
if ('hookSpecificOutput' in out) { console.error('output must be flat (no hookSpecificOutput): ' + JSON.stringify(out)); process.exit(1); }
if (!out.additionalContext.includes('npm publish')) { console.error('additionalContext did not contain seed text: ' + out.additionalContext); process.exit(1); }
console.log('  flat additionalContext ok');
"

echo "[antigravity] Stop hook with transcript -> writes ConversationTurn"
BEFORE=$(curl -sf "$SERVER_URL/v1/stats" | node -e "
const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
process.stdout.write(String(r?.data?.events ?? 0));
")

STOP_JSON="$(node -e "console.log(JSON.stringify({hook_event_name:'Stop', session_id:'sess-agy-1', transcript_path: '${TRANSCRIPT}'}))")"
echo "$STOP_JSON" | "$ROOT_DIR/cli" adapter antigravity --server "$SERVER_URL" --project antigravity >/dev/null
sleep 0.3

AFTER=$(curl -sf "$SERVER_URL/v1/stats" | node -e "
const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
process.stdout.write(String(r?.data?.events ?? 0));
")

if [ "$AFTER" -le "$BEFORE" ]; then
    echo "  ✗ event count did not grow (before=$BEFORE, after=$AFTER)"
    exit 1
fi
echo "  Stop hook wrote events ($BEFORE -> $AFTER)"

echo "[antigravity] Stop turn carries the transcript's user + assistant text"
node -e "
const D = require('$ROOT_DIR/node_modules/better-sqlite3');
const db = new D('$TMP_DIR/home/.memory/sessions.db', { readonly: true });
const row = db.prepare(\"SELECT content FROM events WHERE event_type='ConversationTurn' ORDER BY timestamp DESC LIMIT 1\").get();
db.close();
if (!row) { console.error('  ✗ no ConversationTurn event written'); process.exit(1); }
const c = JSON.parse(row.content);
if (!String(c.user || '').includes('npm publish')) { console.error('  ✗ user text not recovered from transcript: ' + row.content); process.exit(1); }
if (!String(c.assistant || '').includes('NPM_TOKEN')) { console.error('  ✗ assistant text not recovered from transcript: ' + row.content); process.exit(1); }
console.log('  turn carries transcript user + assistant');
"

echo "[antigravity] duplicate Stop is deduped (no double write)"
echo "$STOP_JSON" | "$ROOT_DIR/cli" adapter antigravity --server "$SERVER_URL" --project antigravity >/dev/null
sleep 0.3
AFTER2=$(curl -sf "$SERVER_URL/v1/stats" | node -e "
const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
process.stdout.write(String(r?.data?.events ?? 0));
")
if [ "$AFTER2" -ne "$AFTER" ]; then
    echo "  ✗ duplicate Stop wrote again (after=$AFTER, after2=$AFTER2)"
    exit 1
fi
echo "  duplicate Stop deduped (events stayed $AFTER2)"

echo "[antigravity] ok"
